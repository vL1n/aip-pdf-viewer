import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

type Db = Database.Database;

export type OpenDbOptions = {
  dbPath: string;
};

function isCorruptionError(err: unknown) {
  const e = err as any;
  const msg = String(e?.message || "").toLowerCase();
  const code = String(e?.code || "");
  return (
    msg.includes("malformed") ||
    msg.includes("disk image is malformed") ||
    msg.includes("database disk image is malformed") ||
    msg.includes("corrupt") ||
    code.startsWith("SQLITE_CORRUPT")
  );
}

function moveAsideCorruptDb(dbPath: string) {
  if (!fs.existsSync(dbPath)) return;
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const bak = path.join(dir, `${base}.corrupt.${Date.now()}`);
  fs.renameSync(dbPath, bak);
  // WAL/SHM 也一并挪走，避免残留影响
  const wal = `${dbPath}-wal`;
  const shm = `${dbPath}-shm`;
  if (fs.existsSync(wal)) fs.renameSync(wal, `${bak}-wal`);
  if (fs.existsSync(shm)) fs.renameSync(shm, `${bak}-shm`);
}

export function openDb({ dbPath }: OpenDbOptions): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    const db = new Database(dbPath);

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA foreign_keys = ON;
    `);

    // 启动即做一次完整性检查，避免后续 resetData 才报“malformed”
    try {
      // 先 checkpoint，尽量把 WAL 合并进主库（也能提前暴露 WAL 损坏）
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // ignore
      }

      const rows = db.prepare("PRAGMA integrity_check(1)").all() as Array<Record<string, unknown>>;
      const values = rows.map((r) => String(Object.values(r)[0] ?? ""));
      if (!values.every((v) => v.toLowerCase() === "ok")) {
        db.close();
        moveAsideCorruptDb(dbPath);
        const db2 = new Database(dbPath);
        db2.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA temp_store = MEMORY;
          PRAGMA foreign_keys = ON;
        `);
        return db2;
      }
    } catch (err) {
      if (isCorruptionError(err)) {
        db.close();
        moveAsideCorruptDb(dbPath);
        const db2 = new Database(dbPath);
        db2.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA temp_store = MEMORY;
          PRAGMA foreign_keys = ON;
        `);
        return db2;
      }
      // 其他错误不阻塞启动
    }

    return db;
  } catch (err) {
    if (!isCorruptionError(err)) throw err;
    // 自动恢复：备份损坏库 -> 重建
    moveAsideCorruptDb(dbPath);
    const db = new Database(dbPath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA foreign_keys = ON;
    `);
    return db;
  }
}

export function initSchema(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS airports (
      icao TEXT PRIMARY KEY,
      name TEXT,
      bureau TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      icao TEXT,
      airport_name TEXT,
      rel_path TEXT NOT NULL UNIQUE,
      abs_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      dirname TEXT NOT NULL,
      size INTEGER,
      mtime_ms INTEGER,
      chart_page TEXT,
      chart_name TEXT,
      chart_type TEXT,
      is_sup INTEGER,
      is_modify INTEGER,
      group_key TEXT
    );

    DROP TABLE IF EXISTS files_fts;
    CREATE VIRTUAL TABLE files_fts USING fts5(
      filename,
      rel_path,
      icao,
      airport_name,
      chart_name,
      chart_type,
      group_key,
      content='files',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, filename, rel_path, icao, airport_name, chart_name, chart_type, group_key)
      VALUES (new.id, new.filename, new.rel_path, new.icao, new.airport_name, new.chart_name, new.chart_type, new.group_key);
    END;

    CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, filename, rel_path, icao, airport_name, chart_name, chart_type, group_key)
      VALUES ('delete', old.id, old.filename, old.rel_path, old.icao, old.airport_name, old.chart_name, old.chart_type, old.group_key);
    END;

    CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, filename, rel_path, icao, airport_name, chart_name, chart_type, group_key)
      VALUES ('delete', old.id, old.filename, old.rel_path, old.icao, old.airport_name, old.chart_name, old.chart_type, old.group_key);
      INSERT INTO files_fts(rowid, filename, rel_path, icao, airport_name, chart_name, chart_type, group_key)
      VALUES (new.id, new.filename, new.rel_path, new.icao, new.airport_name, new.chart_name, new.chart_type, new.group_key);
    END;
  `);
}

export function resetData(db: Db) {
  db.exec(`
    DELETE FROM files;
    DELETE FROM airports;
  `);
}

export function initFavoritesSchema(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      rel_path TEXT PRIMARY KEY,
      icao TEXT,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_icao ON favorites(icao);
  `);
}


