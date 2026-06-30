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

async function hasActiveSubscription(user, token) {
  // SUPER_ADMIN manages the platform and is exempt from subscription checks.
  if (user?.role === "SUPER_ADMIN") return true;

  try {
    const base = window.API_BASE || "/api";
    const res  = await fetch(`${base}/subscriptions/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    const sub  = data?.data;
    return sub?.status === "active" || sub?.status === "trialing";
  } catch (_) {
    // Network error — don't block sign-in here; the dashboard's own
    // subscription check will catch it once connectivity is back.
    return true;
  }
}

function roleDestination(role) {
  return {
    SUPER_ADMIN: "/super-admin.html",
    PRINCIPAL: "/school-admin.html",
    DEPUTY_PRINCIPAL: "/school-admin.html",
    HOD: "/school-admin.html",
    TEACHER: "/teacher.html",
    BURSAR: "/bursar.html",
    PARENT: "/parent.html",
  }[role] || "/school-admin.html";
}

function getSchoolCode() {
  return (
    document.getElementById("school_code")?.value ||
    document.getElementById("schoolCode")?.value ||
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

    if (!username || !password) {
      setMessage("Username/email and password are required.");
      return;
    }

    const result = await auth.login({
      username,
      password,
      school_code: schoolCode || undefined,
    });

    if (!result?.success) {
      setMessage(result?.message || "Login failed. Please check your credentials.");
      return;
    }

    // Clear any redirect-loop guard before navigating away
    sessionStorage.removeItem("login_redirected");

    setSession(result.token, result.user);
    setMessage("Login successful. Redirecting...", "success");

    const activeSub = result.must_change_password
      ? true // change-password page handles its own redirect afterward
      : await hasActiveSubscription(result.user, result.token);

    window.location.href = result.must_change_password
      ? "/change-password.html"
      : !activeSub
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

async function redirectExistingSession() {
  const user = getUser();
  const token = getToken();

  // If we've already tried redirecting this session and ended up back here,
  // the token is bad — clear it and show the login form.
  if (sessionStorage.getItem("login_redirected")) {
    sessionStorage.removeItem("login_redirected");
    clearSession();
    return;
  }

  if (!user || !token) return;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (!payload.exp || payload.exp * 1000 > Date.now()) {
      // Mark that we are redirecting — if we come back, token was rejected
      sessionStorage.setItem("login_redirected", "1");
      const activeSub = await hasActiveSubscription(user, token);
      window.location.href = activeSub
        ? roleDestination(user.role)
        : "/subscription.html";
      return;
    }
  } catch (_) {
    // Bad token
  }

  clearSession();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", redirectExistingSession);
} else {
  redirectExistingSession();
}
