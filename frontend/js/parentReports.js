import { supabase } from "./core/supabaseClient.js";

/* =========================
   GET PARENT USER
========================= */
async function getParent() {

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = "../login.html";
        return null;
    }

    document.getElementById("parentEmail").innerText = user.email;

    return user;
}

/* =========================
   LOAD CHILDREN
========================= */
async function loadChildren(parentEmail) {

    const { data } = await supabase
        .from("students")
        .select("*")
        .eq("parent_email", parentEmail);

    const select = document.getElementById("childSelect");
    select.innerHTML = "";

    data.forEach(child => {

        const option = document.createElement("option");
        option.value = child.admission_no;
        option.text = `${child.first_name} ${child.last_name}`;

        select.appendChild(option);
    });
}

/* =========================
   LOAD REPORTS
========================= */
async function loadReports() {

    const admissionNo = document.getElementById("childSelect").value;

    const { data } = await supabase
        .from("results")
        .select("*")
        .eq("admission_no", admissionNo)
        .order("term", { ascending: false });

    if (!data) return;

    const container = document.getElementById("reportsList");
    container.innerHTML = "";

    data.forEach(r => {
        container.innerHTML += `
            <div style="border: 1px solid #ddd; padding: 10px; margin: 10px 0;">
                <h4>Term ${r.term} - ${r.year}</h4>
                <p><strong>Subject:</strong> ${r.subject}</p>
                <p><strong>CA:</strong> ${r.ca_score}/40</p>
                <p><strong>Exam:</strong> ${r.exam_score}/60</p>
                <p><strong>Grade:</strong> ${r.final_grade}</p>
                <p><strong>Remarks:</strong> ${r.remarks || ""}</p>
            </div>
        `;
    });
}

/* =========================
   INIT ON PAGE LOAD
========================= */
async function initReports() {
    const parent = await getParent();
    if (parent) {
        await loadChildren(parent.email);
        
        const select = document.getElementById("childSelect");
        if (select) {
            select.addEventListener("change", loadReports);
        }
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReports);
} else {
    initReports();
}
        .from("assessments")
        .select("*")
        .eq("student", admissionNo)
        .order("created_at", { ascending: false });

    const table = document.getElementById("reportTable");
    table.innerHTML = "";

    data.forEach(r => {

        table.innerHTML += `
        <tr>
            <td>${r.learning_area}</td>
            <td>${r.strand || ""}</td>
            <td>${r.score}</td>
            <td>${r.comment || ""}</td>
            <td>${r.teacher_email || ""}</td>
        </tr>
        `;
    });
}

/* =========================
   INIT
========================= */
async function init() {

    const parent = await getParent();
    if (!parent) return;

    await loadChildren(parent.email);
}

/* expose */
window.loadReports = loadReports;

init();
