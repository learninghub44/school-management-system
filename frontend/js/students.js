import { supabase } from "../js/supabaseClient.js";

/* =========================
   LOAD CLASSES (DROPDOWN)
========================= */
async function loadClassesDropdown() {

    const { data, error } = await supabase
        .from("classes")
        .select("*");

    if (error) {
        console.error(error);
        return;
    }

    const select = document.getElementById("classId");
    if (!select) return;

    select.innerHTML = `<option value="">Select Class</option>`;

    data.forEach(c => {
        select.innerHTML += `
            <option value="${c.id}">
                ${c.class_name}
            </option>
        `;
    });
}

/* =========================
   LOAD STUDENTS
========================= */
async function loadStudents() {

    const { data, error } = await supabase
        .from("students")
        .select("*");

    if (error) {
        console.error(error);
        return;
    }

    const table = document.getElementById("studentTable");
    table.innerHTML = "";

/* =========================
   LOAD STUDENTS
========================= */
async function loadStudents() {

    const { data, error } = await supabase
        .from("students")
        .select("*");

    if (error) {
        console.error(error);
        return;
    }

    const table = document.getElementById("studentTable");
    table.innerHTML = "";

    data.forEach(s => {

        table.innerHTML += `
        <tr>
            <td>${s.admission_no}</td>
            <td>${s.first_name} ${s.last_name}</td>
            <td>${s.email || ""}</td>
            <td>${s.date_of_birth || ""}</td>
            <td>${s.gender || ""}</td>
            <td>
                <button onclick="editStudent('${s.id}')">Edit</button>
                <button onclick="deleteStudent('${s.id}')">Delete</button>
            </td>
        </tr>
        `;
    });
}

/* =========================
   ADD STUDENT (WITH CLASS)
========================= */
async function addStudent() {

    const first_name = document.getElementById("firstName").value;
    const last_name = document.getElementById("lastName").value;
    const admission_no = document.getElementById("admissionNo").value;
    const email = document.getElementById("email").value;
    const date_of_birth = document.getElementById("dob").value;
    const gender = document.getElementById("gender").value;
    const grade = document.getElementById("grade").value;
    const class_id = document.getElementById("classId").value;

    if (!first_name || !last_name || !admission_no) {
        alert("Please fill in all required fields");
        return;
    }

    const { error } = await supabase
        .from("students")
        .insert([
            {
                first_name,
                last_name,
                admission_no,
                email,
                date_of_birth,
                gender,
                grade,
                class_id
            }
        ]);

    if (error) {
        console.error(error);
        alert("Failed to add student");
        return;
    }

    alert("Student added successfully");
    loadStudents();
    document.getElementById("studentForm").reset();
}

/* =========================
   EDIT STUDENT
========================= */
async function editStudent(id) {
    const newName = prompt("Enter new student name:");
    if (!newName) return;

    const { error } = await supabase
        .from("students")
        .update({ first_name: newName })
        .eq("id", id);

    if (error) {
        console.error(error);
        alert("Failed to edit student");
        return;
    }

    alert("Student updated");
    loadStudents();
}

/* =========================
   DELETE STUDENT
========================= */
async function deleteStudent(id) {
    if (!confirm("Are you sure you want to delete this student?")) return;

    const { error } = await supabase
        .from("students")
        .delete()
        .eq("id", id);

    if (error) {
        console.error(error);
        alert("Failed to delete student");
        return;
    }

    alert("Student deleted");
    loadStudents();
}

/* =========================
   INIT
========================= */
async function initStudents() {
    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            window.location.href = "../login.html";
            return;
        }

        await loadClassesDropdown();
        await loadStudents();

        const form = document.getElementById("studentForm");
        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();
                await addStudent();
            });
        }
    } catch (error) {
        console.error("Error in initStudents:", error);
    }
}

/* AUTO-INIT ON LOAD */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initStudents);
} else {
    initStudents();
}

/* EXPORT FOR GLOBAL ACCESS */
window.addStudent = addStudent;
window.editStudent = editStudent;
window.deleteStudent = deleteStudent;
window.loadStudents = loadStudents;

    alert("Student added successfully");

    loadStudents();
}

/* expose */
window.addStudent = addStudent;

/* INIT */
async function init() {
    await loadClassesDropdown();
    await loadStudents();
}

init();