# 多阶段构建：构建期抓取最新数据，运行期仅用 nginx 提供静态服务
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY config ./config
COPY scripts ./scripts
RUN node scripts/fetch.mjs

FROM nginx:1.27-alpine
COPY --from=build /app/public /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://localhost/healthz >/dev/null 2>&1 || exit 1
