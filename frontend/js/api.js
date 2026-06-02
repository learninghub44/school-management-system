/**
 * ZETU School Management System — API Client
 * Production-ready. No process.env. Browser-safe only.
 */

// ── API Base URL ───────────────────────────────────────────────────
// Resolved from config.js (loaded before this via <script src="/js/config.js">)
const API_BASE = window.CONFIG?.API?.BASE_URL ||
    window.API_BASE_URL ||
    "https://cbc-school-erp-api.onrender.com/api";

// ── Session helpers ────────────────────────────────────────────────
export const getToken = () => localStorage.getItem("zetu_auth_token");
export const getUser  = () => {
    try { return JSON.parse(localStorage.getItem("zetu_user") || "null"); }
    catch { return null; }
};

export function saveSession(token, user) {
    if (token) localStorage.setItem("zetu_auth_token", token);
    if (user)  localStorage.setItem("zetu_user", JSON.stringify(user));
}

export function clearSession() {
    localStorage.removeItem("zetu_auth_token");
    localStorage.removeItem("zetu_user");
    // Also clear legacy keys if any
    localStorage.removeItem("token");
    localStorage.removeItem("user");
}

// ── XSS-safe HTML escape ───────────────────────────────────────────
export function esc(str) {
    if (str == null) return "–";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

// ── Core fetch ─────────────────────────────────────────────────────
export async function apiFetch(endpoint, { method = "GET", body = null, params = {} } = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let url = `${API_BASE}${endpoint}`;
    const qs = new URLSearchParams(params).toString();
    if (qs) url += "?" + qs;

    const opts = { method, headers, credentials: "include" };
    if (body) opts.body = JSON.stringify(body);

    try {
        const res = await fetch(url, opts);

        // Handle non-JSON responses gracefully
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return { success: false, message: `Server returned non-JSON response (${res.status}).` };
        }

        const data = await res.json();

        if (res.status === 401) {
            clearSession();
            window.location.href = "/login.html";
            return null;
        }
        return data;
    } catch (err) {
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        const msg = isLocal
            ? "Cannot reach backend at localhost:5000. Is it running?"
            : `Cannot reach API at ${API_BASE}. Check if backend is live.`;
        return { success: false, message: msg };
    }
}

// ── Role Guard ─────────────────────────────────────────────────────
export function guardPage(allowedRoles) {
    const user  = getUser();
    const token = getToken();
    if (!user || !token) {
        window.location.href = "/login.html";
        return null;
    }
    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        window.location.href = "/login.html";
        return null;
    }
    return user;
}

// ── Logout (revokes server-side token) ────────────────────────────
export async function logout() {
    try { await apiFetch("/auth/logout", { method: "POST" }); } catch (_) {}
    clearSession();
    window.location.href = "/login.html";
}

// ================================================================
// Auth
// ================================================================
export const auth = {
    login:          (email, password, school_code) =>
        apiFetch("/auth/login", { method: "POST", body: { email, password, school_code } }),
    logout:         () => apiFetch("/auth/logout", { method: "POST" }),
    me:             () => apiFetch("/auth/me"),
    verify:         () => apiFetch("/auth/verify"),
    changePassword: (current_password, new_password) =>
        apiFetch("/auth/change-password", { method: "POST", body: { current_password, new_password } }),
    auditLog:       () => apiFetch("/auth/audit"),
};

// ================================================================
// Schools
// ================================================================
export const schools = {
    list:        ()           => apiFetch("/schools"),
    get:         (id)         => apiFetch(`/schools/${id}`),
    create:      (data)       => apiFetch("/schools",              { method: "POST",  body: data }),
    update:      (id, d)      => apiFetch(`/schools/${id}`,        { method: "PUT",   body: d }),
    setStatus:   (id, active) => apiFetch(`/schools/${id}/status`, { method: "PATCH", body: { is_active: active } }),
    createAdmin: (id, d)      => apiFetch(`/schools/${id}/admin`,  { method: "POST",  body: d }),
    stats:       (id)         => apiFetch(`/schools/${id}/stats`),
};

// ================================================================
// Users
// ================================================================
export const users = {
    list:          (p)      => apiFetch("/users",                     { params: p }),
    create:        (data)   => apiFetch("/users",                     { method: "POST",   body: data }),
    update:        (id, d)  => apiFetch(`/users/${id}`,               { method: "PUT",    body: d }),
    deactivate:    (id)     => apiFetch(`/users/${id}`,               { method: "DELETE" }),
    resetPassword: (id, pw) => apiFetch(`/users/${id}/reset-password`,{ method: "POST",   body: { new_password: pw } }),
};

// ================================================================
// Students
// ================================================================
export const students = {
    list:       (p)      => apiFetch("/students",                    { params: p }),
    get:        (id)     => apiFetch(`/students/${id}`),
    create:     (data)   => apiFetch("/students",                    { method: "POST",  body: data }),
    update:     (id, d)  => apiFetch(`/students/${id}`,              { method: "PUT",   body: d }),
    deactivate: (id)     => apiFetch(`/students/${id}`,              { method: "DELETE" }),
    linkParent: (id, pid)=> apiFetch(`/students/${id}/link-parent`,  { method: "POST",  body: { parent_id: pid } }),
};

// ================================================================
// Teachers
// ================================================================
export const teachers = {
    list:   (p)     => apiFetch("/teachers",       { params: p }),
    get:    (id)    => apiFetch(`/teachers/${id}`),
    create: (data)  => apiFetch("/teachers",       { method: "POST",   body: data }),
    update: (id, d) => apiFetch(`/teachers/${id}`, { method: "PUT",    body: d }),
    delete: (id)    => apiFetch(`/teachers/${id}`, { method: "DELETE" }),
};

// ================================================================
// Finance
// ================================================================
export const finance = {
    payments:        (p)       => apiFetch("/finance/payments",        { params: p }),
    recordPayment:   (data)    => apiFetch("/finance/payments",        { method: "POST", body: data }),
    summary:         (p)       => apiFetch("/finance/summary",         { params: p }),
    feeStructures:   (p)       => apiFetch("/finance/fee-structures",  { params: p }),
    createFeeStruct: (data)    => apiFetch("/finance/fee-structures",  { method: "POST", body: data }),
    balance:         (sid, yr) => apiFetch(`/finance/balance/${sid}`,  { params: { year: yr } }),
};

// ================================================================
// Attendance
// ================================================================
export const attendance = {
    list:   (p)    => apiFetch("/attendance",               { params: p }),
    record: (data) => apiFetch("/attendance",               { method: "POST", body: data }),
    report: (sid)  => apiFetch(`/attendance/report/${sid}`),
};

// ================================================================
// Assessments
// ================================================================
export const assessments = {
    list:           (p)     => apiFetch("/assessments",                      { params: p }),
    create:         (data)  => apiFetch("/assessments",                      { method: "POST", body: data }),
    studentReport:  (id, p) => apiFetch(`/assessments/student/${id}/report`, { params: p }),
    learningAreas:  ()      => apiFetch("/assessments/learning-areas"),
    strands:        (la)    => apiFetch(`/assessments/strands/${la}`),
};

// ================================================================
// Parents
// ================================================================
export const parents = {
    list:        (p)      => apiFetch("/parents",                          { params: p }),
    get:         (id)     => apiFetch(`/parents/${id}`),
    create:      (data)   => apiFetch("/parents",                          { method: "POST",  body: data }),
    update:      (id, d)  => apiFetch(`/parents/${id}`,                    { method: "PUT",   body: d }),
    deactivate:  (id)     => apiFetch(`/parents/${id}`,                    { method: "DELETE" }),
    linkStudent: (id, sid)=> apiFetch(`/parents/${id}/link-student`,       { method: "POST",  body: { student_id: sid } }),
};

// ================================================================
// CBC Curriculum
// ================================================================
export const curriculum = {
    academicYears:      ()      => apiFetch("/curriculum/academic-years"),
    createAcademicYear: (data)  => apiFetch("/curriculum/academic-years",          { method: "POST", body: data }),
    terms:              ()      => apiFetch("/curriculum/terms"),
    createTerm:         (data)  => apiFetch("/curriculum/terms",                   { method: "POST", body: data }),
    classes:            ()      => apiFetch("/curriculum/classes"),
    createClass:        (data)  => apiFetch("/curriculum/classes",                 { method: "POST", body: data }),
    updateClass:        (id, d) => apiFetch(`/curriculum/classes/${id}`,           { method: "PUT",  body: d }),
    streams:            (cid)   => apiFetch(`/curriculum/classes/${cid}/streams`),
    createStream:       (cid,d) => apiFetch(`/curriculum/classes/${cid}/streams`,  { method: "POST", body: d }),
    subjects:           ()      => apiFetch("/curriculum/subjects"),
    availableSubjects:  ()      => apiFetch("/curriculum/subjects/available"),
    activateSubject:    (data)  => apiFetch("/curriculum/subjects",                { method: "POST", body: data }),
    activateStage:      (stage) => apiFetch("/curriculum/subjects/activate-stage", { method: "POST", body: { stage } }),
    updateSubject:      (id, d) => apiFetch(`/curriculum/subjects/${id}`,          { method: "PATCH",body: d }),
    gradingScale:       ()      => apiFetch("/curriculum/grading-scale"),
    initGradingScale:   ()      => apiFetch("/curriculum/grading-scale/init",      { method: "POST" }),
    updateGrade:        (id, d) => apiFetch(`/curriculum/grading-scale/${id}`,     { method: "PUT",  body: d }),
    assessmentCategories: ()    => apiFetch("/curriculum/assessment-categories"),
    initCategories:     ()      => apiFetch("/curriculum/assessment-categories/init",{ method: "POST" }),
    createCategory:     (data)  => apiFetch("/curriculum/assessment-categories",   { method: "POST", body: data }),
    teacherAssignments: ()      => apiFetch("/curriculum/teacher-assignments"),
    assignTeacher:      (data)  => apiFetch("/curriculum/teacher-assignments",     { method: "POST", body: data }),
    enrollStudent:      (data)  => apiFetch("/curriculum/enroll-student",          { method: "POST", body: data }),
    pathways:           ()      => apiFetch("/curriculum/pathways"),
    grades:             ()      => apiFetch("/curriculum/grades"),
    learningAreas:      (stage) => apiFetch("/curriculum/learning-areas",          { params: stage ? { stage } : {} }),
};

// ================================================================
// Marks & Gradebook
// ================================================================
export const marks = {
    assessmentDefs:     (p)     => apiFetch("/marks/assessment-definitions",         { params: p }),
    createAssessmentDef:(data)  => apiFetch("/marks/assessment-definitions",         { method: "POST", body: data }),
    entry:              (data)  => apiFetch("/marks/entry",                          { method: "POST", body: data }),
    sheet:              (p)     => apiFetch("/marks/sheet",                          { params: p }),
    gradebook:          (p)     => apiFetch("/marks/gradebook",                      { params: p }),
    studentReport:      (id, p) => apiFetch(`/marks/student-report/${id}`,           { params: p }),
    analytics:          (p)     => apiFetch("/marks/analytics",                      { params: p }),
    generateReportCards:(data)  => apiFetch("/marks/report-cards/generate",          { method: "POST", body: data }),
    reportCards:        (sid,p) => apiFetch(`/marks/report-cards/${sid}`,            { params: p }),
    updateRemarks:      (id, d) => apiFetch(`/marks/report-cards/${id}/remarks`,     { method: "PATCH",body: d }),
    publishReportCards: (termId)=> apiFetch(`/marks/report-cards/publish/${termId}`, { method: "PATCH" }),
    markAudit:          ()      => apiFetch("/marks/audit"),
};
