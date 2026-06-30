# Kadem & Zetu School Management System

Multi-tenant CBC (Competency Based Curriculum) school management system for Kenyan schools — built and maintained by [Zetu Business Solutions](https://github.com/learninghub44).

![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![Database](https://img.shields.io/badge/database-PostgreSQL%20(Neon)-336791?logo=postgresql&logoColor=white)
![Deploy](https://img.shields.io/badge/deploy-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)

A vanilla HTML/CSS/JS frontend backed by an Express API and PostgreSQL, supporting multiple independent schools on one deployment. Each school's data is fully isolated by `school_id`, with role-based dashboards for super admins, principals, teachers, and bursars.

<p align="center">
  <img src="docs/screenshots/landing.png" alt="Landing page" width="800">
</p>

> Screenshots above are placeholders — drop your own PNGs into `docs/screenshots/` using the filenames referenced in this README (`landing.png`, `login.png`, `school-admin.png`, `teacher.png`, `bursar.png`, `super-admin.png`) and they'll render here automatically on GitHub.

## Features

- **Multi-tenant by design** — every school's data is isolated by `school_id`, enforced server-side on every query, not just in the UI
- **Role-based dashboards** — super admin, principal/deputy/HOD, teacher, and bursar each get a purpose-built console
- **CBC-aligned academics** — class management, attendance, competency-based assessments, and report generation aligned to Kenya's CBC curriculum
- **Finance** — fee structures, payment tracking, balances, and Paystack-powered online payments with signature-verified webhooks
- **Self-service school registration** — new schools can sign up and pick a plan directly from the landing page
- **Hardened auth** — JWT sessions with a revocation blocklist, account lockout after repeated failed logins, timing-safe password checks, and Cloudflare Turnstile CAPTCHA on login/register
- **Audit logging** — key administrative actions are recorded for traceability

## Screenshots

| Landing | Login |
| --- | --- |
| ![Landing](docs/screenshots/landing.png) | ![Login](docs/screenshots/login.png) |

| School Admin | Teacher |
| --- | --- |
| ![School Admin](docs/screenshots/school-admin.png) | ![Teacher](docs/screenshots/teacher.png) |

| Bursar | Super Admin |
| --- | --- |
| ![Bursar](docs/screenshots/bursar.png) | ![Super Admin](docs/screenshots/super-admin.png) |

## Architecture

```text
frontend/                 Static browser app
  index.html              Landing page / school code entry
  login.html               JWT login via /api/auth/login
  register.html             Self-service school registration
  super-admin.html        System administrator console
  school-admin.html       Principal, deputy principal, and HOD console
  teacher.html            Teacher dashboard
  bursar.html             Finance dashboard
  js/api.js               Shared API client and session guard
  _worker.js               Cloudflare Worker proxying /api/* to the backend

backend/                  Express API
  server.js               App entrypoint and route mounting
  worker-entry.js          Cloudflare Workers entrypoint (production)
  config/db.js             PostgreSQL connection pool
  routes/                  Domain endpoints (auth, students, classes, finance, etc.)
  middleware/              Auth, role checks, tenant isolation, audit logging
  cbc_schema.sql           Database schema
```

**Production stack:** Cloudflare Workers (backend) + Cloudflare Pages (frontend) + Neon serverless PostgreSQL. See `WORKERS_DEPLOY.md` for the full deployment walkthrough; `DEPLOYMENT_GUIDE.md` and `SETUP.md` cover a Render-based alternative.

## Roles

| Role | Main Access |
| --- | --- |
| `SUPER_ADMIN` | Register schools, manage school users, view audit log |
| `PRINCIPAL` | Manage own school, staff, students, classes, attendance, assessments |
| `DEPUTY_PRINCIPAL` | Similar to principal within own school |
| `HOD` | Read school operations and record academic workflows |
| `TEACHER` | Teacher dashboard, attendance and CBC assessments |
| `BURSAR` | Fee structures, payments, balances, finance summaries |

Every tenant-owned table carries `school_id`. Non-super-admin users are locked to the `school_id` resolved from the database during JWT verification — `school_id` passed in a request body or query string is only ever trusted for `SUPER_ADMIN`.

## Quick Start (local development)

1. Create a PostgreSQL database, for example on [Neon](https://neon.tech).
2. Run `backend/cbc_schema.sql` in the SQL editor.
3. Run `backend/migration_post_schema.sql` — adds a few school-branding columns the app already depends on but that aren't in the base schema, plus recommended performance indexes. Idempotent, safe to re-run.

```bash
cd backend
cp .env.example .env
```

4. Fill in:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=<at least 32 chars, preferably 64+>
JWT_EXPIRES=10h
PORT=5000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5000,http://localhost:5500
```

5. Install and run:

```bash
npm install
npm run dev
```

The backend serves the frontend too, so the app is available at `http://localhost:5000`.

## Create First Super Admin

Generate a bcrypt hash:

```bash
cd backend
node -e "require('bcryptjs').hash('YourPassword123',12).then(console.log)"
```

Then run in PostgreSQL:

```sql
INSERT INTO users (username, email, password_hash, name, role, must_change_password, school_id)
VALUES ('superadmin', 'admin@yourschool.com', '<BCRYPT_HASH>', 'System Admin', 'SUPER_ADMIN', TRUE, NULL);
```

`school_id` must be `NULL` for `SUPER_ADMIN` — the schema's `super_admin_no_school` constraint rejects any other value.

Login at `/login.html?school=ADMIN100` with username `superadmin` and no school code entered in the form (or `ADMIN100`, which the backend treats as "no school" — see `backend/routes/auth.js`).

## Key API Endpoints

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/verify
POST   /api/auth/change-password

GET    /api/schools
POST   /api/schools
PATCH  /api/schools/:id/toggle

GET    /api/users
POST   /api/users
PUT    /api/users/:id
POST   /api/users/:id/reset-password
DELETE /api/users/:id

GET    /api/students
POST   /api/students
PUT    /api/students/:id
POST   /api/students/promote

GET    /api/classes
POST   /api/classes
GET    /api/classes/:id/students

GET    /api/attendance
POST   /api/attendance/bulk

GET    /api/assessments
POST   /api/assessments
GET    /api/assessments/report

GET    /api/finance/payments
POST   /api/finance/payments
GET    /api/finance/summary
GET    /api/finance/fee-structures
POST   /api/finance/fee-structures
```

## Deployment

### Option A — Cloudflare Workers + Pages (production)

See `WORKERS_DEPLOY.md` for the full walkthrough, including secrets setup for `DATABASE_URL`, `JWT_SECRET`, `PAYSTACK_SECRET_KEY`, and `TURNSTILE_SECRET_KEY`.

### Option B — Render (backend) + Cloudflare Pages (frontend)

Render backend:

```text
Root Directory: backend
Build Command: npm install
Start Command: node server.js
```

Required environment variables:

```text
DATABASE_URL
JWT_SECRET
JWT_EXPIRES
NODE_ENV
PORT
ALLOWED_ORIGINS
```

Cloudflare Pages frontend:

```text
Build command: none
Build output directory: frontend
Environment variable: BACKEND_URL=https://your-render-service.onrender.com
```

The Cloudflare worker in `frontend/_worker.js` proxies `/api/*` requests to `BACKEND_URL`.

## Security

- Tenant isolation enforced server-side on every route, not just the frontend
- Role escalation to `SUPER_ADMIN` is impossible via the API — the user-creation validator whitelists roles and excludes it entirely; the role only exists via direct DB seeding
- JWT sessions are revocation-checked against a blocklist on every request, with role/school-status re-fetched from the database (short cache, busted on logout)
- Account lockout and timing-safe password comparisons on login
- Paystack webhooks are signature-verified before being trusted
- Tiered rate limiting, stricter on auth endpoints
- Cloudflare Turnstile CAPTCHA on login and registration

Found a security issue? Please open a private report rather than a public issue.

## License

Licensed under the [Apache License 2.0](LICENSE).
