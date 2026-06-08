// ── FIXED script block for teacher.html ───────────────────────────
// Replace the existing <script type="module"> block with this one.
// Changes:
//   1. clearSession added to import
//   2. verifySession handler uses !vRes.ok && reason !== "network" pattern

import { guardPage, esc, apiFetch, clearSession, attendance, assessments, classes, schools, verifySession } from "/js/api.js";
import { SHARED_CSS, buildSidebar, setupNav, openModal, closeModal, resetModal, showAlert, setLoading, injectStyles } from "/js/layout.js";

injectStyles();

let me = guardPage(["TEACHER"]);
if (!me) throw new Error("Unauthorized");

const vRes = await verifySession();
if (!vRes.ok && vRes.reason !== "network") {
  clearSession();
  window.location.replace("/login.html");
  throw new Error("Redirecting to login");
}
if (vRes.ok) me = vRes.user;

// ... rest of teacher.html script remains unchanged
