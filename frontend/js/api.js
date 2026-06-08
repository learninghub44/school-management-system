/**
 * CBC School ERP — API Client v4.3
 *
 * CRITICAL FIX: apiFetch no longer auto-redirects to /login.html on 401.
 * Instead it returns the error data so callers can decide what to do.
 * Only verifySession() and guardPage() trigger redirects when appropriate.
 * This fixes the open/close flash: login page was calling verify() which
 * returned 401, which triggered clearSession()+redirect → infinite loop.
 */

const BASE = () => window.API_BASE || "/api";
const KEYS = () => window.STORAGE_KEYS || { TOKEN: "cbc_token", USER: "cbc_user" };

// ── Session ───────────────────────────────────────────────────────
export function getToken()  { return sessionStorage.getItem(KEYS().TOKEN); }
export function getUser()   {
  try { return JSON.parse(sessionStorage.getItem(KEYS().USER) || "null"); }
  catch { return null; }
}
export function setSession(token, user) {
  sessionStorage.setItem(KEYS().TOKEN, token);
  sessionStorage.setItem(KEYS().USER, JSON.stringify(user));
}
export function clearSession() {
  sessionStorage.removeItem(KEYS().TOKEN);
  sessionStorage.removeItem(KEYS().USER);
}

// ── XSS escape ────────────────────────────────────────────────────
export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Route guard — reads local session only, no network call ──────
export function guardPage(allowedRoles = []) {
  const user  = getUser();
  const token = getToken();
  if (!user || !token) {
    window.location.replace("/login.html");
    return null;
  }
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    window.location.replace("/login.html");
    return null;
  }
  return user;
}

// ── Core fetch ────────────────────────────────────────────────────
// NEVER auto-redirects. Returns one of:
//   { success: true,  ...data }               — HTTP 2xx
//   { success: false, ...data, _status: N }   — HTTP 4xx/5xx (including 401)
//   { success: false, message, _networkError } — fetch() threw (offline/timeout)
export async function apiFetch(path, { method = "GET", body = null, params = null } = {}) {
  const token = getToken();
  const base  = BASE();

  // Build absolute URL
  let fullUrl;
  try {
    if (base.startsWith("http")) {
      fullUrl = base.replace(/\/$/, "") + path;
    } else {
      fullUrl = window.location.origin + base.replace(/\/$/, "") + path;
    }
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

    // Tag the response with HTTP status — callers use this to decide redirect
    data._status = res.status;
    return data;

  } catch (e) {
    // Network failure (offline, CORS blocked, timeout, DNS fail)
    console.error("API network error:", path, e.message);
    return {
      success: false,
      message: "Network error. Please check your connection.",
      _networkError: true,
    };
  }
}

// ── verifySession — safe session check ───────────────────────────
// Returns: { ok: true, user }
//       or { ok: false, reason: "auth" | "network" | "school" }
// Does NOT redirect. Callers decide based on reason.
export async function verifySession() {
  const result = await apiFetch("/auth/verify");
  if (!result)                return { ok: false, reason: "auth" };
  if (result._networkError)   return { ok: false, reason: "network" };
  if (result._status === 401) return { ok: false, reason: "auth" };
  if (result._status === 403) return { ok: false, reason: "school" };
  if (!result.success)        return { ok: false, reason: "auth" };
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
