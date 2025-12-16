# AIP PDF Viewer（本地航图索引+浏览）

你给的数据目录结构（示例）：

- `.../2512eaip/Terminal/<ICAO>/`：机场四字码目录，内部是 PDF 航图与 `Charts.csv`
- `.../2512eaip/Terminal/Airports.csv`：机场 ICAO -> 中文名/管理局

本项目实现：

- **启动时扫描本地目录（支持嵌套）→ 写入 SQLite 索引（含 FTS 搜索）→ 启动 HTTP 服务**
- 前端页面：机场列表 + 目录树 + 搜索 + 点击内嵌查看 PDF

## 目录结构

- `packages/server`：Node.js( Fastify ) + TypeScript，负责扫描/索引/API/PDF 流式输出
- `packages/web`：React + Vite + TypeScript，负责 UI（树结构、搜索、预览）

## 运行（开发）

1) 安装依赖：

```bash
pnpm config set registry https://registry.npmmirror.com
pnpm install
```

如果你仍然遇到 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`（本机 CA/代理导致），优先做法是把公司/系统 CA 配好；临时绕过可用：

```bash
pnpm config set strict-ssl false
```

2) 一条命令启动（先启动后端，health ok 后再启动前端；页面会显示“索引构建进度条”）：

```bash
pnpm dev -- --root "/xxx/xxx/eaip/20251201"
```

可选参数：

- `--api-port 13001`：后端端口（默认 13001）
- `--web-port 13002`：前端端口（默认 13002）
- 默认每次启动都会 **重建索引库**（等同于 `--rebuild-db`）
- `--no-rebuild-db`：跳过重建（复用旧索引库）
- `--no-wait-index`：不等待索引完成就启动前端（默认会等待索引完成）

示例：

```bash
pnpm dev -- --root "/xxx/xxx/eaip/20251201" --api-port 13001 --web-port 13002 --rebuild-db
```

打开：`http://localhost:13002`（或你指定的 `--web-port`）

### 局域网访问（默认已开启）

默认后端监听 `0.0.0.0:13001`，前端 dev 也会监听 `0.0.0.0:13002`，因此同一局域网内其它设备可访问：

- 前端：`http://<你的电脑局域网IP>:13002`
- 后端 API（可选）：`http://<你的电脑局域网IP>:13001/api/health`

### 如果前端一直显示“请稍候”

这通常表示前端没有连上后端 `/api/index/status`：

- 默认后端端口是 **13001**，Vite 代理也默认指向 `http://localhost:13001`
- 如果你改了后端端口，请用一键命令的 `--api-port`，或手动设置 `VITE_API_TARGET`

## 运行（生产）

```bash
pnpm -r build
pnpm --filter @aip/server start -- --root "/xxx/xxx/eaip/20251201" --port 3000
```

打开：`http://localhost:3000`

## 打包 Windows 便携版（无安装、无 Electron）

会生成一个 zip：解压后双击 `aip-launcher.exe`，它会通过内置 Node 启动后端并自动打开浏览器。

建议在 **Windows x64** 上执行打包。

```bash
pnpm install
pnpm dist:win
```

产物：`packages/launcher/dist-win/AIP-PDF-Viewer-win-x64.zip`

说明：双击 `aip-launcher.exe` 后**每次都会询问航图根目录**（会显示上次记录，回车可复用）。如需跳过询问，可用命令行传 `--root <path>` 或设置环境变量 `AIP_ROOT`。

收藏/索引数据库位置（Windows 便携版）：

- 索引库（可重建）：`%LocalAppData%\aip-pdf-viewer\index.sqlite`
- 收藏库（需保留）：`<exe同级>\data\favorites.sqlite`

## mac / Windows 同构运行方式（推荐）

- **mac**：推荐使用 `packages/desktop`（Electron）启动，它会在本机启动后端并打开内置窗口（不依赖 Docker）。
- **Windows**：推荐使用 `packages/launcher` 生成的 `aip-launcher.exe`（便携版），它会在本机启动后端并打开默认浏览器。

## Docker（生产/局域网部署：前后端同一个容器）

这个镜像会在一个进程里同时提供：

- `GET /api/*`：后端 API/PDF
- `GET /`：前端静态站点（`packages/web/dist`）

### 一键重新构建 & 部署（推荐）

需要你提供宿主机的航图根目录（只读挂载），以及一个用于保存索引/收藏数据库的目录（可写挂载）。

```bash
pnpm docker:redeploy -- --root "/xxx/xxx/eaip/20251201"
```

如果你本机 Docker 配了某些镜像加速器导致拉取 `node:20-bookworm-slim` 失败（例如 403），可以覆盖基础镜像：

```bash
# 方式1：在 redeploy 时指定
pnpm docker:redeploy -- --root "/xxx/xxx/eaip/20251201" --node-image "node:20-bullseye-slim"

# 方式2：仅 build 时指定（再手动 docker run 或继续用 redeploy）
pnpm docker:build -- --build-arg NODE_IMAGE="node:20-bullseye-slim"
```

注意：`better-sqlite3` 是原生模块，**不要用 Alpine(musl) 的 node 镜像**，优先使用 Debian/Ubuntu 系列的 `*-slim`。

如果你在 Docker build 里遇到 **corepack 下载 pnpm** 或 **pnpm install 拉依赖** 失败（网络/代理/被拦），可以把 registry 指到你能访问的镜像源：

```bash
pnpm docker:redeploy -- --root "/xxx/xxx/eaip/20251201" --npm-registry "https://registry.npmmirror.com"
```

（它会同时影响 corepack 下载 pnpm 本体和 pnpm 安装依赖。）

### 遇到索引库损坏（SqliteError: database disk image is malformed）

索引库（`index.sqlite`）是可重建的；收藏库（`favorites.sqlite`）应尽量保留。

你可以一键强制重建索引库（会删掉 `/state/index.sqlite*` 并重建）：

```bash
pnpm docker:redeploy -- --root "/xxx/xxx/eaip/20251201" --rebuild-db
```

默认：

- 宿主机端口：`13001`（可用 `--port 3000` 改）
- 容器名：`eaip-pdf-viewer`
- 镜像 tag：`eaip-pdf-viewer:local`
- 状态目录：`.data/docker-state`（会被挂载到容器 `/state`）

部署后打开：`http://localhost:13001`

### 仅构建镜像

```bash
pnpm docker:build
```

### 统一“产物选择”入口（windows / docker 二选一）

```bash
# Windows 便携版（线上流程，不改动）
pnpm dist:win

# Docker 产物（额外新增）
pnpm docker:build
```

## 备注

- `Charts.csv`/`Airports.csv` 可能是 **GBK/GB18030** 编码，服务端会自动按该编码解码并入库，用于中文搜索与分组。
- 后端现在会 **先启动 HTTP**，然后在后台构建索引；索引未完成前，页面会展示进度条并暂时禁用树/搜索。


