# ZETU School Management System - Deployment Guide

## Overview

This guide covers deploying the ZETU School Management System to production with proper security, multi-tenancy, and environment variable management.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 12+
- Git
- Render.com account (or alternative hosting)
- Domain name (optional but recommended)

## Environment Setup

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in all required values:

```bash
cp .env.example .env
```

**Critical Variables:**

```env
# Database
DB_HOST=your-postgres-host.com
DB_NAME=school_management
DB_USER=postgres
DB_PASSWORD=your-secure-password

# JWT Security (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=your-64-character-secret-key
JWT_EXPIRY=7d

# CORS (specify your frontend domain)
CORS_ORIGIN=https://your-frontend-domain.com

# Node Environment
NODE_ENV=production
```

### 2. Database Setup

Create PostgreSQL database and run migrations:

```bash
# Connect to PostgreSQL
psql -h your-host -U postgres

# Create database
CREATE DATABASE school_management;

# Run migrations
psql -h your-host -U postgres -d school_management -f backend/cbc_schema.sql
psql -h your-host -U postgres -d school_management -f backend/migration_cbc_upgrade.sql
psql -h your-host -U postgres -d school_management -f backend/migration_payment_enhancement.sql
```

### 3. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend (if using build process)
cd ../frontend
npm install
```

## Deployment to Render.com

### 1. Create Backend Service

1. Go to [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `zetu-school-erp-api`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `cd backend && node server.js`
   - **Plan**: Standard ($7/month)

5. Add Environment Variables:
   - Copy all variables from your `.env` file
   - Ensure `NODE_ENV=production`
   - Set `CORS_ORIGIN` to your frontend domain

6. Deploy

### 2. Create Frontend Service

1. Click "New +" → "Static Site"
2. Connect your GitHub repository
3. Configure:
   - **Name**: `zetu-school-erp`
   - **Build Command**: `cd frontend && npm run build` (if applicable)
   - **Publish Directory**: `frontend`

4. Add Environment Variables:
   - `REACT_APP_API_BASE_URL=https://zetu-school-erp-api.onrender.com/api`
   - `REACT_APP_ENVIRONMENT=production`

5. Deploy

### 3. Configure Custom Domain

1. Go to your service settings
2. Click "Custom Domains"
3. Add your domain and follow DNS configuration

## Security Checklist

### ✅ Pre-Deployment

- [ ] All hardcoded values removed
- [ ] Environment variables configured
- [ ] JWT_SECRET is 64+ characters
- [ ] Database password is strong
- [ ] CORS_ORIGIN is set to production domain only
- [ ] NODE_ENV=production
- [ ] Database backups enabled
- [ ] SSL/TLS certificate installed

### ✅ Post-Deployment

- [ ] Test login functionality
- [ ] Verify school isolation (test cross-school access)
- [ ] Check CORS headers
- [ ] Test payment recording
- [ ] Verify reports generation
- [ ] Check analytics dashboard
- [ ] Monitor error logs
- [ ] Enable database backups

## Multi-Tenancy Verification

### Test School Isolation

```bash
# Login as School A admin
# Try to access School B data via API:
curl -H "Authorization: Bearer TOKEN" \
  "https://api.zetusms.com/api/students?school_id=2"

# Should return 403 Forbidden or empty results
```

### Verify Role-Based Access

```bash
# Test STUDENT role accessing other student's data
# Should return 403 Forbidden

# Test PARENT role accessing non-linked child
# Should return 403 Forbidden
```

## Database Backups

### Automated Backups (Render.com)

1. Go to PostgreSQL database settings
2. Enable automated backups
3. Set retention to 30 days minimum

### Manual Backup

```bash
pg_dump -h your-host -U postgres school_management > backup.sql
```

## Monitoring & Logging

### Enable Logging

Set in `.env`:
```env
LOG_LEVEL=info
LOG_FORMAT=json
```

### Monitor Key Metrics

- API response times
- Database query performance
- Authentication failures
- Cross-school access attempts
- Payment transaction errors

### Error Tracking (Optional)

Integrate Sentry for error tracking:

```env
SENTRY_DSN=https://your-key@sentry.io/project-id
```

## Performance Optimization

### Database Indexes

Ensure these indexes exist:

```sql
CREATE INDEX idx_students_school_id ON students(school_id);
CREATE INDEX idx_payments_school_id ON payments_v2(school_id);
CREATE INDEX idx_attendance_school_id ON attendance(school_id);
CREATE INDEX idx_assessments_school_id ON assessments(school_id);
CREATE INDEX idx_users_school_id ON users(school_id);
```

### Caching

For production, consider:
- Redis for session storage
- CDN for static assets
- Query result caching for reports

## Troubleshooting

### 500 Error on API

1. Check server logs: `tail -f /var/log/zetu-sms/app.log`
2. Verify database connection
3. Check JWT_SECRET is set correctly
4. Verify CORS_ORIGIN matches frontend domain

### Students endpoint returns 500

```bash
# Check if school_id is being passed
# Verify school exists in database
SELECT * FROM schools WHERE id = 1;

# Check student records
SELECT * FROM students WHERE school_id = 1 LIMIT 5;
```

### Payment recording fails

1. Verify payment_categories exist for school
2. Check student belongs to school
3. Verify amount is valid number
4. Check database constraints

### Reports not generating

1. Verify reports route is registered
2. Check school_id is passed correctly
3. Verify user has SCHOOL_ADMIN or FINANCE role
4. Check database has data for date range

## Maintenance

### Regular Tasks

- **Daily**: Monitor error logs
- **Weekly**: Review performance metrics
- **Monthly**: Audit access logs, verify backups
- **Quarterly**: Update dependencies, security patches

### Update Procedure

1. Test updates in development
2. Create database backup
3. Update code on production
4. Run any new migrations
5. Restart services
6. Verify functionality

## Support & Escalation

For issues:

1. Check logs first
2. Review this guide
3. Check GitHub issues
4. Contact support team

## Security Incident Response

If you suspect a security issue:

1. Immediately disable affected accounts
2. Check audit logs for unauthorized access
3. Review database for data modifications
4. Notify affected users
5. Document incident
6. Implement fixes
7. Deploy patches

## Compliance

This system is designed for Kenyan schools and complies with:

- Data Protection Act 2019
- Kenya Education Management Information System (KEMIS) requirements
- CBC curriculum standards
- GDPR (if applicable)

Ensure you:
- Have user consent for data collection
- Maintain data privacy
- Implement data retention policies
- Provide data export capabilities
- Enable audit logging

---

**Last Updated**: 2024
**Version**: 1.0.0
