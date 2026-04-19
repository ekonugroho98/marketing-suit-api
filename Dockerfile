FROM node:20-alpine

WORKDIR /app

# Install deps (cache-friendly)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY src ./src
COPY scripts ./scripts
COPY mcp ./mcp

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "src/server.js"]
