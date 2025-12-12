# AIP PDF Viewer（本地航图索引+浏览）

你给的数据目录结构（示例）：

- `.../2512naip/Terminal/<ICAO>/`：机场四字码目录，内部是 PDF 航图与 `Charts.csv`
- `.../2512naip/Terminal/Airports.csv`：机场 ICAO -> 中文名/管理局

本项目实现：

- **启动时扫描本地目录（支持嵌套）→ 写入 SQLite 索引（含 FTS 搜索）→ 启动 HTTP 服务**
- 前端页面：机场列表 + 目录树 + 搜索 + 点击内嵌查看 PDF

## 目录结构

- `packages/server`：Node.js( Fastify ) + TypeScript，负责扫描/索引/API/PDF 流式输出
- `packages/web`：React + Vite + TypeScript，负责 UI（树结构、搜索、预览）

## 运行（开发）

1) 安装依赖：

```bash
pnpm config set registry https://registry.npmjs.org
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

## 备注

- `Charts.csv`/`Airports.csv` 可能是 **GBK/GB18030** 编码，服务端会自动按该编码解码并入库，用于中文搜索与分组。
- 后端现在会 **先启动 HTTP**，然后在后台构建索引；索引未完成前，页面会展示进度条并暂时禁用树/搜索。


