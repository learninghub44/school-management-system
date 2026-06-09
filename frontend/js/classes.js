import { supabase } from "./core/supabaseClient.js";

/* =========================
   LOAD CLASSES
========================= */
async function loadClasses() {

    const { data, error } = await supabase
        .from("classes")
        .select("*");

    if (error) {
        console.error(error);
        return;
    }

    const table = document.getElementById("classTable");
    if (!table) return;

    table.innerHTML = "";

    data?.forEach(c => {

        table.innerHTML += `
        <tr>
            <td>${c.class_name}</td>
            <td>${c.teacher_email || ""}</td>
            <td>${c.grade_level || ""}</td>
            <td>
                <button onclick="editClass('${c.id}')">Edit</button>
                <button onclick="deleteClass('${c.id}')">Delete</button>
            </td>
        </tr>
        `;
    });
}

/* =========================
   CREATE CLASS
========================= */
async function createClass() {

    const className = document.getElementById("className")?.value;
    const gradeLevel = document.getElementById("gradeLevel")?.value;
    const teacherEmail = document.getElementById("teacherEmail")?.value;

    if (!className) {
        alert("Class name required");
        return;
    }

    const { error } = await supabase
        .from("classes")
        .insert([
            {
                class_name: className,
                grade_level: gradeLevel,
                teacher_email: teacherEmail
            }
        ]);

    if (error) {
        console.error(error);
        alert("Failed to create class");
        return;
    }

    alert("Class created successfully");
    loadClasses();
    document.getElementById("classForm")?.reset();
}

/* =========================
   EDIT CLASS
========================= */
async function editClass(id) {
    const newName = prompt("Enter new class name:");
    if (!newName) return;

    const { error } = await supabase
        .from("classes")
        .update({ class_name: newName })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert("Failed to edit class");
        return;
    }

    alert("Class updated");
    loadClasses();
}

/* =========================
   DELETE CLASS
========================= */
async function deleteClass(id) {
    if (!confirm("Are you sure you want to delete this class?")) return;

    const { error } = await supabase
        .from("classes")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert("Failed to delete class");
        return;
    }

    alert("Class deleted");
    loadClasses();
}

/* =========================
   INIT
========================= */
async function initClasses() {
    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            window.location.href = "../login.html";
            return;
        }

        await loadClasses();

        const form = document.getElementById("classForm");
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                await createClass();
            });
        }
    } catch (error) {
        console.error("Error in initClasses:", error);
    }
}

/* AUTO-INIT ON LOAD */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initClasses);
} else {
    initClasses();
}

/* EXPORT FOR GLOBAL ACCESS */
window.createClass = createClass;
window.editClass = editClass;
window.deleteClass = deleteClass;
window.loadClasses = loadClasses;
        return;
    }

    alert("Class created successfully");

    loadClasses();
}

/* expose */
window.createClass = createClass;

/* init */
loadClasses();
