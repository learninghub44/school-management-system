import { auth, clearSession, getToken, getUser, setSession } from "./api.js";

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showRegisterBtn = document.getElementById("showRegister");
const showLoginBtn = document.getElementById("showLogin");
const messageEl = document.getElementById("message");

function setMessage(message, type = "error") {
  if (!messageEl) return;
  messageEl.className = type === "success" ? "alert alert-ok show" : "alert alert-err show";
  messageEl.textContent = message;
  messageEl.style.display = "block";
}

function hasActiveSubscription(user) {
  if (!user || user.role === "SUPER_ADMIN") return true;
  if (!["active", "trialing"].includes(user.subscription_status)) return false;
  if (!user.subscription_expires_at) return true;
  return new Date(user.subscription_expires_at) >= new Date();
}

function roleDestination(role) {
  return {
    SUPER_ADMIN: "/super-admin.html",
    PRINCIPAL: "/school-admin.html",
    DEPUTY_PRINCIPAL: "/school-admin.html",
    HOD: "/school-admin.html",
    TEACHER: "/teacher.html",
    BURSAR: "/bursar.html",
  }[role] || "/school-admin.html";
}

function getSchoolCode() {
  return (
    document.getElementById("school_code")?.value ||
    document.getElementById("schoolCode")?.value ||
    window.TENANT?.schoolCode ||
    ""
  ).trim().toUpperCase();
}

if (showRegisterBtn && showLoginBtn && registerForm && loginForm) {
  showRegisterBtn.addEventListener("click", (event) => {
    event.preventDefault();
    loginForm.style.display = "none";
    registerForm.style.display = "block";
    if (messageEl) messageEl.style.display = "none";
  });

  showLoginBtn.addEventListener("click", (event) => {
    event.preventDefault();
    registerForm.style.display = "none";
    loginForm.style.display = "block";
    if (messageEl) messageEl.style.display = "none";
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = (
      document.getElementById("username")?.value ||
      document.getElementById("email")?.value ||
      ""
    ).trim();
    const password = document.getElementById("password")?.value || "";
    const schoolCode = getSchoolCode();
    const isSuperAdmin = window.TENANT?.isSuperAdmin || schoolCode === "ADMIN100";

    if (!username || !password) {
      setMessage("Username/email and password are required.");
      return;
    }
    if (!isSuperAdmin && !schoolCode) {
      setMessage("School code is required.");
      return;
    }

    const result = await auth.login({
      username,
      password,
      school_code: isSuperAdmin ? undefined : schoolCode,
    });

    if (!result?.success) {
      setMessage(result?.message || "Login failed. Please check your credentials.");
      return;
    }

    setSession(result.token, result.user);
    setMessage("Login successful. Redirecting...", "success");

    window.location.href = result.must_change_password
      ? "/change-password.html"
      : !hasActiveSubscription(result.user)
      ? "/subscription.html"
      : roleDestination(result.user.role);
  });
}

if (registerForm) {
  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setMessage("Self-registration is disabled. A school administrator must create the account.");
  });
}

function redirectExistingSession() {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (!payload.exp || payload.exp * 1000 > Date.now()) {
      window.location.href = hasActiveSubscription(user) ? roleDestination(user.role) : "/subscription.html";
      return;
    }
  } catch (_) {
    // Bad local token; clear below.
  }

  clearSession();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", redirectExistingSession);
} else {
  redirectExistingSession();
}
