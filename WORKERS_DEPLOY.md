# Deployment Guide — Cloudflare Workers + Neon

## Architecture

```
Browser → Cloudflare Pages (static HTML/JS/CSS)
              └─ _worker.js proxies /api/* →
                    Cloudflare Workers (Express backend)
                          └─ Neon Postgres (database)
```

## 1. Neon Database Setup

1. Create a project at https://neon.tech
2. Copy the **pooled connection string** (not direct) — looks like:
   ```
   postgresql://user:pass@ep-xxx-yyy.us-east-2.aws.neon.tech/dbname?sslmode=require
   ```
3. Run the schema: open Neon SQL Editor → paste contents of `backend/cbc_schema.sql` → Run

## 2. Deploy Backend to Cloudflare Workers

```bash
cd backend
npm install
```

### Set secrets (run each command, paste value when prompted):
```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put DATABASE_URL          # Neon pooled connection string
npx wrangler secret put ALLOWED_ORIGINS       # https://cbc-school-erp.pages.dev
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put GROQ_API_KEY
```

### Deploy:
```bash
npm run deploy
# or: npx wrangler deploy
```

Your Worker URL will be: `https://cbc-school-erp-api.<your-subdomain>.workers.dev`

## 3. Configure Cloudflare Pages (frontend)

In Cloudflare Dashboard → Pages → cbc-school-erp → Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `BACKEND_URL` | `https://cbc-school-erp-api.<your-subdomain>.workers.dev` |

Redeploy Pages after setting the variable (or trigger via: Pages → Deployments → Retry).

## 4. Update ALLOWED_ORIGINS on the Worker

After Pages is deployed, update the ALLOWED_ORIGINS secret to include your actual Pages domain:
```bash
npx wrangler secret put ALLOWED_ORIGINS
# Enter: https://cbc-school-erp.pages.dev
```

## 5. Verify

- Health check: `https://cbc-school-erp-api.<subdomain>.workers.dev/api/health`
- Should return: `{"status":"ok","db":"ok",...}`

## Local Development

```bash
# Backend (local Node.js)
cd backend
cp .env.example .env   # fill in DATABASE_URL (Neon URL works locally too)
npm run dev

# Frontend: open frontend/login.html in browser
# API calls go to /api which falls back to localhost:5000 in api.js
```

## Notes

- Background jobs (`cleanupTokens`, `sweepExpiredSubscriptions`) don't run in Workers
  (Workers are stateless/short-lived). Set up a Cron Trigger in `wrangler.toml` if needed,
  or use Neon's scheduled queries feature.
- Workers have a 10ms CPU time limit on free plan; paid plan is 30s. AI routes may need paid plan.
- The `pg` driver works in Workers via `nodejs_compat`. No driver swap needed.
