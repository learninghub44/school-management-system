/**
 * CBC School ERP — Frontend API Client v4.0
 * All calls are authenticated via Bearer JWT stored in sessionStorage
 */

const BASE = window.API_BASE || "/api";

// ── Session helpers ───────────────────────────────────────────────
export function getToken()    { return sessionStorage.getItem("token"); }
export function getUser()     { return JSON.parse(sessionStorage.getItem("user") || "null"); }
export function setSession(token, user) {
  sessionStorage.setItem("token", token);
  sessionStorage.setItem("user", JSON.stringify(user));
}
export function clearSession() {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
}

// ── XSS escape ────────────────────────────────────────────────────
export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Route guard ───────────────────────────────────────────────────
export function guardPage(allowedRoles = []) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) { window.location.href = "/login.html"; return null; }
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    window.location.href = "/login.html"; return null;
  }
  return user;
}

// ── Core fetch ────────────────────────────────────────────────────
export async function apiFetch(path, { method="GET", body=null, params=null } = {}) {
  const token = getToken();
  const url = new URL(BASE + path, window.location.origin);
  if (params) Object.entries(params).forEach(([k,v]) => v !== undefined && v !== null && v !== "" && url.searchParams.set(k, v));
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body && method !== "GET") opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url.toString(), opts);
    const data = await res.json();
    if (res.status === 401) { clearSession(); window.location.href = "/login.html"; return null; }
    return data;
  } catch(e) {
    console.error("API error:", e);
    return { success: false, message: "Network error. Please check your connection." };
  }
}

// ── Logout ────────────────────────────────────────────────────────
export async function logout() {
  await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
  clearSession();
  window.location.href = "/login.html";
}

// ── Auth ──────────────────────────────────────────────────────────
export const auth = {
  login:          (d)  => apiFetch("/auth/login",           { method: "POST", body: d }),
  logout:         ()   => apiFetch("/auth/logout",          { method: "POST" }),
  verify:         ()   => apiFetch("/auth/verify"),
  changePassword: (d)  => apiFetch("/auth/change-password", { method: "POST", body: d }),
  auditLog:       ()   => apiFetch("/auth/audit-log"),
};

// ── Schools ───────────────────────────────────────────────────────
export const schools = {
  list:           ()       => apiFetch("/schools"),
  me:             ()       => apiFetch("/schools/me"),
  create:         (d)      => apiFetch("/schools",             { method: "POST",  body: d }),
  update:         (id, d)  => apiFetch(`/schools/${id}`,       { method: "PUT",   body: d }),
  toggle:         (id)     => apiFetch(`/schools/${id}/toggle`,{ method: "PATCH" }),
  learningAreas:  (p)      => apiFetch("/schools/learning-areas", { params: p }),
};

// ── Users ─────────────────────────────────────────────────────────
export const users = {
  list:           (p)      => apiFetch("/users",               { params: p }),
  get:            (id)     => apiFetch(`/users/${id}`),
  create:         (d)      => apiFetch("/users",               { method: "POST",  body: d }),
  update:         (id, d)  => apiFetch(`/users/${id}`,         { method: "PUT",   body: d }),
  deactivate:     (id)     => apiFetch(`/users/${id}`,         { method: "DELETE" }),
  resetPassword:  (id, pw) => apiFetch(`/users/${id}/reset-password`, { method: "POST", body: { new_password: pw } }),
};

// ── Departments ───────────────────────────────────────────────────
export const departments = {
  list:    (p)     => apiFetch("/departments",       { params: p }),
  create:  (d)     => apiFetch("/departments",       { method: "POST",   body: d }),
  update:  (id, d) => apiFetch(`/departments/${id}`, { method: "PUT",    body: d }),
  delete:  (id)    => apiFetch(`/departments/${id}`, { method: "DELETE" }),
};

// ── Teachers ──────────────────────────────────────────────────────
export const teachers = {
  list:        (p)     => apiFetch("/teachers",              { params: p }),
  get:         (id)    => apiFetch(`/teachers/${id}`),
  create:      (d)     => apiFetch("/teachers",              { method: "POST",   body: d }),
  update:      (id, d) => apiFetch(`/teachers/${id}`,        { method: "PUT",    body: d }),
  deactivate:  (id)    => apiFetch(`/teachers/${id}`,        { method: "DELETE" }),
  assignments: (id)    => apiFetch(`/teachers/${id}/assignments`),
};

// ── Classes ───────────────────────────────────────────────────────
export const classes = {
  list:     (p)     => apiFetch("/classes",             { params: p }),
  get:      (id)    => apiFetch(`/classes/${id}`),
  students: (id)    => apiFetch(`/classes/${id}/students`),
  create:   (d)     => apiFetch("/classes",             { method: "POST",   body: d }),
  update:   (id, d) => apiFetch(`/classes/${id}`,       { method: "PUT",    body: d }),
  delete:   (id)    => apiFetch(`/classes/${id}`,       { method: "DELETE" }),
};

// ── Students ──────────────────────────────────────────────────────
export const students = {
  list:    (p)     => apiFetch("/students",              { params: p }),
  get:     (id)    => apiFetch(`/students/${id}`),
  create:  (d)     => apiFetch("/students",              { method: "POST",   body: d }),
  update:  (id, d) => apiFetch(`/students/${id}`,        { method: "PUT",    body: d }),
  promote: (d)     => apiFetch("/students/promote",      { method: "POST",   body: d }),
};

// ── Teacher Assignments ───────────────────────────────────────────
export const assignments = {
  list:   (p)  => apiFetch("/assignments",       { params: p }),
  create: (d)  => apiFetch("/assignments",       { method: "POST",   body: d }),
  delete: (id) => apiFetch(`/assignments/${id}`, { method: "DELETE" }),
};

// ── Attendance ────────────────────────────────────────────────────
export const attendance = {
  list:    (p)  => apiFetch("/attendance",       { params: p }),
  summary: (p)  => apiFetch("/attendance/summary", { params: p }),
  bulk:    (d)  => apiFetch("/attendance/bulk",  { method: "POST", body: d }),
  update:  (id, d) => apiFetch(`/attendance/${id}`, { method: "PUT", body: d }),
};

// ── Assessments ───────────────────────────────────────────────────
export const assessments = {
  list:   (p)  => apiFetch("/assessments",        { params: p }),
  report: (p)  => apiFetch("/assessments/report", { params: p }),
  create: (d)  => apiFetch("/assessments",        { method: "POST",   body: d }),
  delete: (id) => apiFetch(`/assessments/${id}`,  { method: "DELETE" }),
};

// ── Finance ───────────────────────────────────────────────────────
export const finance = {
  feeStructures:    (p)     => apiFetch("/finance/fee-structures",         { params: p }),
  createFee:        (d)     => apiFetch("/finance/fee-structures",         { method: "POST",   body: d }),
  deleteFee:        (id)    => apiFetch(`/finance/fee-structures/${id}`,   { method: "DELETE" }),
  payments:         (p)     => apiFetch("/finance/payments",               { params: p }),
  recordPayment:    (d)     => apiFetch("/finance/payments",               { method: "POST",   body: d }),
  summary:          (p)     => apiFetch("/finance/summary",                { params: p }),
  studentBalance:   (id, p) => apiFetch(`/finance/student-balance/${id}`,  { params: p }),
};

// ── Reports ───────────────────────────────────────────────────────
export const reports = {
  dashboard:        (p)     => apiFetch("/reports/dashboard",       { params: p }),
  reportCards:      (p)     => apiFetch("/reports/cards",           { params: p }),
  generateCard:     (d)     => apiFetch("/reports/cards",           { method: "POST", body: d }),
  publishCard:      (id)    => apiFetch(`/reports/cards/${id}/publish`, { method: "POST" }),
  timetable:        (p)     => apiFetch("/reports/timetable",       { params: p }),
  createSlot:       (d)     => apiFetch("/reports/timetable",       { method: "POST", body: d }),
  deleteSlot:       (id)    => apiFetch(`/reports/timetable/${id}`, { method: "DELETE" }),
};
