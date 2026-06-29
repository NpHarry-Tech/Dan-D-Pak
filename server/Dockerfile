FROM node:22-bookworm-slim

# CÃ i sqlite3 CLI Ä‘á»ƒ backup + diagnostic
RUN apt-get update && apt-get install -y sqlite3 curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Copy dependency manifests trÆ°á»›c Ä‘á»ƒ táº­n dá»¥ng Docker layer cache
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend source code
COPY server ./server

# ThÆ° má»¥c data bá»n vá»¯ng â€” sáº½ Ä‘Æ°á»£c mount tá»« Docker volumes
RUN mkdir -p /app/server-data /app/storage /app/server/permanent-storage /app/server/uploads

EXPOSE 3000

# Healthcheck ná»™i bá»™ container
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

