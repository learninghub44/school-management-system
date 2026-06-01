import { supabase } from "./supabaseClient.js";

/* =========================
   LOAD TEACHERS
========================= */
async function loadTeachers() {

    const { data, error } = await supabase
        .from("teachers")
        .select("*");

    if (error) {
        console.error(error);
        return;
    }

    const table = document.getElementById("teacherTable");
    if (!table) return;

    table.innerHTML = "";

    data?.forEach(t => {

        table.innerHTML += `
        <tr>
            <td>${t.first_name} ${t.last_name}</td>
            <td>${t.email}</td>
            <td>${t.phone || ""}</td>
            <td>${t.department || ""}</td>
            <td>${t.subjects || ""}</td>
            <td>
                <button onclick="editTeacher('${t.id}')">Edit</button>
                <button onclick="deleteTeacher('${t.id}')">Delete</button>
            </td>
        </tr>
        `;
    });
}

/* =========================
   ADD TEACHER
========================= */
async function addTeacher() {

    const first_name = document.getElementById("tFirstName")?.value;
    const last_name = document.getElementById("tLastName")?.value;
    const email = document.getElementById("tEmail")?.value;
    const phone = document.getElementById("tPhone")?.value;
    const department = document.getElementById("tDepartment")?.value;
    const subjects = document.getElementById("tSubjects")?.value;

    if (!email || !first_name || !last_name) {
        alert("Name and email required");
        return;
    }

    /* STEP 1: CREATE USER ROLE */
    const { error: userError } = await supabase
        .from("users")
        .insert([
            {
                email: email,
                role: "TEACHER"
            }
        ]);

    if (userError && userError.code !== "23505") {
        console.error(userError);
        alert("Failed to create user role");
        return;
    }

    /* STEP 2: CREATE TEACHER RECORD */
    const { error: teacherError } = await supabase
        .from("teachers")
        .insert([
            {
                first_name,
                last_name,
                email,
                phone,
                department,
                subjects
            }
        ]);

    if (teacherError) {
        console.error(teacherError);
        alert("Failed to add teacher");
        return;
    }

    alert("Teacher added successfully");
    loadTeachers();
    document.getElementById("teacherForm")?.reset();
}

/* =========================
   EDIT TEACHER
========================= */
async function editTeacher(id) {
    const newPhone = prompt("Enter new phone number:");
    if (!newPhone) return;

    const { error } = await supabase
        .from("teachers")
        .update({ phone: newPhone })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert("Failed to edit teacher");
        return;
    }

    alert("Teacher updated");
    loadTeachers();
}

/* =========================
   DELETE TEACHER
========================= */
async function deleteTeacher(id) {
    if (!confirm("Are you sure you want to delete this teacher?")) return;

    const { error } = await supabase
        .from("teachers")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert("Failed to delete teacher");
        return;
    }

    alert("Teacher deleted");
    loadTeachers();
}

/* =========================
   INIT
========================= */
async function initTeachers() {
    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            window.location.href = "login.html";
            return;
        }

        await loadTeachers();

        const form = document.getElementById("teacherForm");
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                await addTeacher();
            });
        }
    } catch (error) {
        console.error("Error in initTeachers:", error);
    }
}

/* AUTO-INIT ON LOAD */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTeachers);
} else {
    initTeachers();
}

/* AUTO-INIT ON LOAD - FIXED ISSUE */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTeachers);
} else {
    initTeachers();
}

/* EXPORT FOR GLOBAL ACCESS */
window.addTeacher = addTeacher;
window.editTeacher = editTeacher;
window.deleteTeacher = deleteTeacher;
window.loadTeachers = loadTeachers;
window.initTeachers = initTeachers;
        ]);

    if (userError) {
        console.error(userError);
        alert("User role creation failed");
        return;
    }

    /* STEP 2: CREATE TEACHER PROFILE */
    const { error: teacherError } = await supabase
        .from("teachers")
        .insert([
            {
                name: name,
                email: email,
                phone: phone,
                department: "General"
            }
        ]);

    if (teacherError) {
        console.error(teacherError);
        alert("Teacher profile creation failed");
        return;
    }

    alert("Teacher linked successfully");

    loadTeachers();
}

/* expose */
window.addTeacher = addTeacher;

/* INIT */
loadTeachers();