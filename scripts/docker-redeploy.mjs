import { spawnSync } from "node:child_process";
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

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const args = parseArgs(process.argv.slice(2));

const tag = String(args.tag || process.env.AIP_DOCKER_TAG || "eaip-pdf-viewer:local");
const name = String(args.name || process.env.AIP_DOCKER_NAME || "eaip-pdf-viewer");
const port = Number(args.port || process.env.AIP_PORT || 13001);
const nodeImage = args["node-image"]
  ? String(args["node-image"])
  : process.env.AIP_DOCKER_NODE_IMAGE
    ? String(process.env.AIP_DOCKER_NODE_IMAGE)
    : "";
const npmRegistry = args["npm-registry"]
  ? String(args["npm-registry"])
  : process.env.AIP_DOCKER_NPM_REGISTRY
    ? String(process.env.AIP_DOCKER_NPM_REGISTRY)
    : "";
const rebuildDb = Boolean(args["rebuild-db"] || process.env.AIP_DOCKER_REBUILD_DB);

console.log(`[docker] nodeImage=${nodeImage} npmRegistry=${npmRegistry}`);

const rootHost = String(args.root || process.env.AIP_ROOT_HOST || "");
if (!rootHost) {
  // eslint-disable-next-line no-console
  console.error('必须提供 --root "<eaip根目录>"（宿主机路径），例如：pnpm docker:redeploy -- --root "/xxx/eaip/20251201"');
  process.exit(1);
}

const stateHost = path.resolve(String(args.state || process.env.AIP_STATE_HOST || ".data/docker-state"));

const platform = args.platform ? String(args.platform) : process.env.AIP_DOCKER_PLATFORM ? String(process.env.AIP_DOCKER_PLATFORM) : "";
const platformArgs = platform ? ["--platform", platform] : [];

// 1) build
run("docker", [
  "build",
  ...platformArgs,
  ...(nodeImage ? ["--build-arg", `NODE_IMAGE=${nodeImage}`] : []),
  ...(npmRegistry ? ["--build-arg", `NPM_REGISTRY=${npmRegistry}`] : []),
  "-t",
  tag,
  "."
]);

// 2) stop/remove (ignore errors)
spawnSync("docker", ["rm", "-f", name], { stdio: "inherit" });

// 3) run
run("docker", [
  "run",
  "-d",
  "--name",
  name,
  "--restart",
  "unless-stopped",
  "-p",
  `${port}:13001`,
  "-e",
  "PORT=13001",
  "-e",
  "AIP_SERVE_WEB=1",
  "-e",
  "AIP_WEB_DIST=/app/web",
  "-e",
  "AIP_ROOT=/data",
  "-e",
  "AIP_DB=/state/index.sqlite",
  "-e",
  "AIP_FAV_DB=/state/favorites.sqlite",
  ...(rebuildDb ? ["-e", "AIP_REBUILD_DB=1"] : []),
  "-v",
  `${rootHost}:/data:ro`,
  "-v",
  `${stateHost}:/state`,
  tag
]);

// eslint-disable-next-line no-console
console.log(`[docker] 已部署：name=${name} tag=${tag} port=${port}`);
// eslint-disable-next-line no-console
console.log(`[docker] 打开：http://localhost:${port}`);

