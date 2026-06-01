import { CBC_GRADES } from "./cbcData.js";

const gradeSelect =
document.getElementById("gradeSelect");

const subjectSelect =
document.getElementById("subjectSelect");

CBC_GRADES.forEach(item => {

    gradeSelect.innerHTML += `
        <option value="${item.grade}">
            ${item.grade}
        </option>
    `;
});

gradeSelect.addEventListener("change", () => {

    const selectedGrade =
    CBC_GRADES.find(
        g => g.grade === gradeSelect.value
    );

    subjectSelect.innerHTML = "";

    selectedGrade.subjects.forEach(subject => {

        subjectSelect.innerHTML += `
            <option value="${subject}">
                ${subject}
            </option>
        `;
    });
});

gradeSelect.dispatchEvent(new Event("change"));