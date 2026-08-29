# Kadem & Zetu School Management System — portable container build.
#
# Runs the Express backend (backend/server.js) and, by default, also serves
# the static frontend from the same process (SERVE_FRONTEND=true below), so
# the whole app runs from a single container on any host: a VPS, Fly.io,
# DigitalOcean App Platform, AWS/GCP/Azure, Railway, Render, etc.
#
# Works with ANY Postgres database — Railway, Render, Neon, Supabase,
# self-hosted, whatever you point DATABASE_URL at. No platform lock-in.
#
# Build:  docker build -t school-erp .
# Run:    docker run -p 5000:5000 --env-file backend/.env school-erp

FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies (backend only — frontend is static, no build step)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm install --workspace=backend --omit=dev --no-audit --no-fund

# ── Copy source
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=5000
ENV SERVE_FRONTEND=true

EXPOSE 5000

# Basic container healthcheck against the app's own /api/health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||5000)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "backend/server.js"]
