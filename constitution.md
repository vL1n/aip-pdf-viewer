# AIP PDF Viewer 项目架构说明

## 项目概览

**AIP PDF Viewer** 是一个本地航图索引与浏览系统，用于扫描本地航图 PDF 文件目录，构建 SQLite 索引（含 FTS5 全文搜索），并提供 Web 界面进行浏览和搜索。

### 核心功能

- 启动时扫描本地目录（支持嵌套）→ 写入 SQLite 索引（含 FTS 搜索）→ 启动 HTTP 服务
- 前端页面：机场列表 + 目录树 + 搜索 + 收藏 + 点击内嵌查看 PDF

---

## 技术栈

| 层面 | 技术 |
|------|------|
| **后端** | Node.js + TypeScript + Fastify + better-sqlite3 |
| **前端** | React 18 + TypeScript + Vite + Ant Design + react-pdf-viewer |
| **数据库** | SQLite (WAL 模式) + FTS5 全文搜索 |
| **桌面端** | Electron (macOS) / C# Launcher (Windows) |
| **容器化** | Docker (单容器：后端 + 前端静态托管) |
| **包管理** | pnpm (Monorepo Workspace) |

---

## 项目目录结构

```
naip-pdf-viewer/
├── package.json                 # 根 package.json (workspace scripts)
├── pnpm-workspace.yaml          # pnpm workspace 配置
├── tsconfig.base.json           # TypeScript 基础配置
├── Dockerfile                   # Docker 构建配置
├── docker/
│   └── entrypoint.sh            # Docker 容器入口脚本
├── scripts/
│   ├── dev.mjs                  # 开发环境启动脚本 (一键启动前后端)
│   └── docker-redeploy.mjs      # Docker 部署脚本
└── packages/
    ├── server/                  # 后端 Node.js 服务
    ├── web/                     # 前端 React 应用
    ├── desktop/                 # Electron 桌面应用 (macOS)
    └── launcher/                # Windows 便携版启动器 (C#)
```

---

## 后端架构 (`packages/server`)

### 技术栈

- **Fastify**: 高性能 HTTP 框架
- **better-sqlite3**: 同步 SQLite 客户端 (原生模块)
- **iconv-lite**: GBK/GB18030 编码解码
- **csv-parse**: CSV 文件解析
- **commander**: CLI 参数解析
- **zod**: 数据验证

### 目录结构

```
packages/server/
├── src/
│   ├── index.ts          # 入口：CLI 解析、启动服务、触发索引
│   ├── server.ts         # Fastify 服务定义 (RESTful API)
│   ├── sqlite.ts         # SQLite 数据库初始化与 Schema
│   ├── indexManager.ts   # 索引状态管理 (含 SSE 推送)
│   ├── indexer.ts        # 批量写入索引
│   ├── scan.ts           # 目录扫描、PDF/CSV 解析
│   ├── csv.ts            # CSV 文件读取 (支持 GBK)
│   ├── tree.ts           # 目录树构建
│   └── types.ts          # 类型定义
├── dist/                 # TypeScript 编译产物
├── package.json
└── tsconfig.json
```

### 数据模型

#### 索引库 (`index.sqlite`)

| 表名 | 说明 |
|------|------|
| `airports` | 机场信息表 (icao, name, bureau) |
| `files` | PDF 文件索引表 (路径、元数据、chartType 等) |
| `files_fts` | FTS5 虚拟表 (全文搜索) |

#### 收藏库 (`favorites.sqlite`)

| 表名 | 说明 |
|------|------|
| `favorites` | 用户收藏记录 (rel_path, icao, created_at_ms) |

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/index/status` | GET | 获取索引构建状态 |
| `/api/index/stream` | GET | SSE 实时索引状态推送 |
| `/api/index/rebuild` | POST | 触发索引重建 |
| `/api/airports` | GET | 获取机场列表 |
| `/api/tree?icao=XXXX` | GET | 获取指定机场的目录树 |
| `/api/search?q=xxx` | GET | 全文搜索 (FTS + LIKE) |
| `/api/file/:id` | GET | 获取文件元数据 |
| `/api/pdf/:id` | GET | 流式输出 PDF 文件 (支持 Range) |
| `/api/favorites/*` | GET/POST | 收藏管理 (添加/移除/导入/导出) |

### 索引流程

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   counting   │ -> │   scanning   │ -> │   writing    │ -> │    ready     │
│  统计PDF数量  │    │ 扫描并解析元数据│    │ 写入SQLite   │    │   索引完成    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

- 支持 SSE 实时推送进度
- 前端显示"索引构建进度条"

---

## 前端架构 (`packages/web`)

### 技术栈

- **React 18**: UI 框架
- **Vite 6**: 构建工具
- **Ant Design 5**: UI 组件库
- **@react-pdf-viewer**: PDF 渲染
- **pdfjs-dist**: PDF.js 底层库

### 目录结构

```
packages/web/
├── src/
│   ├── main.tsx               # 入口
│   ├── App.tsx                # 主应用组件
│   ├── api.ts                 # API 请求封装
│   ├── styles.css             # 全局样式
│   ├── pdfjs-dist-shim.ts     # PDF.js 兼容层
│   ├── components/
│   │   ├── AirportGate.tsx    # 机场选择页面
│   │   ├── AppHeader.tsx      # 顶部导航栏
│   │   ├── IndexStatusBar.tsx # 索引进度条
│   │   ├── SidebarPanel.tsx   # 侧边栏 (目录树/搜索)
│   │   └── PdfViewerPanel.tsx # PDF 预览面板
│   ├── hooks/
│   │   └── useThemeMode.ts    # 主题模式 Hook
│   └── selectors/
│       └── sidebar.tsx        # 侧边栏数据处理
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

### 页面流程

```
┌─────────────────────────────────────────────────────────────┐
│                     IndexStatusBar                          │
│                  (索引进度条，索引完成后隐藏)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                        │
│  │  AirportGate    │  <- 首次进入：选择机场 (查看/航线模式)     │
│  └─────────────────┘                                        │
│                                                             │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                      │
│   SidebarPanel       │        PdfViewerPanel                │
│   ├─ 机场切换         │        ├─ PDF 渲染                    │
│   ├─ 视图模式(全部/收藏)│        └─ 支持缩放/翻页               │
│   ├─ 分类筛选         │                                      │
│   └─ 目录树          │                                       │
│                      │                                      │
├──────────────────────┴──────────────────────────────────────┤
│                     AppHeader                               │
│   (机场导航 / 打开新窗口 / 收藏导入导出 / 主题切换)              │
└─────────────────────────────────────────────────────────────┘
```

### 开发模式代理

```typescript
// vite.config.ts
server: {
  proxy: {
    "/api": {
      target: process.env.VITE_API_TARGET || "http://localhost:13001",
      changeOrigin: true
    }
  }
}
```

---

## 桌面端架构

### macOS: Electron (`packages/desktop`)

- 使用 Electron 打包
- 内置后端服务，启动时自动打开内置浏览器窗口
- 支持选择航图目录，配置持久化

```
packages/desktop/
├── src/
│   └── main.ts              # Electron 主进程
├── resources/
│   ├── server/              # 后端构建产物
│   └── web/                 # 前端构建产物
├── scripts/
│   └── copy-resources.mjs   # 资源复制脚本
└── package.json
```

### Windows: C# Launcher (`packages/launcher`)

- 使用 .NET 8 编写的便携版启动器
- 内置 Node.js runtime
- 启动后端服务，自动打开默认浏览器

```
packages/launcher/
├── src/
│   └── AipLauncher/
│       ├── Program.cs       # C# 启动器主程序
│       └── AipLauncher.csproj
└── scripts/
    └── dist-win.ps1         # Windows 打包脚本
```

---

## Docker 部署架构

### 构建流程

```dockerfile
# 多阶段构建
FROM node:20-bookworm-slim AS build
  → pnpm install
  → pnpm build (server + web)

FROM node:20-bookworm-slim AS runtime
  → 仅安装 server 生产依赖
  → 复制 server/dist + web/dist
  → 启动时通过 --serve-web 托管前端
```

### 目录挂载

| 容器路径 | 说明 |
|----------|------|
| `/data` (只读) | 航图 PDF 根目录 |
| `/state` | 索引库/收藏库持久化目录 |

### 运行模式

```bash
# 单容器同时提供：
# - GET /api/*     后端 API
# - GET /          前端静态站点
docker run -v /path/to/eaip:/data:ro \
           -v ./state:/state \
           -p 13001:13001 \
           eaip-pdf-viewer:local
```

---

## 开发命令

### 一键开发

```bash
pnpm dev -- --root "/path/to/eaip"
```

- 自动启动后端 (port 13001)
- 等待索引完成后启动前端 (port 13002)
- 支持参数：`--api-port`, `--web-port`, `--no-rebuild-db`, `--no-wait-index`

### 构建

```bash
pnpm build                    # 构建所有包
pnpm dist:win                 # 打包 Windows 便携版
pnpm docker:build             # 构建 Docker 镜像
pnpm docker:redeploy          # 一键部署 Docker
```

---

## 数据流架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             用户浏览器                                   │
│                         (React + Ant Design)                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP / SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Fastify HTTP Server                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ /api/tree  │  │ /api/search│  │ /api/pdf/* │  │ /api/index/stream  │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │ index.sqlite│  │favorites.   │  │  PDF Files  │
            │ (FTS5索引)   │  │  sqlite     │  │ (本地目录)   │
            └─────────────┘  └─────────────┘  └─────────────┘
```

---

## 端口配置

| 端口 | 用途 | 说明 |
|------|------|------|
| 13001 | 后端 API | 默认后端端口 |
| 13002 | 前端 Dev | 开发模式前端端口 |

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `AIP_ROOT` / `EAIP_ROOT` | 航图 PDF 根目录 |
| `AIP_DB` / `EAIP_DB` | 索引库路径 |
| `AIP_FAV_DB` / `EAIP_FAV_DB` | 收藏库路径 |
| `PORT` | 后端端口 |
| `HOST` | 监听地址 |
| `VITE_API_TARGET` | 前端代理目标 |

---

## 核心依赖

### 后端

| 包名 | 版本 | 用途 |
|------|------|------|
| fastify | ^5.2.1 | HTTP 服务框架 |
| @fastify/static | ^8.2.0 | 静态文件托管 |
| better-sqlite3 | ^11.7.0 | SQLite 数据库 |
| csv-parse | ^5.6.0 | CSV 解析 |
| iconv-lite | ^0.6.3 | 编码转换 |
| commander | ^12.1.0 | CLI 参数解析 |
| zod | ^3.23.8 | 数据验证 |

### 前端

| 包名 | 版本 | 用途 |
|------|------|------|
| react | ^18.3.1 | UI 框架 |
| antd | ^5.22.7 | UI 组件库 |
| @react-pdf-viewer/core | ^3.12.0 | PDF 渲染 |
| pdfjs-dist | ^4.10.38 | PDF.js |
| vite | ^6.0.5 | 构建工具 |

---

## 文件编码说明

- `Charts.csv` / `Airports.csv` 可能是 **GBK/GB18030** 编码
- 服务端会自动按该编码解码并入库，用于中文搜索与分组
- 使用 `iconv-lite` 进行编码转换

---

## 总结

本项目是一个典型的 **Monorepo + 全栈** 架构：

1. **后端** (Fastify + SQLite) 负责目录扫描、索引构建、API 服务
2. **前端** (React + Vite) 负责用户界面、PDF 预览
3. **桌面端** (Electron/C# Launcher) 提供跨平台独立运行能力
4. **Docker** 提供容器化部署方案

项目采用 pnpm workspace 管理多包依赖，TypeScript 保证类型安全，支持开发/生产/Docker 多种运行模式。
