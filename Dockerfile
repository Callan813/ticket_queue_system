# ---- build stage: compile TypeScript and generate the Prisma client ----
FROM node:24-slim AS build
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage: only what's needed to run ----
FROM node:24-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY public ./public
COPY package.json ./
EXPOSE 3000
# Apply migrations, then start. Migrations are idempotent, so restarts are safe.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
