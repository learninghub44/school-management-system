/**
 * CBC School ERP — API Client (Security Hardened)
 * V-05: JWT stored in httpOnly cookie set by server (not localStorage)
 *       localStorage only stores non-sensitive user profile for UI display
 * V-09: All rendering uses textContent / safe helpers — never innerHTML with user data
 */
// Should only have:
const API_BASE = window.API_BASE_URL || 'https://cbc-school-erp-api.onrender.com/api'
// NOT a hardcoded real Render URL with credentials

// ── Session helpers ────────────────────────────────────────────────
// Session is managed via httpOnly cookies. LocalStorage is only a cache.
export const getUser    = () => { try { return JSON.parse(localStorage.getItem("user")||"null"); } catch { return null; } };
export const getToken   = () => null; // Security: Do not read token from JS
export const saveSession = (token, user) => {
    // We only store the user profile for UI, token is in httpOnly cookie
    localStorage.setItem("user", JSON.stringify(user));
};
export const clearSession = () => {
    localStorage.removeItem("user");
};

// ── V-09: Safe HTML escaping — never trust user data ──────────────
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
export async function apiFetch(endpoint, { method="GET", body=null, params={} } = {}) {
    const headers = { "Content-Type": "application/json" };
    // Bearer token is NOT sent from JS; browser sends httpOnly cookie automatically

    let url = `${API_BASE}${endpoint}`;
    const qs = new URLSearchParams(params).toString();
    if (qs) url += "?" + qs;

    const opts = { method, headers, credentials: "include" }; // credentials for httpOnly cookie
    if (body) opts.body = JSON.stringify(body);

    try {
        const res = await fetch(url, opts);
        const data = await res.json();
        if (res.status === 401) {
            clearSession();
            window.location.href = "/login.html";
            return null;
        }
        return data;
    } catch (err) {
        console.error("API Fetch Error:", {
            url,
            method,
            error: err.message
        });
        // Provide more helpful production error message
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        const helpMsg = isLocal 
            ? "Cannot reach local backend (port 5000). Is it running?" 
            : `Cannot reach API at ${API_BASE}. Check if backend is live.`;
        return { success: false, message: helpMsg };
    }
}

// ── Auth ───────────────────────────────────────────────────────────
export const auth = {
    login:          (email, password, school_code) =>
        apiFetch("/auth/login", { method:"POST", body:{ email, password, school_code } }),
    logout:         () => apiFetch("/auth/logout", { method:"POST" }),
    me:             () => apiFetch("/auth/me"),
    verify:         () => apiFetch("/auth/verify"),
    changePassword: (current_password, new_password) =>
        apiFetch("/auth/change-password", { method:"POST", body:{ current_password, new_password } }),
    auditLog:       () => apiFetch("/auth/audit"),
};

// ── Schools ────────────────────────────────────────────────────────
export const schools = {
    list:        ()            => apiFetch("/schools"),
    get:         (id)          => apiFetch(`/schools/${id}`),
    create:      (data)        => apiFetch("/schools",             { method:"POST",  body:data }),
    update:      (id, d)       => apiFetch(`/schools/${id}`,       { method:"PUT",   body:d }),
    setStatus:   (id, active)  => apiFetch(`/schools/${id}/status`,{ method:"PATCH", body:{ is_active: active } }),
    createAdmin: (id, d)       => apiFetch(`/schools/${id}/admin`, { method:"POST",  body:d }),
    stats:       (id)          => apiFetch(`/schools/${id}/stats`),
};

// ── Users ──────────────────────────────────────────────────────────
export const users = {
    list:          (p)     => apiFetch("/users",                   { params:p }),
    create:        (data)  => apiFetch("/users",                   { method:"POST",   body:data }),
    update:        (id, d) => apiFetch(`/users/${id}`,             { method:"PUT",    body:d }),
    deactivate:    (id)    => apiFetch(`/users/${id}`,             { method:"DELETE" }),
    resetPassword: (id,pw) => apiFetch(`/users/${id}/reset-password`,{ method:"POST", body:{ new_password:pw } }),
};

// ── Students ───────────────────────────────────────────────────────
export const students = {
    list:       (p)      => apiFetch("/students",                  { params:p }),
    get:        (id)     => apiFetch(`/students/${id}`),
    create:     (data)   => apiFetch("/students",                  { method:"POST",  body:data }),
    update:     (id, d)  => apiFetch(`/students/${id}`,            { method:"PUT",   body:d }),
    deactivate: (id)     => apiFetch(`/students/${id}`,            { method:"DELETE" }),
    linkParent: (id,pid) => apiFetch(`/students/${id}/link-parent`,{ method:"POST",  body:{ parent_id:pid } }),
};

// ── Teachers ───────────────────────────────────────────────────────
export const teachers = {
    list:   (p)    => apiFetch("/teachers",    { params:p }),
    get:    (id)   => apiFetch(`/teachers/${id}`),
    create: (data) => apiFetch("/teachers",    { method:"POST",   body:data }),
    update: (id,d) => apiFetch(`/teachers/${id}`,{ method:"PUT",  body:d }),
    delete: (id)   => apiFetch(`/teachers/${id}`,{ method:"DELETE" }),
};

// ── Finance ────────────────────────────────────────────────────────
export const finance = {
    payments:        (p)      => apiFetch("/finance/payments",       { params:p }),
    recordPayment:   (data)   => apiFetch("/finance/payments",       { method:"POST", body:data }),
    summary:         (p)      => apiFetch("/finance/summary",        { params:p }),
    feeStructures:   (p)      => apiFetch("/finance/fee-structures", { params:p }),
    createFeeStruct: (data)   => apiFetch("/finance/fee-structures", { method:"POST", body:data }),
    balance:         (sid, y) => apiFetch(`/finance/balance/${sid}`, { params:{ year:y } }),
};

// ── Attendance ─────────────────────────────────────────────────────
export const attendance = {
    list:   (p)    => apiFetch("/attendance",              { params:p }),
    record: (data) => apiFetch("/attendance",              { method:"POST", body:data }),
    report: (sid)  => apiFetch(`/attendance/report/${sid}`),
};

// ── CBC ────────────────────────────────────────────────────────────
export const cbc = {
    streams:            ()     => apiFetch("/cbc/streams"),
    createStream:       (data) => apiFetch("/cbc/streams",          { method:"POST", body:data }),
    academicYears:      ()     => apiFetch("/cbc/academic-years"),
    createAcademicYear: (data) => apiFetch("/cbc/academic-years",   { method:"POST", body:data }),
    classes:            ()     => apiFetch("/cbc/classes"),
    createClass:        (data) => apiFetch("/cbc/classes",          { method:"POST", body:data }),
    categories:         ()     => apiFetch("/cbc/categories"),
    createCategory:     (data) => apiFetch("/cbc/categories",       { method:"POST", body:data }),
};

// ── Assessments ────────────────────────────────────────────────────
export const assessments = {
    list:          (p)    => apiFetch("/assessments",                     { params:p }),
    create:        (data) => apiFetch("/assessments",                     { method:"POST", body:data }),
    studentReport: (id,p) => apiFetch(`/assessments/student/${id}/report`,{ params:p }),
    learningAreas: ()     => apiFetch("/assessments/learning-areas"),
    strands:       (la)   => apiFetch(`/assessments/strands/${la}`),
};

// ── Role Guard ─────────────────────────────────────────────────────
export function guardPage(allowedRoles) {
    const user = getUser();
    if (!user) { window.location.href = "/login.html"; return null; }
    if (!allowedRoles.includes(user.role)) { window.location.href = "/login.html"; return null; }
    return user;
}

// ── Logout helper (revokes token server-side) ─────────────────────
export async function logout() {
    try { await auth.logout(); } catch (_) {}
    clearSession();
    window.location.href = "/login.html";
}
