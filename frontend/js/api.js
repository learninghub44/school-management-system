/**
 * CBC School ERP — API Client v5.0
 * Multi-tenant: storage keys scoped per subdomain/school
 *
 * Changes vs v4.4:
 *  - localStorage with tenant-scoped keys (no cross-school bleed)
 *  - guardPage() validates tenant context + JWT expiry
 *  - verifySession() invalidates if school_id mismatches tenant
 */

const BASE  = () => window.API_BASE  || "/api";
const KEYS  = () => window.STORAGE_KEYS || { TOKEN: "cbc_token", USER: "cbc_user" };
const TENANT = () => window.TENANT   || { schoolCode: null, isSuperAdmin: false, isRoot: false };

// ── Session ───────────────────────────────────────────────────────
export function getToken() { return localStorage.getItem(KEYS().TOKEN); }
export function getUser() {
  try { return JSON.parse(localStorage.getItem(KEYS().USER) || "null"); }
  catch { return null; }
}
export function setSession(token, user) {
  localStorage.setItem(KEYS().TOKEN, token);
  localStorage.setItem(KEYS().USER, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(KEYS().TOKEN);
  localStorage.removeItem(KEYS().USER);
}

// ── XSS escape ────────────────────────────────────────────────────
export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Decode JWT (client-side, no verify — just read claims) ────────
function decodeToken(token) {
  try { return JSON.parse(atob(token.split(".")[1])); }
  catch { return null; }
}

// ── Route guard ───────────────────────────────────────────────────
// Checks: token exists → not expired → role allowed → tenant matches
// No network call. Returns user or null (and redirects on failure).
export function guardPage(allowedRoles = []) {
  const user  = getUser();
  const token = getToken();
  const t     = TENANT();

  if (!user || !token) {
    window.location.replace("/login.html");
    return null;
  }

  // JWT expiry check
  const payload = decodeToken(token);
  if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
    clearSession();
    window.location.replace("/login.html");
    return null;
  }

  // Role check
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    window.location.replace("/login.html");
    return null;
  }

  // Tenant check — school user must match this subdomain's school code
  if (!t.isSuperAdmin && t.schoolCode) {
    if (user.school_code !== t.schoolCode) {
      // Wrong school — clear and redirect (prevents cross-tenant access)
      clearSession();
      window.location.replace("/login.html");
      return null;
    }
  }

  // SUPER_ADMIN must be on admin subdomain
  if (user.role === "SUPER_ADMIN" && !t.isSuperAdmin) {
    clearSession();
    window.location.replace("/login.html");
    return null;
  }

  return user;
}

// ── Core fetch ────────────────────────────────────────────────────
export async function apiFetch(path, { method = "GET", body = null, params = null } = {}) {
  const token = getToken();
  const base  = BASE();

  let fullUrl;
  try {
    fullUrl = base.startsWith("http")
      ? base.replace(/\/$/, "") + path
      : window.location.origin + base.replace(/\/$/, "") + path;

    const u = new URL(fullUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
      });
    }
    fullUrl = u.toString();
  } catch {
    fullUrl = window.location.origin + "/api" + path;
  }

  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body && method !== "GET") opts.body = JSON.stringify(body);

  try {
    const res = await fetch(fullUrl, opts);
    let data;
    try { data = await res.json(); }
    catch { data = { success: false, message: `HTTP ${res.status}` }; }
    data._status = res.status;
    return data;
  } catch (e) {
    console.error("API network error:", path, e.message);
    return { success: false, message: "Network error. Please check your connection.", _networkError: true };
  }
}

// ── verifySession ─────────────────────────────────────────────────
export async function verifySession() {
  const result = await apiFetch("/auth/verify");
  if (!result)                return { ok: false, reason: "auth" };
  if (result._networkError)   return { ok: false, reason: "network" };
  if (result._status === 401) return { ok: false, reason: "auth" };
  if (result._status === 403) return { ok: false, reason: "school" };
  if (!result.success)        return { ok: false, reason: "auth" };

  // Extra tenant validation — ensure returned user matches this subdomain
  const t = TENANT();
  if (!t.isSuperAdmin && t.schoolCode && result.user.school_code !== t.schoolCode) {
    return { ok: false, reason: "tenant" };
  }

  return { ok: true, user: result.user };
}

// ── Logout ────────────────────────────────────────────────────────
export async function logout() {
  try { await apiFetch("/auth/logout", { method: "POST" }); } catch (_) {}
  clearSession();
  window.location.replace("/login.html");
}

// ── Auth ──────────────────────────────────────────────────────────
export const auth = {
  login:          (d) => apiFetch("/auth/login",           { method: "POST", body: d }),
  logout:         ()  => apiFetch("/auth/logout",          { method: "POST" }),
  verify:         ()  => apiFetch("/auth/verify"),
  changePassword: (d) => apiFetch("/auth/change-password", { method: "POST", body: d }),
  auditLog:       ()  => apiFetch("/auth/audit-log"),
};

export const schools = {
  list:          ()       => apiFetch("/schools"),
  me:            ()       => apiFetch("/schools/me"),
  create:        (d)      => apiFetch("/schools",                { method: "POST",  body: d }),
  update:        (id, d)  => apiFetch(`/schools/${id}`,          { method: "PUT",   body: d }),
  toggle:        (id)     => apiFetch(`/schools/${id}/toggle`,   { method: "PATCH" }),
  learningAreas: (p)      => apiFetch("/schools/learning-areas", { params: p }),
};

export const users = {
  list:          (p)      => apiFetch("/users",                       { params: p }),
  get:           (id)     => apiFetch(`/users/${id}`),
  create:        (d)      => apiFetch("/users",                       { method: "POST",   body: d }),
  update:        (id, d)  => apiFetch(`/users/${id}`,                 { method: "PUT",    body: d }),
  deactivate:    (id)     => apiFetch(`/users/${id}`,                 { method: "DELETE" }),
  resetPassword: (id, pw) => apiFetch(`/users/${id}/reset-password`,  { method: "POST", body: { new_password: pw } }),
};

export const departments = {
  list:   (p)     => apiFetch("/departments",        { params: p }),
  create: (d)     => apiFetch("/departments",        { method: "POST",   body: d }),
  update: (id, d) => apiFetch(`/departments/${id}`,  { method: "PUT",    body: d }),
  delete: (id)    => apiFetch(`/departments/${id}`,  { method: "DELETE" }),
};

export const teachers = {
  list:        (p)     => apiFetch("/teachers",                { params: p }),
  get:         (id)    => apiFetch(`/teachers/${id}`),
  create:      (d)     => apiFetch("/teachers",                { method: "POST",   body: d }),
  update:      (id, d) => apiFetch(`/teachers/${id}`,          { method: "PUT",    body: d }),
  deactivate:  (id)    => apiFetch(`/teachers/${id}`,          { method: "DELETE" }),
  assignments: (id)    => apiFetch(`/teachers/${id}/assignments`),
};

export const classes = {
  list:     (p)     => apiFetch("/classes",            { params: p }),
  get:      (id)    => apiFetch(`/classes/${id}`),
  students: (id)    => apiFetch(`/classes/${id}/students`),
  create:   (d)     => apiFetch("/classes",            { method: "POST",   body: d }),
  update:   (id, d) => apiFetch(`/classes/${id}`,      { method: "PUT",    body: d }),
  delete:   (id)    => apiFetch(`/classes/${id}`,      { method: "DELETE" }),
};

export const students = {
  list:    (p)     => apiFetch("/students",         { params: p }),
  get:     (id)    => apiFetch(`/students/${id}`),
  create:  (d)     => apiFetch("/students",         { method: "POST", body: d }),
  update:  (id, d) => apiFetch(`/students/${id}`,   { method: "PUT",  body: d }),
  promote: (d)     => apiFetch("/students/promote", { method: "POST", body: d }),
};

export const assignments = {
  list:   (p)  => apiFetch("/assignments",        { params: p }),
  create: (d)  => apiFetch("/assignments",        { method: "POST",   body: d }),
  delete: (id) => apiFetch(`/assignments/${id}`,  { method: "DELETE" }),
};

export const attendance = {
  list:    (p)     => apiFetch("/attendance",         { params: p }),
  summary: (p)     => apiFetch("/attendance/summary", { params: p }),
  bulk:    (d)     => apiFetch("/attendance/bulk",    { method: "POST", body: d }),
  update:  (id, d) => apiFetch(`/attendance/${id}`,   { method: "PUT",  body: d }),
};

export const assessments = {
  list:   (p)  => apiFetch("/assessments",        { params: p }),
  report: (p)  => apiFetch("/assessments/report", { params: p }),
  create: (d)  => apiFetch("/assessments",        { method: "POST",   body: d }),
  delete: (id) => apiFetch(`/assessments/${id}`,  { method: "DELETE" }),
};

export const finance = {
  feeStructures:  (p)     => apiFetch("/finance/fee-structures",        { params: p }),
  createFee:      (d)     => apiFetch("/finance/fee-structures",        { method: "POST",   body: d }),
  deleteFee:      (id)    => apiFetch(`/finance/fee-structures/${id}`,  { method: "DELETE" }),
  payments:       (p)     => apiFetch("/finance/payments",              { params: p }),
  recordPayment:  (d)     => apiFetch("/finance/payments",              { method: "POST",   body: d }),
  summary:        (p)     => apiFetch("/finance/summary",               { params: p }),
  studentBalance: (id, p) => apiFetch(`/finance/student-balance/${id}`, { params: p }),
};

export const reports = {
  dashboard:    (p)  => apiFetch("/reports/dashboard",           { params: p }),
  reportCards:  (p)  => apiFetch("/reports/cards",               { params: p }),
  generateCard: (d)  => apiFetch("/reports/cards",               { method: "POST", body: d }),
  publishCard:  (id) => apiFetch(`/reports/cards/${id}/publish`, { method: "POST" }),
  timetable:    (p)  => apiFetch("/reports/timetable",           { params: p }),
  createSlot:   (d)  => apiFetch("/reports/timetable",           { method: "POST", body: d }),
  deleteSlot:   (id) => apiFetch(`/reports/timetable/${id}`,     { method: "DELETE" }),
};
