# Security Testing Guide for ZETU School Management System

This guide provides comprehensive testing procedures to verify multi-tenant school isolation and prevent cross-school data leakage.

---

## Prerequisites

- Two test schools created in the system
- Admin accounts for each school
- Test student and parent accounts
- API testing tool (Postman, curl, or similar)

---

## Test Setup

### Create Test Schools
```bash
# School A
POST /api/schools
{
  "name": "Test School A",
  "school_code": "TSA",
  "address": "123 Main St"
}

# School B
POST /api/schools
{
  "name": "Test School B",
  "school_code": "TSB",
  "address": "456 Oak Ave"
}
```

### Create Admin Users
```bash
# School A Admin
POST /api/users
{
  "email": "admin-a@test.com",
  "password": "TestPass123",
  "name": "Admin A",
  "role": "SCHOOL_ADMIN",
  "school_id": <school_a_id>
}

# School B Admin
POST /api/users
{
  "email": "admin-b@test.com",
  "password": "TestPass123",
  "name": "Admin B",
  "role": "SCHOOL_ADMIN",
  "school_id": <school_b_id>
}
```

---

## Test Cases

### 1. Payment Records Isolation

#### Test 1.1: Cross-School Receipt Access
**Objective:** Verify School A admin cannot access School B's receipts

**Steps:**
1. Login as School A admin
2. Record a payment in School A
3. Get the payment ID
4. Try to access receipt: `GET /api/finance/receipts/<school_b_payment_id>`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 1.2: Payment Summary Isolation
**Objective:** Verify payment summaries only show own school data

**Steps:**
1. Login as School A admin
2. Call `GET /api/finance/summary`
3. Verify only School A payments are included

**Expected Result:** Only School A payments in response  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 1.3: Payment Category Isolation
**Objective:** Verify payment categories are isolated per school

**Steps:**
1. Login as School A admin
2. Create payment category in School A
3. Login as School B admin
4. Verify category not visible in `GET /api/finance/payment-categories`

**Expected Result:** School B cannot see School A's categories  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 2. Student Records Isolation

#### Test 2.1: Cross-School Student Access
**Objective:** Verify School A admin cannot access School B students

**Steps:**
1. Create students in both schools
2. Login as School A admin
3. Try to access School B student: `GET /api/students/<school_b_student_id>`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 2.2: Student List Isolation
**Objective:** Verify student list only shows own school

**Steps:**
1. Login as School A admin
2. Call `GET /api/students`
3. Verify only School A students in response

**Expected Result:** Only School A students  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 2.3: Cross-School Parent Linking
**Objective:** Verify cannot link School B parent to School A student

**Steps:**
1. Create parent in School B
2. Create student in School A
3. Login as School A admin
4. Try to link: `POST /api/students/<student_a_id>/link-parent`
   ```json
   { "parent_id": <parent_b_id> }
   ```

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 3. Teacher Records Isolation

#### Test 3.1: Cross-School Teacher Access
**Objective:** Verify School A admin cannot access School B teachers

**Steps:**
1. Create teachers in both schools
2. Login as School A admin
3. Try to access School B teacher: `GET /api/teachers/<school_b_teacher_id>`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 3.2: Cross-School Teacher Linking
**Objective:** Verify cannot create teacher with School B user account

**Steps:**
1. Create user in School B
2. Login as School A admin
3. Try to create teacher: `POST /api/teachers`
   ```json
   {
     "full_name": "Test Teacher",
     "user_id": <user_b_id>
   }
   ```

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 4. CBC Records Isolation

#### Test 4.1: Cross-School Class Creation
**Objective:** Verify cannot create class with School B resources

**Steps:**
1. Create academic year in School B
2. Create stream in School A
3. Login as School A admin
4. Try to create class: `POST /api/cbc/classes`
   ```json
   {
     "grade_id": <school_a_grade>,
     "stream_id": <school_a_stream>,
     "academic_year_id": <school_b_academic_year>
   }
   ```

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 4.2: Cross-School Teacher in Class
**Objective:** Verify cannot assign School B teacher to School A class

**Steps:**
1. Create teacher in School B
2. Login as School A admin
3. Try to create class: `POST /api/cbc/classes`
   ```json
   {
     "grade_id": <school_a_grade>,
     "stream_id": <school_a_stream>,
     "academic_year_id": <school_a_academic_year>,
     "teacher_id": <school_b_teacher_id>
   }
   ```

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 5. Assessment Records Isolation

#### Test 5.1: Cross-School Assessment Access
**Objective:** Verify School A admin cannot access School B assessments

**Steps:**
1. Create assessments in both schools
2. Login as School A admin
3. Try to access School B assessment report: `GET /api/assessments/student/<school_b_student_id>/report`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 5.2: Assessment List Isolation
**Objective:** Verify assessment list only shows own school

**Steps:**
1. Login as School A admin
2. Call `GET /api/assessments`
3. Verify only School A assessments in response

**Expected Result:** Only School A assessments  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 6. Attendance Records Isolation

#### Test 6.1: Cross-School Attendance Access
**Objective:** Verify School A admin cannot access School B attendance

**Steps:**
1. Record attendance in both schools
2. Login as School A admin
3. Try to access School B report: `GET /api/attendance/report/<school_b_student_id>`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 6.2: Attendance List Isolation
**Objective:** Verify attendance list only shows own school

**Steps:**
1. Login as School A admin
2. Call `GET /api/attendance`
3. Verify only School A attendance in response

**Expected Result:** Only School A attendance  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 7. Role-Based Access Control

#### Test 7.1: Student Cannot Access Other Students
**Objective:** Verify student cannot access other students' records

**Steps:**
1. Create two students in School A
2. Login as Student 1
3. Try to access Student 2: `GET /api/students/<student_2_id>`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 7.2: Parent Cannot Access Unlinked Children
**Objective:** Verify parent can only access linked children

**Steps:**
1. Create two students in School A
2. Link Parent to Student 1 only
3. Login as Parent
4. Try to access Student 2: `GET /api/students/<student_2_id>`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 7.3: Finance Cannot Access Assessments
**Objective:** Verify finance staff cannot access assessment data

**Steps:**
1. Login as Finance user
2. Try to access assessments: `GET /api/assessments`

**Expected Result:** 403 Forbidden  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

### 8. Super Admin Capabilities

#### Test 8.1: Super Admin Can Access All Schools
**Objective:** Verify SUPER_ADMIN can access data from all schools

**Steps:**
1. Login as SUPER_ADMIN
2. Call `GET /api/students?school_id=<school_a_id>`
3. Verify School A students returned
4. Call `GET /api/students?school_id=<school_b_id>`
5. Verify School B students returned

**Expected Result:** Can access both schools' data  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

#### Test 8.2: Super Admin Can Create Resources in Any School
**Objective:** Verify SUPER_ADMIN can create resources for any school

**Steps:**
1. Login as SUPER_ADMIN
2. Create student: `POST /api/students`
   ```json
   {
     "full_name": "Test Student",
     "admission_no": "ADM001",
     "grade_id": <grade_id>,
     "school_id": <school_b_id>
   }
   ```
3. Verify student created in School B

**Expected Result:** Student created in School B  
**Actual Result:** _______________  
**Status:** [ ] PASS [ ] FAIL

---

## Automated Testing Script

### Using curl

```bash
#!/bin/bash

# Configuration
API_BASE="http://localhost:5000/api"
SCHOOL_A_ID=1
SCHOOL_B_ID=2

# Login as School A Admin
RESPONSE=$(curl -s -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin-a@test.com",
    "password": "TestPass123",
    "school_code": "TSA"
  }')

TOKEN_A=$(echo $RESPONSE | jq -r '.token')

# Test: Try to access School B student
curl -s -X GET "$API_BASE/students/<school_b_student_id>" \
  -H "Authorization: Bearer $TOKEN_A" | jq .

# Expected: 403 Forbidden
```

### Using Postman

1. Create a Postman collection with all test cases
2. Use environment variables for school IDs and tokens
3. Set up tests to verify response status codes
4. Run collection with automated test runner

---

## Continuous Integration

Add these tests to your CI/CD pipeline:

```yaml
# .github/workflows/security-tests.yml
name: Security Tests

on: [push, pull_request]

jobs:
  security-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup database
        run: npm run db:setup
      - name: Start server
        run: npm start &
      - name: Run security tests
        run: npm run test:security
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v2
        with:
          name: security-test-results
          path: test-results/
```

---

## Test Result Summary

| Test Case | Status | Notes |
|-----------|--------|-------|
| 1.1 Cross-School Receipt Access | [ ] | |
| 1.2 Payment Summary Isolation | [ ] | |
| 1.3 Payment Category Isolation | [ ] | |
| 2.1 Cross-School Student Access | [ ] | |
| 2.2 Student List Isolation | [ ] | |
| 2.3 Cross-School Parent Linking | [ ] | |
| 3.1 Cross-School Teacher Access | [ ] | |
| 3.2 Cross-School Teacher Linking | [ ] | |
| 4.1 Cross-School Class Creation | [ ] | |
| 4.2 Cross-School Teacher in Class | [ ] | |
| 5.1 Cross-School Assessment Access | [ ] | |
| 5.2 Assessment List Isolation | [ ] | |
| 6.1 Cross-School Attendance Access | [ ] | |
| 6.2 Attendance List Isolation | [ ] | |
| 7.1 Student Cannot Access Others | [ ] | |
| 7.2 Parent Cannot Access Unlinked | [ ] | |
| 7.3 Finance Cannot Access Assessments | [ ] | |
| 8.1 Super Admin Can Access All | [ ] | |
| 8.2 Super Admin Can Create Anywhere | [ ] | |

**Total Tests:** 19  
**Passed:** ___  
**Failed:** ___  
**Date Tested:** _______________  
**Tested By:** _______________

---

## Troubleshooting

### Test Fails: "403 Forbidden"
- Verify user is logged in correctly
- Check school_id matches expected school
- Verify role has appropriate permissions

### Test Fails: "404 Not Found"
- Verify resource exists in correct school
- Check resource ID is correct
- Verify resource hasn't been deleted

### Test Fails: "500 Internal Server Error"
- Check server logs for error details
- Verify database is running
- Check for missing required fields in request

---

## Sign-Off

- [ ] All security tests passed
- [ ] No cross-school data leakage detected
- [ ] Role-based access control verified
- [ ] Ready for production deployment

**Tested By:** _______________  
**Date:** _______________  
**Approved By:** _______________
