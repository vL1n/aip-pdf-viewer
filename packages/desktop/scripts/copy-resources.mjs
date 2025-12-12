import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "../..");
const outWeb = path.resolve(process.cwd(), "resources/web");
const outServer = path.resolve(process.cwd(), "resources/server");

const webDist = path.join(repoRoot, "packages/web/dist");
const serverDist = path.join(repoRoot, "packages/server/dist");

function rm(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function cpDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

rm(outWeb);
rm(outServer);

if (!fs.existsSync(webDist)) {
  console.error(`[desktop] 缺少 web 构建产物：${webDist}（请先运行 pnpm --filter @naip/web build）`);
  process.exit(1);
}
if (!fs.existsSync(serverDist)) {
  console.error(`[desktop] 缺少 server 构建产物：${serverDist}（请先运行 pnpm --filter @naip/server build）`);
  process.exit(1);
}

cpDir(webDist, outWeb);
cpDir(serverDist, outServer);

console.log(`[desktop] copied web -> ${outWeb}`);
console.log(`[desktop] copied server -> ${outServer}`);


