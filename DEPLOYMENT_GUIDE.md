# Kadem & Zetu School Management System v4.0 — Deployment Guide

## Stack
- **Backend**: Node.js 18+ / Express on [Render](https://render.com)
- **Database**: PostgreSQL on [Neon](https://neon.tech)
- **Frontend**: Static files served by Express (or Cloudflare Pages)

---

## 1. Database Setup (Neon)
1. Create a new Neon project
2. Go to **SQL Editor** and run `backend/cbc_schema.sql`
3. Copy the **Connection String** (URI format) → you'll need this for `DATABASE_URL`

---

## 2. Backend on Render
1. Create a **Web Service** pointing to your GitHub repo
2. **Root Directory**: `backend`
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. Add these **Environment Variables**:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Neon connection string |
| `JWT_SECRET` | 64-char random string (`openssl rand -base64 48`) |
| `JWT_EXPIRES` | `10h` |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | Your frontend URL |
| `PORT` | `3000` |

---

## 3. Create First Super Admin
Run this SQL in Neon's SQL Editor (replace the password hash):

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
