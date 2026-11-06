# 共页 v10 生产镜像（Node 22 含 node:sqlite；不打包 node_modules 与数据）
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_FILE=/data/production.sqlite

WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts：不执行任何依赖安装脚本；@napi-rs/canvas 走预编译可选依赖
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .

RUN useradd --system --uid 10001 --create-home gongye \
    && mkdir -p /data \
    && chown -R gongye:gongye /data /app
USER gongye
VOLUME ["/data"]
EXPOSE 8787

# 健康检查用内置 fetch，不额外装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
