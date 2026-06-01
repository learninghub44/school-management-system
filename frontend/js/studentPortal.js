import { supabase } from "./supabaseClient.js";

/* =========================
   LOAD STUDENT PORTAL
========================= */
async function loadStudentPortal() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
            console.error("User not authenticated");
            return;
        }

        // Display student name
        document.getElementById("studentName").textContent = user.email || "Student";
        
        // Load student data
        const { data: student } = await supabase
            .from("students")
            .select("*")
            .eq("email", user.email)
            .single();

        if (student) {
            document.getElementById("sName").textContent = student.name || "";
            document.getElementById("sAdm").textContent = student.admission_no || "";
            document.getElementById("sGrade").textContent = student.grade || "";
        }
    } catch (error) {
        console.error("Error loading student portal:", error);
    }
}

/* INIT */
loadStudentPortal();
