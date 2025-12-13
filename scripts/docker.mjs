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

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function runIgnore(cmd, args) {
  spawnSync(cmd, args, { stdio: "ignore" });
}

const args = parseArgs(process.argv.slice(2));

const shouldRun = Boolean(args.run);
const detach = Boolean(args.detach);
const containerName = String(args.name || process.env.EAIP_CONTAINER_NAME || "charts-viewer");
const rootHost = args.root || process.env.EAIP_ROOT_HOST;
if (shouldRun && !rootHost) {
  console.error('运行容器时必须提供 --root "<航图根目录>"，或设置 EAIP_ROOT_HOST');
  console.error('示例：pnpm docker:mac -- --run --root "/xxx/xxx/eaip/20251201"');
  process.exit(1);
}

const registry = String(args.registry || process.env.EAIP_DOCKER_REGISTRY || "").trim();
const defaultImageName = "charts-viewer:local";
// 重要：--registry 只用于“我们自己的镜像”tag，不假设 registry 里存在 library/node 等基础镜像
const image = String(args.image || process.env.EAIP_DOCKER_IMAGE || (registry ? `${registry}/${defaultImageName}` : defaultImageName));
const port = Number(args.port || process.env.EAIP_PORT || 13001);
const nodeImage = String(
  args["node-image"] ||
    process.env.EAIP_NODE_IMAGE ||
    "public.ecr.aws/docker/library/node:20-bookworm"
);
const nodeImageRuntime = String(
  args["node-image-runtime"] ||
    process.env.EAIP_NODE_IMAGE_RUNTIME ||
    "public.ecr.aws/docker/library/node:20-bookworm-slim"
);

// SQLite 在 mac 的 bind mount（尤其是 WAL）上更容易出现损坏；
// 默认改用 Docker volume 来存放索引库（更稳定）。如需用本机目录，显式传 --state-host。
const stateHost = String(args["state-host"] || process.env.EAIP_STATE_HOST || "");
const stateVolume = String(args["state-volume"] || process.env.EAIP_STATE_VOLUME || "charts-viewer-state");
const stateMountArgs = stateHost
  ? ["-v", `${path.resolve(stateHost)}:/data/state`]
  : ["-v", `${stateVolume}:/data/state`];

run("docker", [
  "build",
  "-t",
  image,
  // 强制开启 BuildKit（用于 Dockerfile cache mount）
  // 注：这是 build arg 环境变量方式的替代；用户环境已开启也不冲突
  "--progress=auto",
  "--build-arg",
  `NODE_IMAGE=${nodeImage}`,
  "--build-arg",
  `NODE_IMAGE_RUNTIME=${nodeImageRuntime}`,
  "."
]);

// 默认只构建镜像；需要运行时显式传 --run
if (shouldRun) {
  if (detach) {
    // 如果同名容器已存在/在跑，先强制移除，避免启动失败
    runIgnore("docker", ["rm", "-f", containerName]);
    run("docker", [
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "-p",
      `${port}:13001`,
      "-e",
      "EAIP_ROOT=/data/charts",
      "-e",
      "EAIP_DB=/data/state/index.sqlite",
      "-e",
      "EAIP_FAV_DB=/data/state/favorites.sqlite",
      "-v",
      `${rootHost}:/data/charts:ro`,
      ...stateMountArgs,
      image
    ]);
    console.log(`[docker] 已后台启动：${containerName} -> http://localhost:${port}`);
    console.log(`[docker] 查看日志：docker logs -f ${containerName}`);
    console.log(`[docker] 停止：docker stop ${containerName}`);
  } else {
    run("docker", [
      "run",
      "--rm",
      "-it",
      "-p",
      `${port}:13001`,
      "-e",
      "EAIP_ROOT=/data/charts",
      "-e",
      "EAIP_DB=/data/state/index.sqlite",
      "-e",
      "EAIP_FAV_DB=/data/state/favorites.sqlite",
      "-v",
      `${rootHost}:/data/charts:ro`,
      ...stateMountArgs,
      image
    ]);
  }
}


