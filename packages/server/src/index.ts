import path from "node:path";
import fs from "node:fs";

import { Command } from "commander";

import { openDb } from "./sqlite.js";
import { createServer } from "./server.js";
import { IndexManager } from "./indexManager.js";

const program = new Command();

program
  .name("aip-server")
  .option("--root <path>", "扫描入口目录（会递归扫描 .pdf）", process.env.AIP_ROOT || process.env.NAIP_ROOT || "")
  .option("--db <path>", "SQLite 索引文件路径", process.env.AIP_DB || process.env.NAIP_DB || path.resolve(".data/index.sqlite"))
  .option("--rebuild-db", "删除旧索引库并重建（遇到损坏/结构变更时用）", false)
  .option("--port <port>", "HTTP 端口", (v) => parseInt(v, 10), Number(process.env.PORT || 13001))
  .option("--host <host>", "HTTP 监听地址", process.env.HOST || "0.0.0.0")
  .option("--serve-web", "生产模式：同时静态托管 web/dist", Boolean(process.env.AIP_SERVE_WEB || process.env.NAIP_SERVE_WEB || false))
  .option("--web-dist <path>", "web 的 dist 目录（配合 --serve-web）", process.env.AIP_WEB_DIST || process.env.NAIP_WEB_DIST || "");

async function main() {
  const opts = program.parse(process.argv).opts<{
    root: string;
    db: string;
    rebuildDb: boolean;
    port: number;
    host: string;
    serveWeb: boolean;
    webDist: string;
  }>();

  const rootPath = path.resolve(opts.root || "");
  if (!opts.root) {
    // eslint-disable-next-line no-console
    console.error("必须提供 --root <path>（例如 /xxx/xxx/eaip/20251201）");
    process.exit(1);
  }

  if (opts.rebuildDb) {
    try {
      if (fs.existsSync(opts.db)) fs.rmSync(opts.db);
      if (fs.existsSync(`${opts.db}-wal`)) fs.rmSync(`${opts.db}-wal`);
      if (fs.existsSync(`${opts.db}-shm`)) fs.rmSync(`${opts.db}-shm`);
    } catch {
      // ignore
    }
  }
  const db = openDb({ dbPath: opts.db });

  const indexManager = new IndexManager(db);

  let webDistPath: string | undefined;
  if (opts.serveWeb) {
    if (opts.webDist) {
      webDistPath = path.resolve(opts.webDist);
    } else {
      // 尝试两种常见启动位置：
      // - cwd=packages/server => ../web/dist
      // - cwd=repoRoot       => packages/web/dist
      const c1 = path.resolve(process.cwd(), "../web/dist");
      const c2 = path.resolve(process.cwd(), "packages/web/dist");
      webDistPath = fs.existsSync(c1) ? c1 : c2;
    }
  }
  const app = createServer({ db, rootPath, webDistPath, indexManager });

  await app.listen({ port: opts.port, host: opts.host });
  app.log.info({ rootPath, db: opts.db }, "server started");

  // 后台构建索引，让前端可以显示“启动进度条”
  void indexManager.start(rootPath);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


