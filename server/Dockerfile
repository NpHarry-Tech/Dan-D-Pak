FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

ARG BUILD_GIT_COMMIT=unknown
ARG BUILD_SOURCE_SHA256=unknown
ARG BUILD_TIME_UTC=unknown
LABEL org.opencontainers.image.title="Dan D Pak POS Server" \
      org.opencontainers.image.revision=$BUILD_GIT_COMMIT \
      org.opencontainers.image.created=$BUILD_TIME_UTC \
      io.dandpak.source-sha256=$BUILD_SOURCE_SHA256

# Cài sqlite3 CLI để backup + diagnostic
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 curl chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV REPORT_PDF_BROWSER=/usr/bin/chromium
ENV BUILD_GIT_COMMIT=$BUILD_GIT_COMMIT
ENV BUILD_SOURCE_SHA256=$BUILD_SOURCE_SHA256
ENV BUILD_TIME_UTC=$BUILD_TIME_UTC

# Copy dependency manifests trước để tận dụng Docker layer cache
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code (web/ cũ đã gỡ khỏi repo — client giờ là app Flutter native).
# LƯU Ý: server/assets/product-images bị gitignore (521MB ảnh SKU) nên KHÔNG
# nằm trong image — được mount qua volume app_product_images (compose) và seed
# bằng docker cp một lần; server/uploads cũng mount volume để không mất khi build.
COPY server ./server

# Thư mục data bền vững — sẽ được mount từ Docker volumes
RUN mkdir -p /app/server-data /app/storage /app/server/permanent-storage \
    /app/server/uploads /app/server/assets/product-images

EXPOSE 3000

# Healthcheck nội bộ container
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
