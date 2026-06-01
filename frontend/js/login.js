import { supabase } from "./supabaseClient.js";

/* =========================
   LOGIN EVENT LISTENER
========================= */
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showRegisterBtn = document.getElementById("showRegister");
const showLoginBtn = document.getElementById("showLogin");
const messageEl = document.getElementById("message");

if (showRegisterBtn && showLoginBtn) {
    showRegisterBtn.addEventListener("click", (e) => {
        e.preventDefault();
        loginForm.style.display = "none";
        registerForm.style.display = "block";
        if (messageEl) messageEl.style.display = "none";
    });

    showLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        registerForm.style.display = "none";
        loginForm.style.display = "block";
        if (messageEl) messageEl.style.display = "none";
    });
}

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = document.getElementById("email")?.value;
        const password = document.getElementById("password")?.value;
        const messageEl = document.getElementById("message");

        if (!email || !password) {
            if (messageEl) messageEl.innerText = "Email and password required";
            return;
        }

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                if (messageEl) messageEl.innerText = error.message;
                return;
            }

            // Get user role
            const user = data.user;
            const { data: roleData } = await supabase
                .from("users")
                .select("role")
                .eq("email", user.email)
                .single();

            const role = roleData?.role || "USER";

            // Store session
            sessionStorage.setItem("role", role);
            sessionStorage.setItem("email", user.email);
            sessionStorage.setItem("userId", user.id);
            
            // Clear any error messages
            const messageEl = document.getElementById("message");
            if (messageEl) {
                messageEl.className = "success";
                messageEl.innerText = "Login successful! Redirecting...";
            }

            // Redirect based on role
            if (role === "TEACHER") {
                window.location.href = "dashboard.html";
            } else if (role === "ADMIN") {
                window.location.href = "dashboard.html";
            } else if (role === "STUDENT") {
                window.location.href = "students/portal.html";
            } else if (role === "PARENT") {
                window.location.href = "parents/parents.html";
            } else {
                window.location.href = "dashboard.html";
            }
        } catch (err) {
            console.error("Login error:", err);
            if (messageEl) messageEl.innerText = "Login failed. Please try again.";
        }
    });
}

/* =========================
   REGISTER EVENT LISTENER
========================= */
if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = document.getElementById("regName")?.value;
        const email = document.getElementById("regEmail")?.value;
        const school_code = document.getElementById("regSchoolCode")?.value;
        const password = document.getElementById("regPassword")?.value;

        if (!email || !password || !name || !school_code) {
            if (messageEl) {
                messageEl.className = "error";
                messageEl.innerText = "All fields are required";
            }
            return;
        }

        try {
            // Call Backend API to register so school_code can be validated
            const response = await fetch("http://localhost:5000/api/auth/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name,
                    email,
                    password,
                    school_code,
                    role: "SCHOOL_ADMIN" // Defaulting to school admin for this form
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                if (messageEl) {
                    messageEl.className = "error";
                    messageEl.innerText = data.message || "Registration failed";
                }
                return;
            }

            if (messageEl) {
                messageEl.className = "success";
                messageEl.innerText = "Registration successful! You can now log in.";
                
                // Switch to login view
                registerForm.style.display = "none";
                loginForm.style.display = "block";
            }

        } catch (err) {
            console.error("Register error:", err);
            if (messageEl) {
                messageEl.className = "error";
                messageEl.innerText = "Registration failed. Please try again.";
            }
        }
    });
}

/* =========================
   CHECK IF ALREADY LOGGED IN
========================= */
async function checkExistingSession() {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            // User is already logged in, redirect to dashboard
            window.location.href = "dashboard.html";
        }
    } catch (error) {
        console.error("Session check error:", error);
    }
}

/* RUN ON PAGE LOAD */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkExistingSession);
} else {
    checkExistingSession();
}