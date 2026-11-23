FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates restic && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts/data-snapshot.mjs scripts/backup-loop.mjs scripts/migration-check.mjs ./scripts/
ARG APP_BUILD=unknown
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data APP_BUILD=${APP_BUILD}
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
