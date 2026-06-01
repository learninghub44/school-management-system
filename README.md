# 🎓 CBC School ERP — Multi-Tenant

A full-stack, multi-tenant school management system for Kenya's **Competency Based Curriculum (CBC)**. Built with **Vanilla HTML/CSS/JS** frontend and **Express.js + Supabase** backend.

---

## 🏗 Architecture

```
CBC School ERP
├── frontend/               Vanilla HTML/CSS/JS (deploy to Cloudflare Pages / Netlify)
│   ├── login.html          Universal login (routes by role)
│   ├── super-admin.html    Super Admin console
│   ├── school-admin.html   School Admin dashboard
│   ├── dashboard.html      Teacher / Finance staff dashboard
│   └── js/api.js           Unified API client
│
└── backend/                Express.js API (deploy to Render)
    ├── server.js
    ├── routes/
    │   ├── auth.js         Login, verify, change-password
    │   ├── schools.js      CRUD schools + create school admins
    │   ├── users.js        CRUD users (school-scoped)
    │   ├── students.js     CRUD students
    │   ├── teachers.js     CRUD teachers
    │   ├── finance.js      Payments + fee structures
    │   ├── attendance.js   Mark + view attendance
    │   └── assessments.js  CBC assessments (EE/ME/AE/BE)
    ├── middleware/
    │   ├── authMiddleware.js        JWT verification
    │   ├── roleMiddleware.js        Role guard
    │   └── schoolScopeMiddleware.js Tenant isolation
    ├
    ├── scripts/
    │   └── seed-super-admin.
    └── cbc_schema.sql
```

---

## 👥 Roles & Access

| Role          | Created By   | Access                                        |
|---------------|--------------|-----------------------------------------------|
| `SUPER_ADMIN` | Seed script  | All schools, create schools, create admins    |
| `SCHOOL_ADMIN`| Super Admin  | Own school only — full CRUD on all modules    |
| `TEACHER`     | School Admin | Students, attendance, CBC assessments         |
| `FINANCE`     | School Admin | Payment records, fee structures               |
| `STUDENT`     | School Admin | Student portal (read-only)                    |
| `PARENT`      | School Admin | Parent portal (read-only)                     |

---

## 🔐 Multi-Tenancy

Every table (students, teachers, payments, attendance, assessments) has a `school_id` column. The `schoolScopeMiddleware` enforces that:

- Non-SUPER_ADMIN users can **only read/write their own school's data**
- SUPER_ADMIN can pass `?school_id=xxx` to operate on any school
- Supabase RLS policies add a second layer of protection at the database level

---

## 🚀 Quick Start

### 1. Supabase Setup

1. Create a new Supabase project
2. Run `backend/cbc_schema.sql` in the SQL editor (drops and recreates all tables)
3. Copy your **Project URL** and **service_role key** from Project Settings → API

### 2. Backend (.env)

```bash
cd backend
cp .env.example .env
# Fill in all values in .env
npm install
```

### 3. Seed Super Admin

```bash
# Edit scripts/seed-super-admin.js — change email & password first!
node scripts/seed-super-admin.js
```

### 4. Run locally

```bash
# Backend
cd backend && npm run dev    # http://localhost:5000

# Frontend — serve with any static server
npx serve frontend           # http://localhost:3000
```

---

## ☁️ Deployment

### Backend → Render

1. Push to GitHub
2. New Web Service → connect repo
3. Root Directory: `backend`
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Add all env vars from `.env.example`

### Frontend → Cloudflare Pages / Netlify

1. Set `window.API_BASE_URL` in your frontend or use a `config.js`:

```html
<!-- Add before any script tags in each HTML file -->
<script>window.API_BASE_URL = "https://your-api.onrender.com/api";</script>
```

2. Deploy the `frontend/` folder as a static site

---

## 🏫 Workflow: Adding a School

```
Super Admin logs in → super-admin.html
  └── Creates School (name, unique school code, county)
  └── Adds School Admin (email, password) for that school

School Admin logs in → school-admin.html
  └── Adds Students
  └── Adds Teachers
  └── Creates staff accounts (TEACHER, FINANCE roles)
  └── Records fee structures and payments
  └── Views attendance and assessments

Teacher logs in → dashboard.html
  └── Views their school's students
  └── Marks daily attendance
  └── Records CBC assessments (EE/ME/AE/BE)

Finance staff logs in → dashboard.html
  └── Records payments
  └── Views payment history
```

---

## 📊 CBC Grading System

| Grade | Meaning               |
|-------|-----------------------|
| EE    | Exceeds Expectation   |
| ME    | Meets Expectation     |
| AE    | Approaches Expectation|
| BE    | Below Expectation     |

---

## 🔑 Key Environment Variables

| Variable                  | Description                         |
|---------------------------|-------------------------------------|
| `PORT`                    | Server port (default 5000)          |
| `JWT_SECRET`              | Min 64-char random string           |
| `JWT_EXPIRE`              | Token expiry e.g. `7d`              |       |
    |
| `CORS_ORIGIN`             | Comma-separated allowed origins     |

---

## 📡 API Reference (Key Endpoints)

```
POST   /api/auth/login                   Login (all roles)
GET    /api/auth/me                      Get current user

GET    /api/schools                      List schools
POST   /api/schools                      Create school (SUPER_ADMIN)
POST   /api/schools/:id/admin            Add school admin (SUPER_ADMIN)
GET    /api/schools/:id/stats            School stats

GET    /api/users                        List users (school-scoped)
POST   /api/users                        Create user
PUT    /api/users/:id                    Update user
DELETE /api/users/:id                    Deactivate user

GET    /api/students                     List students (school-scoped)
POST   /api/students                     Add student
PUT    /api/students/:id                 Update student

GET    /api/teachers                     List teachers
POST   /api/teachers                     Add teacher

GET    /api/finance/payments             List payments
POST   /api/finance/payments             Record payment
GET    /api/finance/summary              Revenue summary
GET    /api/finance/fee-structures       Fee structures
POST   /api/finance/fee-structures       Create fee structure

POST   /api/attendance                   Mark attendance (bulk)
GET    /api/attendance/report/:studentId Attendance report

POST   /api/assessments                  Record CBC assessment
GET    /api/assessments/student/:id/report Student report
```
