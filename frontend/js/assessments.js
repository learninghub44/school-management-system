import { supabase } from "./supabaseClient.js";

import {
    CBC_GRADES,
    CBC_GRADES_SCALE,
    SCHOOL_TERMS,
    ACADEMIC_YEARS,
    getSubjectsByGrade
} from "./cbcData.js";

/*
=====================================
ELEMENTS
=====================================
*/

const gradeSelect =
document.getElementById("grade");

const subjectSelect =
document.getElementById("subject");

const termSelect =
document.getElementById("term");

const yearSelect =
document.getElementById("year");

const studentSelect =
document.getElementById("student");

const scoreInput =
document.getElementById("score");

const tableBody =
document.getElementById("assessmentTable");

/*
=====================================
LOAD DROPDOWNS
=====================================
*/

function loadGrades() {

    gradeSelect.innerHTML = "";

    CBC_GRADES.forEach(g => {

        gradeSelect.innerHTML += `
            <option value="${g.grade}">
                ${g.grade}
            </option>
        `;
    });

    loadSubjects();
}

function loadSubjects() {

    const subjects =
    getSubjectsByGrade(
        gradeSelect.value
    );

    subjectSelect.innerHTML = "";

    subjects.forEach(subject => {

        subjectSelect.innerHTML += `
            <option value="${subject}">
                ${subject}
            </option>
        `;
    });
}

function loadTerms() {

    termSelect.innerHTML = "";

    SCHOOL_TERMS.forEach(term => {

        termSelect.innerHTML += `
            <option value="${term}">
                ${term}
            </option>
        `;
    });
}

function loadYears() {

    yearSelect.innerHTML = "";

    ACADEMIC_YEARS.forEach(year => {

        yearSelect.innerHTML += `
            <option value="${year}">
                ${year}
            </option>
        `;
    });
}

/*
=====================================
GRADE CHANGES
=====================================
*/

gradeSelect.addEventListener(
    "change",
    loadSubjects
);

/*
=====================================
LOAD STUDENTS
=====================================
*/

async function loadStudents() {

    const { data, error } =
    await supabase
    .from("students")
    .select("*")
    .order("full_name");

    if (error) {

        console.error(error);
        return;
    }

    studentSelect.innerHTML = "";

    data.forEach(student => {

        studentSelect.innerHTML += `
            <option value="${student.id}">
                ${student.full_name}
            </option>
        `;
    });
}

/*
=====================================
CBC PERFORMANCE LEVEL
=====================================
*/

function getPerformanceLevel(score) {

    score = Number(score);

    if (score >= 80) {
        return "EE";
    }

    if (score >= 60) {
        return "ME";
    }

    if (score >= 40) {
        return "AE";
    }

    return "BE";
}

/*
=====================================
SAVE ASSESSMENT
=====================================
*/

async function saveAssessment() {

    const student_id =
    studentSelect.value;

    const grade_level =
    gradeSelect.value;

    const subject =
    subjectSelect.value;

    const term =
    termSelect.value;

    const academic_year =
    yearSelect.value;

    const score =
    Number(scoreInput.value);

    const performance_level =
    getPerformanceLevel(score);

    const { error } =
    await supabase
    .from("assessments")
    .insert([
        {
            student_id,
            grade_level,
            subject,
            term,
            academic_year,
            score,
            performance_level
        }
    ]);

    if (error) {

        alert(error.message);
        return;
    }

    alert("Assessment Saved");

    scoreInput.value = "";

    loadAssessments();
}

/*
=====================================
LOAD ASSESSMENTS
=====================================
*/

async function loadAssessments() {

    const { data, error } =
    await supabase
    .from("assessments")
    .select(`
        *,
        students(full_name)
    `)
    .order(
        "created_at",
        { ascending: false }
    );

    if (error) {

        console.error(error);
        return;
    }

    tableBody.innerHTML = "";

    data.forEach(record => {

        tableBody.innerHTML += `
        <tr>

            <td>
                ${record.students?.full_name || ""}
            </td>

            <td>
                ${record.grade_level}
            </td>

            <td>
                ${record.subject}
            </td>

            <td>
                ${record.term}
            </td>

            <td>
                ${record.score}
            </td>

            <td>
                ${record.performance_level}
            </td>

        </tr>
        `;
    });
}

/*
=====================================
DELETE
=====================================
*/

async function deleteAssessment(id) {

    const confirmDelete =
    confirm(
        "Delete assessment?"
    );

    if (!confirmDelete) return;

    await supabase
    .from("assessments")
    .delete()
    .eq("id", id);

    loadAssessments();
}

/*
=====================================
WINDOW EXPORTS
=====================================
*/

window.saveAssessment =
saveAssessment;

window.deleteAssessment =
deleteAssessment;

/*
=====================================
INIT
=====================================
*/

loadGrades();
loadTerms();
loadYears();
loadStudents();
loadAssessments();