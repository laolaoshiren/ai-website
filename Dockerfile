# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

# ---- Production Stage ----
FROM node:20-alpine

LABEL org.opencontainers.image.source="https://github.com/laolaoshiren/ai-website"
LABEL org.opencontainers.image.description="AI 智能网站 - 完全由 AI 驱动的自动运营网站系统"
LABEL org.opencontainers.image.title="AI 智能网站"

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/config.js ./
COPY --from=builder /app/ai ./ai
COPY --from=builder /app/db ./db
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/scheduler ./scheduler
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public
COPY --from=builder /app/docker-entrypoint.sh ./

# Create data & logs dirs
RUN mkdir -p /app/data /app/logs /app/public/images && \
    chmod +x /app/docker-entrypoint.sh

# Data persisted via volume
VOLUME ["/app/data", "/app/logs"]

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
