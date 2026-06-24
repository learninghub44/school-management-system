# Kadem & Zetu School Management System — Deployment Setup

## Architecture
```
cbc-school-erp.pages.dev  (Cloudflare Pages — frontend)
         │
         │ /api/* proxied via _worker.js
         ▼
YOUR-SERVICE.onrender.com  (Render — Node.js backend)
         │
         ▼
Supabase PostgreSQL (database)
```

---

## Step 1 — Deploy Backend on Render

1. Connect your GitHub repo to Render
2. Create a **Web Service**:
   - Root directory: `backend`
   - Build: `npm install`
   - Start: `node server.js`
3. Add environment variables:
   | Key | Value |
   |-----|-------|
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `DATABASE_URL` | Your Supabase connection string |
   | `JWT_SECRET` | Random 64-char string (run: `openssl rand -base64 48`) |
   | `JWT_EXPIRES` | `10h` |
   | `ALLOWED_ORIGINS` | `https://cbc-school-erp.pages.dev` |

4. **Note your Render service URL** — looks like:
   `https://cbc-school-erp-api-xxxx.onrender.com`

---

## Step 2 — Run the Database Schema

In Supabase SQL Editor, run the contents of `backend/cbc_schema.sql`

Then create the first Super Admin:
```sql
-- First generate a bcrypt hash:
-- node -e "require('bcryptjs').hash('YourPassword123',12).then(console.log)"

INSERT INTO users (username, email, password_hash, name, role, must_change_password)
VALUES ('superadmin', 'admin@yourschool.com', '<BCRYPT_HASH>', 'System Admin', 'SUPER_ADMIN', TRUE);
```

---

## Step 3 — Deploy Frontend on Cloudflare Pages

1. Connect your GitHub repo to Cloudflare Pages
2. Settings:
   - Build command: *(leave blank — static files)*
   - Build output directory: `frontend`
3. **Add Environment Variable:**
   | Key | Value |
   |-----|-------|
   | `BACKEND_URL` | `https://cbc-school-erp-api-xxxx.onrender.com` |

   Important: This is the critical step — replace `xxxx` with your actual Render URL

4. Deploy (trigger a new deployment after adding the env var)

---

## Step 4 — Verify

Visit `https://cbc-school-erp.pages.dev/login.html`

- Leave School Code blank → login as Super Admin
- Username: `superadmin`
- Password: `YourPassword123`

---

## Why "Network error" happens

The frontend (`cbc-school-erp.pages.dev`) calls `/api/auth/login`.
The `_worker.js` intercepts this and proxies it to your `BACKEND_URL`.
If `BACKEND_URL` is not set in Cloudflare Pages env vars → 503 error.
If `BACKEND_URL` is wrong → 502 error.

**Fix: Set `BACKEND_URL` in Cloudflare Pages → Settings → Environment Variables**
