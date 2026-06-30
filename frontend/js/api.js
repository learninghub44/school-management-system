/**
 * Kadem & Zetu School Management System — API Client v5.3
 *
 * Key design decisions:
 * - Single storage key pair (no tenant scoping) — simplest, most robust
 * - guardPage() only checks: token exists + not expired + role allowed
 *   NO tenant/subdomain checks — those caused redirect loops
 * - apiFetch() NEVER redirects — returns data + _status for callers
 * - verifySession() only redirects on genuine 401, not network errors
 */

const BASE = () => window.API_BASE || "/api";
const KEYS = () => window.STORAGE_KEYS || { TOKEN: "cbc_erp_token", USER: "cbc_erp_user" };

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

// ── Route guard ───────────────────────────────────────────────────
// ONLY checks: token exists + not expired + role is allowed
// No tenant/subdomain checks — those cause redirect loops
export function guardPage(allowedRoles = []) {
  const user  = getUser();
  const token = getToken();

  if (!user || !token) {
    window.location.replace("/login.html");
    return null;
  }

  // Check JWT expiry client-side (decode without verify)
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearSession();
      window.location.replace("/login.html");
      return null;
    }
  } catch (_) {
    // Can't decode — let backend verify it
  }

  // Role check
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    // Wrong role for this page — redirect to correct dashboard
    const dest = {
      SUPER_ADMIN:      "/super-admin.html",
      PRINCIPAL:        "/school-admin.html",
      DEPUTY_PRINCIPAL: "/school-admin.html",
      HOD:              "/school-admin.html",
      TEACHER:          "/teacher.html",
      BURSAR:           "/bursar.html",
      PARENT:           "/parent.html",
    }[user.role] || "/login.html";
    window.location.replace(dest);
    return null;
  }

  return user;
}

// ── Core fetch ────────────────────────────────────────────────────
// NEVER auto-redirects. Returns { ...data, _status: N } or { _networkError: true }
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
    catch {
      data = { success: false, message: friendlyStatusMessage(res.status) };
    }
    data._status = res.status;
    return data;
  } catch (e) {
    console.error("API error:", path, e.message);
    return { success: false, message: "Network error. Check your connection.", _networkError: true };
  }
}

// Fallback message when a response has no JSON body — this happens for raw
// platform-level errors (e.g. a Cloudflare edge 503) that never reach our
// app code, so there's no API-provided message to show.
function friendlyStatusMessage(status) {
  if (status === 503) return "The service is temporarily unavailable. Please try again in a moment — if this keeps happening, contact support.";
  if (status >= 500)  return "Something went wrong on our end. Please try again, and contact support if it continues.";
  if (status === 429) return "Too many requests — please wait a moment and try again.";
  return `Request failed (HTTP ${status}). Please try again.`;
}

// ── verifySession ─────────────────────────────────────────────────
export async function verifySession() {
  const result = await apiFetch("/auth/verify");
  if (!result)                return { ok: false, reason: "auth" };
  if (result._networkError)   return { ok: false, reason: "network" };
  if (result._status === 401) return { ok: false, reason: "auth" };
  if (result._status === 403) return { ok: false, reason: "auth" };
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
  promotionHistory: (p) => apiFetch("/students/promotion-history", { params: p }),
  knecRegistration: (id, d) => apiFetch(`/students/${id}/knec-registration`, { method: "PATCH", body: d }),
  guardians:     (id)    => apiFetch(`/students/${id}/guardians`),
  addGuardian:   (id, d) => apiFetch(`/students/${id}/guardians`, { method: "POST", body: d }),
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

export const subscriptions = {
  plans:          ()      => apiFetch("/subscriptions/plans"),
  createPlan:     (d)     => apiFetch("/subscriptions/plans",       { method: "POST", body: d }),
  updatePlan:     (id, d) => apiFetch(`/subscriptions/plans/${id}`, { method: "PUT",  body: d }),
  me:             (p)     => apiFetch("/subscriptions/me",          { params: p }),
  payments:       (p)     => apiFetch("/subscriptions/payments",    { params: p }),
  checkout:       (d)     => apiFetch("/subscriptions/paystack/checkout", { method: "POST", body: d }),
  activatePayment:(id)    => apiFetch(`/subscriptions/payments/${id}/activate`, { method: "POST" }),
  verifyPaystack: (ref)   => apiFetch(`/subscriptions/paystack/verify/${encodeURIComponent(ref)}`),
};

export const ai = {
  assist:             (d) => apiFetch("/ai/assist",              { method: "POST", body: d }),
  reportComment:      (d) => apiFetch("/ai/report-comment",      { method: "POST", body: d }),
  competencyAnalysis: (d) => apiFetch("/ai/competency-analysis", { method: "POST", body: d }),
  riskDetection:      (d) => apiFetch("/ai/risk-detection",      { method: "POST", body: d }),
};

export const reports = {
  dashboard:    (p)  => apiFetch("/reports/dashboard",           { params: p }),
  reportCards:  (p)  => apiFetch("/reports/cards",               { params: p }),
  generateCard: (d)  => apiFetch("/reports/cards",               { method: "POST", body: d }),
  publishCard:  (id) => apiFetch(`/reports/cards/${id}/publish`, { method: "POST" }),
  timetable:    (p)  => apiFetch("/reports/timetable",           { params: p }),
  createSlot:   (d)  => apiFetch("/reports/timetable",           { method: "POST", body: d }),
  deleteSlot:   (id) => apiFetch(`/reports/timetable/${id}`,     { method: "DELETE" }),
  analytics:    (p)  => apiFetch("/reports/analytics",           { params: p }),
};

export const exams = {
  list:   (p)      => apiFetch("/exams",        { params: p }),
  create: (d)      => apiFetch("/exams",        { method: "POST",   body: d }),
  update: (id, d)  => apiFetch(`/exams/${id}`,  { method: "PUT",    body: d }),
  delete: (id)     => apiFetch(`/exams/${id}`,  { method: "DELETE" }),
};

export const portfolio = {
  list:   (p)      => apiFetch("/portfolio",        { params: p }),
  create: (d)      => apiFetch("/portfolio",        { method: "POST",   body: d }),
  delete: (id)     => apiFetch(`/portfolio/${id}`,  { method: "DELETE" }),
};

export const observations = {
  list:   (p)      => apiFetch("/observations",        { params: p }),
  create: (d)      => apiFetch("/observations",        { method: "POST",   body: d }),
  delete: (id)     => apiFetch(`/observations/${id}`,  { method: "DELETE" }),
};

export const interventions = {
  list:   (p)      => apiFetch("/interventions",        { params: p }),
  create: (d)      => apiFetch("/interventions",        { method: "POST",   body: d }),
  update: (id, d)  => apiFetch(`/interventions/${id}`,  { method: "PATCH",  body: d }),  // route is PATCH
  delete: (id)     => apiFetch(`/interventions/${id}`,  { method: "DELETE" }),
  addNote:(id, d)  => apiFetch(`/interventions/${id}/updates`, { method: "POST", body: d }),
};

export const moderation = {
  list:         (p)      => apiFetch("/moderation",                     { params: p }),
  lock:         (id, d)  => apiFetch(`/moderation/${id}/lock`,          { method: "POST", body: d }),  // body={term,academic_year,is_locked}
  moderate:     (id, d)  => apiFetch(`/moderation/${id}/moderate`,      { method: "POST", body: d }),  // frontend calls .moderate()
  academicYears:(p)      => apiFetch("/moderation/academic-years",      { params: p }),                // frontend calls .academicYears()
  createYear:   (d)      => apiFetch("/moderation/academic-years",      { method: "POST", body: d }),
  bulkAssess:   (d)      => apiFetch("/moderation/bulk-assess",         { method: "POST", body: d }),
  bulkPromote:  (d)      => apiFetch("/moderation/bulk-promote",        { method: "POST", body: d }),
};

export const parentPortal = {
  children:     ()      => apiFetch("/parent/children"),
  reportCards:  (id, p) => apiFetch(`/parent/children/${id}/report-cards`, { params: p }),
  attendance:   (id, p) => apiFetch(`/parent/children/${id}/attendance`,   { params: p }),
  fees:         (id, p) => apiFetch(`/parent/children/${id}/fees`,        { params: p }),
};
