##
## 单容器镜像：同时包含后端（Fastify API/PDF）+ 前端静态站点（web/dist）
## - 构建阶段：pnpm install + build server/web
## - 运行阶段：仅安装 server 的生产依赖，并用 server 的 --serve-web 托管 web/dist
##

ARG NODE_IMAGE=node:20-bookworm-slim
ARG PNPM_VERSION=9.15.4
# npm/pnpm registry（用于 pnpm install 以及 corepack 下载 pnpm 本体）
ARG NPM_REGISTRY=https://registry.npmmirror.com
FROM ${NODE_IMAGE} AS build

WORKDIR /repo

# 启用 pnpm：显式 prepare，且允许通过 NPM_REGISTRY 覆盖 corepack 下载源
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# 先复制依赖元信息以最大化缓存命中
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/launcher/package.json packages/launcher/package.json

RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile

# 再复制源码并构建
COPY . .

RUN pnpm --filter @aip/server build
RUN pnpm --filter @aip/web build


FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
WORKDIR /app

ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# 安装 server 的生产依赖（只需要 workspace 元信息与 lockfile）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/package.json

RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile --prod --filter @aip/server...

# 拷贝构建产物
COPY --from=build /repo/packages/server/dist /app/packages/server/dist
COPY --from=build /repo/packages/web/dist /app/web

# 运行入口
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 13001

ENTRYPOINT ["/app/entrypoint.sh"]

