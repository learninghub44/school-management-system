# Kadem & Zetu School Management System v4.3 — Deployment Guide

## Stack
- **Backend**: Node.js 18+ / Express — deployable to Docker/any VPS, Railway, Render, or Cloudflare Workers (pick one; see `README.md` → "Deploy Anywhere")
- **Database**: PostgreSQL — any provider. `backend/config/db.js` auto-detects Neon URLs for the optimized serverless client; every other Postgres (Railway, Render, Supabase, self-hosted) uses the standard `pg` driver
- **Frontend**: Static files — served by the same Express process (`SERVE_FRONTEND=true`), or separately by Cloudflare Pages/Netlify/nginx/anything that serves static files

This guide walks through one concrete path (Docker, self-contained). For Railway/Render/Cloudflare Workers specifics, see `railway.toml`, `render.yaml`, and `WORKERS_DEPLOY.md` respectively — the app code is identical across all of them.

---

## 1. Database Setup

Any Postgres works. Run `backend/cbc_schema.sql` against it (via `psql`, or your provider's SQL console) and copy the connection string for `DATABASE_URL`.

If you're using `docker compose up` (below), a local Postgres container is provisioned for you automatically — you can skip this step entirely for local/self-hosted use.

---

## 2. Backend Deployment

**Option A — Docker (works on any VPS/cloud, includes the frontend):**

```bash
cp backend/.env.example backend/.env   # fill in DATABASE_URL, JWT_SECRET, etc.
docker compose up -d --build
```

The app is now on `http://localhost:5000` (or your server's address) — API and frontend together, no CORS setup needed.

**Option B — Railway / Render (PaaS, no server management):**

Push to GitHub, connect the repo in the Railway or Render dashboard, and set the environment variables listed in `backend/.env.example`. Railway builds the root `Dockerfile`; Render runs `backend/` directly with `npm`. Both configs are already in this repo (`railway.toml`, `render.yaml`).

**Option C — Cloudflare Workers + Pages (edge deployment):**

See `WORKERS_DEPLOY.md`. Set `DATABASE_URL` as a Worker secret — it works with Neon or any other Postgres (see the comments in `wrangler.toml`).

Whichever option you pick, the environment variables are the same set:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Any Postgres connection string |
| `JWT_SECRET` | 64-char random string (`openssl rand -base64 48`) |
| `JWT_EXPIRES` | `10h` |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | Your frontend's URL(s), comma-separated |
| `PORT` | `5000` (Railway/Render override this automatically; fine to leave as-is) |

---

## 3. Create First Super Admin
Run this SQL against your database (replace the password hash):

```sql
-- Generate hash with: node -e "const b=require('bcryptjs'); b.hash('YourPassword123',12).then(console.log)"
INSERT INTO users (username, email, password_hash, name, role, must_change_password)
VALUES ('superadmin', 'admin@zetubusiness.com', '<bcrypt_hash>', 'System Administrator', 'SUPER_ADMIN', TRUE);
```

Then login at `/login.html` with:
- School Code: *(leave blank)*
- Username: `superadmin`
- Password: `YourPassword123`

---

## 4. First-Time Setup Flow
1. Super Admin logs in → registers schools
2. Super Admin creates Principal accounts for each school
3. Principal logs in (using School Code) → sets up:
   - Departments
   - Teachers
   - Classes (PP1 → Grade 9)
   - Teacher assignments
   - Fee structures (Bursar)
4. Begin recording attendance, assessments, payments

---

## Role Permissions Summary

| Feature | Super Admin | Principal | Dep. Principal | HOD | Teacher | Bursar |
|---------|-------------|-----------|----------------|-----|---------|--------|
| Register Schools | Yes | No | No | No | No | No |
| Create Staff | Yes | Yes | Yes | No | No | No |
| Manage Students | Yes | Yes | Yes | View | View | View |
| Manage Teachers | Yes | Yes | Yes | View | No | No |
| Manage Classes | Yes | Yes | Yes | View | No | No |
| Record Attendance | Yes | Yes | Yes | Yes | Own only | No |
| CBC Assessments | Yes | Yes | Yes | Yes | Own only | No |
| Fee Structures | Yes | No | No | No | No | Yes |
| Record Payments | Yes | No | No | No | No | Yes |
| View Finance | Yes | Yes | Yes | No | No | Yes |
| Report Cards | Yes | Yes | Yes | Yes | Yes | No |
| Audit Log | Yes | Yes | Yes | No | No | No |

---

## Security Notes
- All passwords are bcrypt-hashed (cost 12)
- JWT tokens are blocklisted on logout
- Accounts lock after 5 failed login attempts (15 min)
- All API routes enforce school_id isolation
- XSS-safe rendering (esc() on all dynamic HTML)
- Helmet security headers enabled
- Rate limiting: 10 login attempts / 15 min, 300 API calls / min
- Input validation via express-validator on all POST/PUT routes
