# Kadem & Zetu School Management System

Multi-tenant school management system for Kenya's Competency Based Curriculum (CBC).

The current application is a vanilla HTML/CSS/JS frontend backed by an Express API and PostgreSQL. Supabase is used as the hosted PostgreSQL provider, but the active authentication flow is the backend JWT flow, not Supabase Auth.

## Architecture

```text
frontend/                 Static browser app
  index.html              School code entry
  login.html              JWT login via /api/auth/login
  super-admin.html        System administrator console
  school-admin.html       Principal, deputy principal, and HOD console
  teacher.html            Teacher dashboard
  bursar.html             Finance dashboard
  js/api.js               Shared API client and session guard

backend/                  Express API
  server.js               App entrypoint and route mounting
  config/db.js            PostgreSQL pool
  routes/                 Domain endpoints
  middleware/             Auth, roles, tenant checks, audit logging
  cbc_schema.sql          Database schema
```

## Roles

| Role | Main Access |
| --- | --- |
| `SUPER_ADMIN` | Register schools, manage school users, view audit log |
| `PRINCIPAL` | Manage own school, staff, students, classes, attendance, assessments |
| `DEPUTY_PRINCIPAL` | Similar to principal within own school |
| `HOD` | Read school operations and record academic workflows |
| `TEACHER` | Teacher dashboard, attendance and CBC assessments |
| `BURSAR` | Fee structures, payments, balances, finance summaries |

Every tenant-owned table carries `school_id`. Non-super-admin users are locked to the `school_id` fetched from the database during JWT verification.

## Quick Start

1. Create a PostgreSQL database, for example on Supabase.
2. Run `backend/cbc_schema.sql` in the SQL editor.
3. Create a backend env file:

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
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5500
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
INSERT INTO users (username, email, password_hash, name, role, must_change_password)
VALUES ('superadmin', 'admin@yourschool.com', '<BCRYPT_HASH>', 'System Admin', 'SUPER_ADMIN', TRUE);
```

Login at `/login.html?school=ADMIN` with username `superadmin`.

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
