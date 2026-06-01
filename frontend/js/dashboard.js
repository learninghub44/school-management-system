import { supabase } from "./supabaseClient.js";

/* =========================
   CHECK SESSION
========================= */
async function checkUser() {

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = "login.html";
        return null;
    }

    return user;
}

/* =========================
   APPLY ROLE SECURITY
========================= */
function applyRole(role) {

    // FINANCE PROTECTION
    const finance = document.getElementById("financeMenu");
    if (finance && role !== "ADMIN" && role !== "FINANCE") {
        finance.style.display = "none";
    }

    // TEACHER PROTECTION
    const teaching = document.getElementById("teachingMenu");
    if (teaching && role !== "ADMIN" && role !== "TEACHER") {
        teaching.style.display = "none";
    }

    // STUDENT PROTECTION
    const student = document.getElementById("studentMenu");
    if (student && role !== "ADMIN" && role !== "STUDENT") {
        student.style.display = "none";
    }

    // PARENT PROTECTION
    const parent = document.getElementById("parentMenu");
    if (parent && role !== "ADMIN" && role !== "PARENT") {
        parent.style.display = "none";
    }

    window.userRole = role;
}

/* =========================
   LOAD DASHBOARD STATS
========================= */
async function loadDashboardStats() {
    try {
        // Total Students
        const { count: studentCount } = await supabase
            .from("students")
            .select("*", { count: "exact", head: true });

        // Total Teachers
        const { count: teacherCount } = await supabase
            .from("teachers")
            .select("*", { count: "exact", head: true });

        // Total Assessments
        const { count: assessmentCount } = await supabase
            .from("assessments")
            .select("*", { count: "exact", head: true });

        const studentsEl = document.getElementById("totalStudents");
        if (studentsEl) studentsEl.innerText = studentCount || 0;
        
        const teachersEl = document.getElementById("totalTeachers");
        if (teachersEl) teachersEl.innerText = teacherCount || 0;
        
        const assessmentsEl = document.getElementById("totalAssessments");
        if (assessmentsEl) assessmentsEl.innerText = assessmentCount || 0;

    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

/* =========================
   INIT
========================= */
async function init() {

    const user = await checkUser();
    if (!user) return;

    const { data } = await supabase
        .from("users")
        .select("role")
        .eq("email", user.email)
        .single();

    const role = data?.role || "USER";

    applyRole(role);

    const roleText = document.getElementById("roleText");
    if (roleText) roleText.innerText = role;

    const userEmail = document.getElementById("userEmail");
    if (userEmail) userEmail.innerText = user.email;

    await loadDashboardStats();

    // Add logout button listener
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            await supabase.auth.signOut();
            sessionStorage.clear();
            window.location.href = "login.html";
        });
    }
}

/* AUTO-INIT ON LOAD */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

/* EXPORT FOR GLOBAL ACCESS */
window.loadDashboardStats = loadDashboardStats;

init();