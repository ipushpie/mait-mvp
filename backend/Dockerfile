# ── Build stage ──
FROM node:24-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=optional

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ── Runtime stage ──
# Ubuntu 24.04 (glibc 2.39) required — Kreuzberg native binary needs glibc >= 2.38.
# node:24-slim is Debian 12 (glibc 2.36) which is incompatible.
FROM ubuntu:24.04
WORKDIR /app

# Copy Node.js runtime from official image
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --include=optional

# Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Application code
COPY --from=builder /app/dist ./dist
COPY src/data ./dist/data
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 8000
CMD ["./entrypoint.sh"]
