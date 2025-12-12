import fs from "node:fs";
import path from "node:path";

import fastify from "fastify";
import staticPlugin from "@fastify/static";
import mime from "mime-types";
import type Database from "better-sqlite3";

import { buildTree } from "./tree.js";
import type { IndexManager } from "./indexManager.js";

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
  db: Database.Database;
  rootPath: string;
  webDistPath?: string;
  indexManager: IndexManager;
};

export function createServer({ db, rootPath, webDistPath, indexManager }: CreateServerOptions) {
  const app = fastify({
    logger: true
  });

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

  app.get("/api/search", async (req, reply) => {
    if (!requireReady(reply)) return;
    const q = req.query as { q?: string; icao?: string; limit?: string; offset?: string };
    const query = (q.q || "").trim();
    const icao = (q.icao || "").trim().toUpperCase();
    const limit = Math.min(Math.max(parseInt(q.limit || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset || "0", 10) || 0, 0);

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
      LIMIT ? OFFSET ?
    `;

    const items = db
      .prepare(candidatesSql)
      .all(...ftsParams, ...likeParamsFull, limit, offset);

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


