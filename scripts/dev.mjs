import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitHealth({ apiBase, timeoutMs }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${apiBase}/api/health`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(300);
  }
  throw new Error(`等待后端健康检查超时：${apiBase}/api/health`);
}

async function waitIndexReady({ apiBase, timeoutMs }) {
  const start = Date.now();
  let lastMsg = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${apiBase}/api/index/status`);
      if (res.ok) {
        const body = await res.json();
        const s = body?.status;
        const phase = s?.phase;
        const processed = s?.processedPdfs ?? 0;
        const total = s?.totalPdfs ?? null;
        const msg = s?.message || "";
        const line = `[index] ${phase || "unknown"} ${total != null ? `${processed}/${total}` : `${processed}`} ${msg}`;
        if (line !== lastMsg) {
          console.log(line);
          lastMsg = line;
        }
        if (phase === "ready") return;
        if (phase === "error") {
          throw new Error(s?.lastError || "索引失败");
        }
      }
    } catch (e) {
      // 忽略瞬时错误，继续等
    }
    await sleep(1000);
  }
  throw new Error(`等待索引完成超时：${apiBase}/api/index/status`);
}

function run(cmd, args, extraEnv) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv }
  });
  return child;
}

const args = parseArgs(process.argv.slice(2));

const root = args.root || process.env.AIP_ROOT || process.env.EAIP_ROOT;
if (!root) {
  console.error('必须提供 --root "<pdf根目录>"，例如：--root "/xxx/xxx/eaip/20251201"');
  process.exit(1);
}

const apiPort = Number(args["api-port"] || process.env.AIP_API_PORT || process.env.EAIP_API_PORT || 13001);
const webPort = Number(args["web-port"] || process.env.AIP_WEB_PORT || process.env.EAIP_WEB_PORT || 13002);
const host = String(args.host || process.env.HOST || "0.0.0.0");
// 默认每次都重建索引库；如需跳过，用 --no-rebuild-db
const rebuildDb = !Boolean(args["no-rebuild-db"] || process.env.AIP_NO_REBUILD_DB || process.env.EAIP_NO_REBUILD_DB);
const waitIndex = !Boolean(args["no-wait-index"]);

const apiBase = `http://localhost:${apiPort}`;

// 统一把临时目录放到项目内，避免某些环境对 /var/folders 等系统临时目录的权限限制（tsx 会用到）
const tmpDir = path.resolve(process.cwd(), ".data/tmp");
try {
  fs.mkdirSync(tmpDir, { recursive: true });
} catch {
  // ignore
}

console.log(`[dev] 启动后端：port=${apiPort} root=${root}`);
const serverArgs = [
  "--filter",
  "@aip/server",
  "dev",
  "--root",
  root,
  "--port",
  String(apiPort),
  "--host",
  host
];
if (rebuildDb) serverArgs.push("--rebuild-db");

const server = run("pnpm", serverArgs, { TMPDIR: tmpDir, TSX_TMPDIR: tmpDir });

let web = null;

const shutdown = () => {
  try {
    if (web && !web.killed) web.kill("SIGINT");
  } catch {}
  try {
    if (server && !server.killed) server.kill("SIGINT");
  } catch {}
};

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

server.on("exit", (code) => {
  if (code && code !== 0) console.error(`[dev] 后端退出：code=${code}`);
  shutdown();
  process.exit(code ?? 0);
});

(async () => {
  await waitHealth({ apiBase, timeoutMs: 60_000 });
  console.log(`[dev] 后端已就绪（health ok）`);

  if (waitIndex) {
    console.log(`[dev] 等待索引构建完成后再启动前端（可用 --no-wait-index 跳过）...`);
    await waitIndexReady({ apiBase, timeoutMs: 30 * 60_000 });
  }

  console.log(`[dev] 启动前端：port=${webPort} -> proxy ${apiBase}`);

  web = run(
    "pnpm",
    ["--filter", "@aip/web", "dev", "--port", String(webPort), "--host", host],
    {
      VITE_API_TARGET: apiBase,
      TMPDIR: tmpDir
    }
  );

  web.on("exit", (code) => {
    if (code && code !== 0) console.error(`[dev] 前端退出：code=${code}`);
    shutdown();
    process.exit(code ?? 0);
  });
})().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  shutdown();
  process.exit(1);
});


