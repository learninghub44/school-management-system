import { supabase } from "./supabaseClient.js";

/* =========================
   LOGIN FUNCTION
========================= */
window.login = async function () {

    const email = document.getElementById("email")?.value;
    const password = document.getElementById("password")?.value;

    if (!email || !password) {
        alert("Email and password required");
        return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        alert(error.message);
        return;
    }

    const user = data.user;

    /* GET ROLE */
    const { data: roleData, error: roleError } = await supabase
        .from("users")
        .select("role")
        .eq("email", user.email)
        .single();

    if (roleError) {
        console.error("Role error:", roleError);
        alert("Could not fetch user role");
        return;
    }

    const role = roleData?.role || "USER";

    sessionStorage.setItem("role", role);
    sessionStorage.setItem("email", user.email);
    sessionStorage.setItem("userId", user.id);

    /* OPTIONAL: TEACHER LINK CHECK */
    if (role === "TEACHER") {

        const { data: teacher } = await supabase
            .from("teachers")
            .select("*")
            .eq("email", user.email)
            .single();

        sessionStorage.setItem("teacherId", teacher?.id);
    }

    /* OPTIONAL: STUDENT LINK CHECK */
    if (role === "STUDENT") {

        const { data: student } = await supabase
            .from("students")
            .select("*")
            .eq("email", user.email)
            .single();

        sessionStorage.setItem("studentId", student?.id);
    }

    redirect(role);
};

/* =========================
   LOGOUT FUNCTION
========================= */
window.logout = async function () {
    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error("Logout error:", error);
        return;
    }

    sessionStorage.clear();
    window.location.href = "login.html";
};

/* =========================
   REDIRECT BASED ON ROLE
========================= */
function redirect(role) {

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
};

/* =========================
   CHECK IF USER IS LOGGED IN
========================= */
export async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? true : false;
}

/* =========================
   SIGN UP FUNCTION (ADMIN ONLY)
========================= */
window.signup = async function () {
    const email = document.getElementById("signupEmail")?.value;
    const password = document.getElementById("signupPassword")?.value;
    const role = document.getElementById("signupRole")?.value || "USER";

    if (!email || !password) {
        alert("Email and password required");
        return;
    }

    const { data, error } = await supabase.auth.signUp({
        email,
        password
    });

    if (error) {
        alert("Signup failed: " + error.message);
        return;
    }

    // Add user role
    const { error: roleError } = await supabase
        .from("users")
        .insert([{ email, role }]);

    if (roleError) {
        console.error("Role assignment error:", roleError);
    }

    alert("User created. Please log in.");
};

    }

    if (role === "ADMIN") {
        window.location.href = "dashboard.html";
    }

    if (role === "PARENT") {
        window.location.href = "parents/parents.html";
    }

    if (role === "FINANCE") {
        window.location.href = "finance/finance.html";
    }
}