### 使用 BuildKit 才能启用 cache mount（大幅加速重复构建）
# syntax=docker/dockerfile:1.6

ARG NODE_IMAGE=public.ecr.aws/docker/library/node:20-bookworm
ARG NODE_IMAGE_RUNTIME=public.ecr.aws/docker/library/node:20-bookworm-slim

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# better-sqlite3 需要本地编译
RUN --mount=type=cache,target=/var/cache/apt \
  apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# pnpm store 缓存（跨构建复用下载/编译产物）
ENV PNPM_STORE_DIR=/pnpm/store

# 先复制依赖描述文件以利用缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN --mount=type=cache,target=/pnpm/store \
  pnpm install --frozen-lockfile --prefer-offline

# 再复制源码并构建
COPY . .
RUN pnpm --filter @aip/server --filter @aip/web -r build

# 生成最小化生产运行目录（只包含 server 的生产依赖 + dist）
RUN --mount=type=cache,target=/pnpm/store \
  pnpm --filter @aip/server deploy --prod /out/server

# ---- runtime ----
FROM ${NODE_IMAGE_RUNTIME} AS runtime

WORKDIR /app
ENV NODE_ENV=production

# 只拷贝运行所需内容（更小、更快）
COPY --from=builder /out/server /app/server
COPY --from=builder /app/packages/web/dist /app/web/dist

EXPOSE 13001

# 约定：
# - 航图根目录挂载到 /data/charts（只读）
# - 索引库写入 /data/state（可读写，建议用 volume）
ENV EAIP_ROOT=/data/charts
ENV EAIP_DB=/data/state/index.sqlite
ENV EAIP_FAV_DB=/data/state/favorites.sqlite

CMD ["node", "/app/server/dist/index.js", "--host", "0.0.0.0", "--port", "13001", "--serve-web", "--web-dist", "/app/web/dist"]


