import fs from "node:fs";
import path from "node:path";

import fastify from "fastify";
import staticPlugin from "@fastify/static";
import mime from "mime-types";
import type Database from "better-sqlite3";

import { buildTree } from "./tree.js";
import type { IndexManager } from "./indexManager.js";
import { initAnnotationsSchema, initFavoritesSchema } from "./sqlite.js";
import { NavDatabase } from "./navdb.js";
import { parseRoute } from "./routeParser.js";
import { parseKml } from "./kmlParser.js";
import { calculateShortestRoute, type ShortestRouteOptions } from "./routeShortest.js";

function isInsideRoot(rootPath: string, filePath: string) {
  const root = path.resolve(rootPath);
  const file = path.resolve(filePath);
  const rel = path.relative(root, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function buildFtsMatch(q: string) {
  const terms = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);
  if (terms.length === 0) return null;

  // 简单前缀匹配：term* AND term2*
  // 注意：FTS5 的语法比较宽松，这里做最小转义。
  const sanitize = (s: string) =>
    s
      .replaceAll('"', "")
      .replaceAll("'", "")
      .replaceAll("\\", " ")
      .trim();
  return terms.map((t) => `${sanitize(t)}*`).join(" AND ");
}

export type CreateServerOptions = {
  db: Database.Database; // index db
  favoritesDb: Database.Database;
  navDb: Database.Database | null; // navigation db (nd.db3), optional
  rootPath: string;
  webDistPath?: string;
  indexManager: IndexManager;
};

export function createServer({ db, favoritesDb, navDb, rootPath, webDistPath, indexManager }: CreateServerOptions) {
  const app = fastify({
    logger: true
  });

  // 确保收藏表存在（独立 SQLite；不依赖索引构建是否完成）
  initFavoritesSchema(favoritesDb);
  initAnnotationsSchema(favoritesDb);

  // 导航数据库封装（可选）
  const navDatabase = navDb ? new NavDatabase(navDb) : null;

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/index/status", async () => {
    return { status: indexManager.getStatus() };
  });

  app.get("/api/index/stream", async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    // 防止 Fastify 自动结束响应
    (reply as any).hijack?.();

    const send = (s: any) => {
      reply.raw.write(`event: status\ndata: ${JSON.stringify(s)}\n\n`);
    };

    send(indexManager.getStatus());
    const off = indexManager.onStatus((s) => send(s));

    req.raw.on("close", () => {
      off();
    });

    return;
  });

  app.post("/api/index/rebuild", async (_req, reply) => {
    if (indexManager.isIndexing()) return reply.code(409).send({ error: "indexing", status: indexManager.getStatus() });
    void indexManager.start(rootPath);
    return { ok: true, status: indexManager.getStatus() };
  });

  function requireReady(reply: any) {
    if (indexManager.isReady()) return true;
    reply.code(409).send({ error: "index_not_ready", status: indexManager.getStatus() });
    return false;
  }

  function resolveFileRef(input: { fileId?: unknown; relPath?: unknown }) {
    const fileId = input.fileId != null ? Number(input.fileId) : null;
    const relPath = typeof input.relPath === "string" ? input.relPath.trim() : null;

    const fileRow =
      fileId != null && !Number.isNaN(fileId)
        ? (db.prepare(`SELECT rel_path, icao FROM files WHERE id = ?`).get(fileId) as any)
        : relPath
          ? (db.prepare(`SELECT rel_path, icao FROM files WHERE rel_path = ?`).get(relPath) as any)
          : null;

    if (!fileRow?.rel_path) return null;
    return {
      relPath: String(fileRow.rel_path),
      icao: fileRow.icao != null ? String(fileRow.icao) : null
    };
  }

  function normalizeAnnotationPoints(input: unknown) {
    if (!Array.isArray(input)) return null;
    const points = input
      .map((item) => {
        const x = Number((item as any)?.x);
        const y = Number((item as any)?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y))
        };
      })
      .filter(Boolean) as Array<{ x: number; y: number }>;

    return points.length >= 2 ? points : null;
  }

  function parseAnnotationPoints(pointsJson: string) {
    try {
      return normalizeAnnotationPoints(JSON.parse(pointsJson)) ?? [];
    } catch {
      return [];
    }
  }

  app.get("/api/airports", async () => {
    if (!indexManager.isReady()) return { airports: [], status: indexManager.getStatus(), error: "index_not_ready" };
    const rows = db
      .prepare(
        `
        SELECT a.icao, a.name, a.bureau, COUNT(f.id) AS fileCount
        FROM airports a
        LEFT JOIN files f ON f.icao = a.icao
        GROUP BY a.icao
        ORDER BY a.icao
      `
      )
      .all();
    return { airports: rows };
  });

  app.get("/api/tree", async (req, reply) => {
    if (!requireReady(reply)) return;
    const q = req.query as { icao?: string };
    const icao = (q.icao || "").toUpperCase();

    const where: string[] = [];
    const params: any[] = [];
    if (icao) {
      where.push("icao = ?");
      params.push(icao);
    }

    const sql = `
      SELECT id, rel_path, chart_name, chart_type, chart_page, is_sup, group_key
      FROM files
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY rel_path
    `;
    const items = db.prepare(sql).all(...params) as any[];

    // 如果指定 ICAO，则 UI 展示从 Terminal/<ICAO>/ 后面开始的子路径
    const strip = icao ? `Terminal/${icao}` : "";
    const tree = buildTree(items, strip);
    return { icao: icao || null, tree };
  });

  // ---- Favorites ----
  app.get("/api/favorites/relpaths", async (req, reply) => {
    if (!requireReady(reply)) return;
    const q = req.query as { icao?: string };
    const icao = (q.icao || "").toUpperCase();
    if (!icao) return { relPaths: [] as string[] };

    const favRows = favoritesDb
      .prepare(`SELECT rel_path, created_at_ms FROM favorites ORDER BY created_at_ms DESC`)
      .all() as Array<{ rel_path: string; created_at_ms: number }>;

    const relPaths = favRows.map((r) => r.rel_path);
    if (relPaths.length === 0) return { icao, relPaths: [] as string[] };

    // indexDb 与 favoritesDb 分离，不能直接 JOIN；用 IN 分批过滤，保持 favorites 的时间顺序
    const allowed = new Set<string>();
    const chunkSize = 900;
    for (let i = 0; i < relPaths.length; i += chunkSize) {
      const chunk = relPaths.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const sql = `SELECT rel_path FROM files WHERE icao = ? AND rel_path IN (${placeholders})`;
      const rows = db.prepare(sql).all(icao, ...chunk) as Array<{ rel_path: string }>;
      for (const r of rows) allowed.add(r.rel_path);
    }

    const filtered = relPaths.filter((rp) => allowed.has(rp));
    return { icao, relPaths: filtered };
  });

  app.post("/api/favorites/add", async (req, reply) => {
    if (!requireReady(reply)) return;
    const body = (req.body || {}) as { fileId?: number; relPath?: string };
    const fileId = body.fileId != null ? Number(body.fileId) : null;
    const relPath = typeof body.relPath === "string" ? body.relPath : null;

    const fileRow =
      fileId != null && !Number.isNaN(fileId)
        ? (db.prepare(`SELECT rel_path, icao FROM files WHERE id = ?`).get(fileId) as any)
        : relPath
          ? (db.prepare(`SELECT rel_path, icao FROM files WHERE rel_path = ?`).get(relPath) as any)
          : null;

    if (!fileRow?.rel_path) return reply.code(400).send({ error: "invalid_file" });

    favoritesDb.prepare(`INSERT OR IGNORE INTO favorites(rel_path, icao, created_at_ms) VALUES (?, ?, ?)`).run(
      String(fileRow.rel_path),
      fileRow.icao != null ? String(fileRow.icao) : null,
      Date.now()
    );
    return { ok: true, relPath: String(fileRow.rel_path), icao: fileRow.icao ?? null };
  });

  app.post("/api/favorites/remove", async (req, reply) => {
    if (!requireReady(reply)) return;
    const body = (req.body || {}) as { relPath?: string; fileId?: number };
    const relPath = typeof body.relPath === "string" ? body.relPath : null;
    const fileId = body.fileId != null ? Number(body.fileId) : null;

    let rp = relPath;
    if (!rp && fileId != null && !Number.isNaN(fileId)) {
      const row = db.prepare(`SELECT rel_path FROM files WHERE id = ?`).get(fileId) as any;
      rp = row?.rel_path ? String(row.rel_path) : null;
    }
    if (!rp) return reply.code(400).send({ error: "invalid_rel_path" });

    favoritesDb.prepare(`DELETE FROM favorites WHERE rel_path = ?`).run(rp);
    return { ok: true, relPath: rp };
  });

  app.get("/api/favorites/export", async () => {
    const rows = favoritesDb
      .prepare(`SELECT rel_path, icao, created_at_ms FROM favorites ORDER BY created_at_ms DESC`)
      .all() as Array<{ rel_path: string; icao: string | null; created_at_ms: number }>;
    return {
      version: 1,
      exportedAtMs: Date.now(),
      favorites: rows
    };
  });

  app.post("/api/favorites/import", async (req, reply) => {
    const body = (req.body || {}) as any;
    const mode = String(body?.mode || "merge");
    const favorites = Array.isArray(body?.favorites) ? (body.favorites as any[]) : null;
    if (!favorites) return reply.code(400).send({ error: "invalid_payload" });

    const tx = favoritesDb.transaction(() => {
      initFavoritesSchema(favoritesDb);
      if (mode === "replace") {
        favoritesDb.prepare(`DELETE FROM favorites`).run();
      }

      const stmt = favoritesDb.prepare(`INSERT OR IGNORE INTO favorites(rel_path, icao, created_at_ms) VALUES (?, ?, ?)`);
      for (const f of favorites) {
        const rel_path = typeof f?.rel_path === "string" ? f.rel_path : null;
        if (!rel_path) continue;
        const icao = typeof f?.icao === "string" ? f.icao : null;
        const created = Number.isFinite(Number(f?.created_at_ms)) ? Number(f.created_at_ms) : Date.now();
        stmt.run(rel_path, icao, created);
      }
    });
    tx();

    const totalRow = favoritesDb.prepare(`SELECT COUNT(1) AS c FROM favorites`).get() as any;
    return { ok: true, mode, total: totalRow?.c ?? 0 };
  });

  // ---- Annotations ----
  app.get("/api/annotations", async (req, reply) => {
    if (!requireReady(reply)) return;
    const q = req.query as { fileId?: string; relPath?: string };
    const fileRef = resolveFileRef({ fileId: q.fileId, relPath: q.relPath });
    if (!fileRef) return reply.code(400).send({ error: "invalid_file" });

    const rows = favoritesDb
      .prepare(
        `
          SELECT id, page_index, kind, color, opacity, stroke_width, points_json, created_at_ms, updated_at_ms
          FROM annotations
          WHERE rel_path = ?
          ORDER BY page_index, created_at_ms, id
        `
      )
      .all(fileRef.relPath) as Array<{
        id: number;
        page_index: number;
        kind: string;
        color: string;
        opacity: number;
        stroke_width: number;
        points_json: string;
        created_at_ms: number;
        updated_at_ms: number;
      }>;

    return {
      relPath: fileRef.relPath,
      annotations: rows
        .map((row) => ({
          id: row.id,
          relPath: fileRef.relPath,
          pageIndex: row.page_index,
          kind: row.kind,
          color: row.color,
          opacity: row.opacity,
          strokeWidth: row.stroke_width,
          points: parseAnnotationPoints(row.points_json),
          createdAtMs: row.created_at_ms,
          updatedAtMs: row.updated_at_ms
        }))
        .filter((row) => row.points.length >= 2)
    };
  });

  app.post("/api/annotations/add", async (req, reply) => {
    if (!requireReady(reply)) return;
    const body = (req.body || {}) as any;
    const fileRef = resolveFileRef({ fileId: body.fileId, relPath: body.relPath });
    if (!fileRef) return reply.code(400).send({ error: "invalid_file" });

    const pageIndex = Number(body.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return reply.code(400).send({ error: "invalid_page_index" });
    }

    const kind = body.kind === "highlighter" ? "highlighter" : body.kind === "pen" ? "pen" : null;
    if (!kind) {
      return reply.code(400).send({ error: "invalid_kind" });
    }

    const color = typeof body.color === "string" ? body.color.trim().slice(0, 32) : "";
    if (!color) {
      return reply.code(400).send({ error: "invalid_color" });
    }

    const opacity = Number(body.opacity);
    if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
      return reply.code(400).send({ error: "invalid_opacity" });
    }

    const strokeWidth = Number(body.strokeWidth);
    if (!Number.isFinite(strokeWidth) || strokeWidth <= 0 || strokeWidth > 0.1) {
      return reply.code(400).send({ error: "invalid_stroke_width" });
    }

    const points = normalizeAnnotationPoints(body.points);
    if (!points) {
      return reply.code(400).send({ error: "invalid_points" });
    }

    const now = Date.now();
    const result = favoritesDb
      .prepare(
        `
          INSERT INTO annotations(
            rel_path, page_index, kind, color, opacity, stroke_width, points_json, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(fileRef.relPath, pageIndex, kind, color, opacity, strokeWidth, JSON.stringify(points), now, now);

    return {
      ok: true,
      annotation: {
        id: Number(result.lastInsertRowid),
        relPath: fileRef.relPath,
        pageIndex,
        kind,
        color,
        opacity,
        strokeWidth,
        points,
        createdAtMs: now,
        updatedAtMs: now
      }
    };
  });

  app.post("/api/annotations/delete", async (req, reply) => {
    if (!requireReady(reply)) return;
    const body = (req.body || {}) as any;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    favoritesDb.prepare(`DELETE FROM annotations WHERE id = ?`).run(id);
    return { ok: true, id };
  });

  app.post("/api/annotations/clear", async (req, reply) => {
    if (!requireReady(reply)) return;
    const body = (req.body || {}) as any;
    const fileRef = resolveFileRef({ fileId: body.fileId, relPath: body.relPath });
    if (!fileRef) return reply.code(400).send({ error: "invalid_file" });

    const pageIndex =
      body.pageIndex == null || body.pageIndex === ""
        ? null
        : Number.isInteger(Number(body.pageIndex))
          ? Number(body.pageIndex)
          : NaN;
    if (pageIndex != null && (!Number.isInteger(pageIndex) || pageIndex < 0)) {
      return reply.code(400).send({ error: "invalid_page_index" });
    }

    const result =
      pageIndex == null
        ? favoritesDb.prepare(`DELETE FROM annotations WHERE rel_path = ?`).run(fileRef.relPath)
        : favoritesDb.prepare(`DELETE FROM annotations WHERE rel_path = ? AND page_index = ?`).run(fileRef.relPath, pageIndex);

    return { ok: true, cleared: result.changes };
  });

  app.get("/api/search", async (req, reply) => {
    if (!requireReady(reply)) return;
    const q = req.query as { q?: string; icao?: string; limit?: string; offset?: string };
    const query = (q.q || "").trim();
    const icao = (q.icao || "").trim().toUpperCase();
    const limitRaw = (q.limit || "").trim().toLowerCase();
    const unlimited = limitRaw === "all" || limitRaw === "0";
    const limit = unlimited ? null : Math.min(Math.max(parseInt(q.limit || "50", 10) || 50, 1), 200);
    const offset = unlimited ? 0 : Math.max(parseInt(q.offset || "0", 10) || 0, 0);

    if (!query) return { query, icao: icao || null, total: 0, items: [] };

    // 模糊搜索策略：
    // - FTS（前缀）用于“词”匹配，结果排序更好
    // - LIKE（子串）用于真正模糊（尤其是中文、无空格）
    const terms = query
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);

    const match = buildFtsMatch(query);

    // LIKE：多个词用 AND；每个词在多个字段里 OR
    const likeClauses: string[] = [];
    const likeParams: any[] = [];
    for (const t of terms) {
      const pat = `%${t}%`;
      likeClauses.push(
        `(f.filename LIKE ? OR f.rel_path LIKE ? OR IFNULL(f.chart_name,'') LIKE ? OR IFNULL(f.chart_type,'') LIKE ? OR IFNULL(f.airport_name,'') LIKE ? OR IFNULL(f.icao,'') LIKE ?)`
      );
      likeParams.push(pat, pat, pat, pat, pat, pat);
    }
    const likeWhere = likeClauses.length ? likeClauses.join(" AND ") : "1=0";

    const ftsWhere: string[] = [];
    const ftsParams: any[] = [];
    if (match) {
      ftsWhere.push("files_fts MATCH ?");
      ftsParams.push(match);
    }
    if (icao) {
      // 对两个分支都限制 ICAO
      ftsWhere.push("f.icao = ?");
      ftsParams.push(icao);
    }

    const likeWhereFull = icao ? `(${likeWhere}) AND (f.icao = ?)` : likeWhere;
    const likeParamsFull = icao ? [...likeParams, icao] : likeParams;

    const candidatesSql = `
      WITH candidates AS (
        ${
          match
            ? `
          SELECT
            f.id, f.icao, f.airport_name, f.rel_path, f.filename,
            f.chart_name, f.chart_type, f.chart_page, f.group_key,
            bm25(files_fts) AS rank
          FROM files_fts
          JOIN files f ON f.id = files_fts.rowid
          WHERE ${ftsWhere.join(" AND ")}
        `
            : `
          SELECT
            f.id, f.icao, f.airport_name, f.rel_path, f.filename,
            f.chart_name, f.chart_type, f.chart_page, f.group_key,
            1000.0 AS rank
          FROM files f
          WHERE 1=0
        `
        }
        UNION ALL
        SELECT
          f.id, f.icao, f.airport_name, f.rel_path, f.filename,
          f.chart_name, f.chart_type, f.chart_page, f.group_key,
          1000.0 AS rank
        FROM files f
        WHERE ${likeWhereFull}
      ),
      dedup AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY rank) AS rn
        FROM candidates
      )
      SELECT
        id, icao, airport_name, rel_path, filename,
        chart_name, chart_type, chart_page, group_key,
        rank
      FROM dedup
      WHERE rn = 1
      ORDER BY rank
      ${unlimited ? "" : "LIMIT ? OFFSET ?"}
    `;

    const items = db
      .prepare(candidatesSql)
      .all(...ftsParams, ...likeParamsFull, ...(unlimited ? [] : [limit, offset]));

    const totalSql = `
      WITH candidates AS (
        ${
          match
            ? `
          SELECT f.id
          FROM files_fts
          JOIN files f ON f.id = files_fts.rowid
          WHERE ${ftsWhere.join(" AND ")}
        `
            : `
          SELECT f.id FROM files f WHERE 1=0
        `
        }
        UNION
        SELECT f.id
        FROM files f
        WHERE ${likeWhereFull}
      )
      SELECT COUNT(1) AS c FROM candidates
    `;

    const totalRow = db.prepare(totalSql).get(...ftsParams, ...likeParamsFull) as any;
    return { query, icao: icao || null, total: totalRow?.c ?? 0, items };
  });

  app.get("/api/file/:id", async (req, reply) => {
    if (!requireReady(reply)) return;
    const { id } = req.params as any;
    const row = db
      .prepare(
        `SELECT id, icao, airport_name, rel_path, abs_path, filename, chart_name, chart_type, chart_page, is_sup, is_modify, group_key, size, mtime_ms FROM files WHERE id = ?`
      )
      .get(Number(id));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.get("/api/pdf/:id", async (req, reply) => {
    if (!requireReady(reply)) return;
    const { id } = req.params as any;
    const row = db.prepare(`SELECT abs_path, filename, size FROM files WHERE id = ?`).get(Number(id)) as
      | { abs_path: string; filename: string; size: number }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });

    const absPath = row.abs_path;
    if (!isInsideRoot(rootPath, absPath)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const stat = fs.statSync(absPath);
    const total = stat.size;
    const range = req.headers.range;
    const contentType = (mime.lookup(row.filename) || "application/pdf") as string;

    reply.header("Content-Type", contentType);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "no-store");

    if (!range) {
      reply.header("Content-Length", total);
      return reply.send(fs.createReadStream(absPath));
    }

    const m = /^bytes=(\d+)-(\d+)?$/.exec(range);
    if (!m) return reply.code(416).send();
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
      return reply.code(416).send();
    }

    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
    reply.header("Content-Length", end - start + 1);
    return reply.send(fs.createReadStream(absPath, { start, end }));
  });

  // ---- Route Parsing (航路解析) ----
  
  /** 检查导航数据库是否可用 */
  app.get("/api/route/status", async () => {
    return {
      available: navDatabase !== null,
      message: navDatabase ? "导航数据库已加载" : "导航数据库不可用（未找到 nd.db3）"
    };
  });

  /** 解析航路 */
  app.post("/api/route/parse", async (req, reply) => {
    if (!navDatabase) {
      return reply.code(503).send({
        success: false,
        error: "导航数据库不可用（未找到 nd.db3）",
        points: []
      });
    }

    const body = (req.body || {}) as { route?: string };
    const routeString = typeof body.route === "string" ? body.route.trim() : "";

    if (!routeString) {
      return reply.code(400).send({
        success: false,
        error: "请提供航路字符串",
        points: []
      });
    }

    try {
      const result = parseRoute(navDatabase, routeString);
      return result;
    } catch (err: any) {
      return reply.code(500).send({
        success: false,
        error: err?.message || "解析失败",
        points: []
      });
    }
  });

  /** 调试：查询航路段 */
  app.get("/api/route/segment", async (req, reply) => {
    if (!navDatabase) {
      return reply.code(503).send({ error: "导航数据库不可用" });
    }

    const q = req.query as { airway?: string; from?: string; to?: string };
    const airway = (q.airway || "").toUpperCase();
    const from = (q.from || "").toUpperCase();
    const to = (q.to || "").toUpperCase();

    if (!airway || !from || !to) {
      return reply.code(400).send({ error: "缺少参数：airway, from, to" });
    }

    const segment = navDatabase.getAirwaySegment(airway, from, to);
    return { airway, from, to, segment, count: segment?.length ?? 0 };
  });

  /** 计算最短航路：优先使用航路图，无法接入航路时才退化为直连航点 */
  app.post("/api/route/shortest", async (req, reply) => {
    if (!navDatabase) {
      return reply.code(503).send({
        success: false,
        error: "导航数据库不可用（未找到 nd.db3）",
        routeString: "",
        points: [],
        legs: []
      });
    }

    const body = (req.body || {}) as {
      departure?: string;
      arrival?: string;
      via?: string[] | string;
      options?: ShortestRouteOptions;
    };
    const departure = typeof body.departure === "string" ? body.departure.trim().toUpperCase() : "";
    const arrival = typeof body.arrival === "string" ? body.arrival.trim().toUpperCase() : "";
    const via =
      typeof body.via === "string"
        ? body.via.split(/[\s,，]+/).map((item) => item.trim().toUpperCase()).filter(Boolean)
        : Array.isArray(body.via)
          ? body.via.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
          : [];

    if (!departure || !arrival) {
      return reply.code(400).send({
        success: false,
        error: "请提供起飞机场和降落机场",
        routeString: "",
        points: [],
        legs: []
      });
    }

    try {
      return calculateShortestRoute(navDatabase, {
        departure,
        arrival,
        via,
        options: body.options
      });
    } catch (err: any) {
      return reply.code(500).send({
        success: false,
        error: err?.message || "最短航路计算失败",
        routeString: "",
        points: [],
        legs: []
      });
    }
  });

  /** 查询地图点附近的高空航路点 */
  app.get("/api/route/high-waypoints", async (req, reply) => {
    if (!navDatabase) {
      return reply.code(503).send({
        success: false,
        error: "导航数据库不可用（未找到 nd.db3）",
        waypoints: []
      });
    }

    const q = req.query as { lat?: string; lon?: string; radiusNm?: string; limit?: string };
    const lat = Number(q.lat);
    const lon = Number(q.lon);
    const radiusNm = Math.max(5, Math.min(200, Number(q.radiusNm) || 30));
    const limit = Math.max(1, Math.min(500, Number(q.limit) || 200));

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return reply.code(400).send({
        success: false,
        error: "请提供有效的 lat/lon",
        waypoints: []
      });
    }

    try {
      return {
        success: true,
        error: null,
        center: { lat, lon },
        radiusNm,
        waypoints: navDatabase.findHighAirwayWaypointsNear(lat, lon, radiusNm, limit)
      };
    } catch (err: any) {
      return reply.code(500).send({
        success: false,
        error: err?.message || "查询高空航路点失败",
        waypoints: []
      });
    }
  });

  // ---- KML Parsing (KML 解析) ----

  /** 解析 KML 文件 */
  app.post("/api/kml/parse", async (req, reply) => {
    const body = (req.body || {}) as { content?: string };
    const kmlContent = typeof body.content === "string" ? body.content : "";

    if (!kmlContent) {
      return reply.code(400).send({
        success: false,
        error: "请提供 KML 文件内容",
        points: []
      });
    }

    try {
      const result = parseKml(kmlContent);
      return result;
    } catch (err: any) {
      return reply.code(500).send({
        success: false,
        error: err?.message || "解析 KML 失败",
        points: []
      });
    }
  });

  /** 旧航迹拟合接口已退役，航线模式统一使用最短航路 */
  app.post("/api/route/fit", async (_req, reply) => {
    return reply.code(410).send({
      success: false,
      error: "航迹拟合功能已移除，请使用 /api/route/shortest",
      waypoints: [],
      routeString: "",
      candidates: []
    });
  });

  if (webDistPath) {
    app.register(staticPlugin, {
      root: webDistPath,
      // 避免 @fastify/static 注册通配路由 `/*`（包含 HEAD）与我们自己的 SPA fallback 冲突
      wildcard: false,
      index: false
    });

    // 单页应用入口（当前 UI 没有前端路由，/ 足够；如果未来加路由再扩展）
    app.get("/", async (_req, reply) => {
      const indexHtml = path.join(webDistPath, "index.html");
      if (!fs.existsSync(indexHtml)) return reply.code(404).send("web not built");
      return reply.type("text/html").send(fs.readFileSync(indexHtml));
    });
  }

  return app;
}
