import { supabase } from "./supabaseClient.js";

/* =========================
   PARENTS PORTAL
========================= */

let reports = [];
let children = [];
let cbcReports = [];

/* =========================
   GET PARENT INFO
========================= */
async function getParentInfo() {
    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            window.location.href = "login.html";
            return null;
        }

        const parentEmailEl = document.getElementById("parentEmail");
        if (parentEmailEl) parentEmailEl.innerText = user.email;
        return user;
    } catch (error) {
        console.error("Error getting parent info:", error);
    }
}

/* =========================
   LOAD CHILDREN
========================= */
async function loadChildren(parentEmail) {
    try {
        const { data, error } = await supabase
            .from("students")
            .select("*")
            .eq("parent_email", parentEmail);

        if (error) {
            console.error("Error loading children:", error);
            return;
        }

        children = data || [];

        const select = document.getElementById("childSelect");
        if (!select) return;

        select.innerHTML = "";

        children.forEach(child => {
            const option = document.createElement("option");
            option.value = child.admission_no;
            option.text = `${child.first_name} ${child.last_name}`;
            select.appendChild(option);
        });

        if (children.length > 0) {
            select.dispatchEvent(new Event("change"));
        }
    } catch (error) {
        console.error("Error in loadChildren:", error);
    }
}

/* =========================
   LOAD REPORTS FOR SELECTED CHILD
========================= */
async function loadReports() {
    try {
        const admissionNo = document.getElementById("childSelect")?.value;

        if (!admissionNo) return;

        const { data, error } = await supabase
            .from("results")
            .select("*")
            .eq("admission_no", admissionNo)
            .order("term", { ascending: false });

        if (error) {
            console.error("Error loading reports:", error);
            return;
        }

        reports = data || [];

        const container = document.getElementById("reportsContainer");
        if (!container) return;

        container.innerHTML = "";

        if (reports.length === 0) {
            container.innerHTML = "<p>No reports available yet.</p>";
            return;
        }

        reports.forEach(report => {
            const reportHTML = `
                <div style="border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px;">
                    <h4>Term ${report.term} - ${report.year}</h4>
                    <p><strong>Subject:</strong> ${report.subject || ""}</p>
                    <p><strong>CA Score:</strong> ${report.ca_score || 0} / 40</p>
                    <p><strong>Exam Score:</strong> ${report.exam_score || 0} / 60</p>
                    <p><strong>Grade:</strong> <span style="background: #007bff; color: white; padding: 5px 10px; border-radius: 3px;">${report.final_grade}</span></p>
                    <p><strong>Remarks:</strong> ${report.remarks || ""}</p>
                </div>
            `;
            container.innerHTML += reportHTML;
        });
    } catch (error) {
        console.error("Error in loadReports:", error);
    }
}

/* =========================
   LOAD FEES SUMMARY
========================= */
async function loadFeesSummary() {
    try {
        const admissionNo = document.getElementById("childSelect")?.value;

        if (!admissionNo) return;

        const { data: fees, error } = await supabase
            .from("finance")
            .select("*")
            .eq("admission_no", admissionNo);

        if (error) {
            console.error("Error loading fees:", error);
            return;
        }

        const container = document.getElementById("feesContainer");
        if (!container) return;

        container.innerHTML = "";

        if (!fees || fees.length === 0) {
            container.innerHTML = "<p>No fee records found.</p>";
            return;
        }

        const totalAmount = fees.reduce((sum, f) => sum + (f.amount || 0), 0);
        const totalPaid = fees.reduce((sum, f) => sum + (f.paid || 0), 0);
        const balance = totalAmount - totalPaid;

        const feesHTML = `
            <div style="padding: 10px; background: #f5f5f5; border-radius: 5px;">
                <p><strong>Total Amount:</strong> Kes ${totalAmount}</p>
                <p><strong>Amount Paid:</strong> Kes ${totalPaid}</p>
                <p><strong>Balance:</strong> <span style="color: ${balance > 0 ? 'red' : 'green'};"><strong>Kes ${balance}</strong></span></p>
            </div>
        `;
        container.innerHTML += feesHTML;
    } catch (error) {
        console.error("Error in loadFeesSummary:", error);
    }
}

/* =========================
   LOAD ATTENDANCE
========================= */
async function loadAttendance() {
    try {
        const admissionNo = document.getElementById("childSelect")?.value;

        if (!admissionNo) return;

        const { data: attendance, error } = await supabase
            .from("attendance")
            .select("*")
            .eq("admission_no", admissionNo)
            .order("date", { ascending: false })
            .limit(30);

        if (error) {
            console.error("Error loading attendance:", error);
            return;
        }

        const container = document.getElementById("attendanceContainer");
        if (!container) return;

        container.innerHTML = "";

        if (!attendance || attendance.length === 0) {
            container.innerHTML = "<p>No attendance records found.</p>";
            return;
        }

        const present = attendance.filter(a => a.status === "present").length;
        const absent = attendance.filter(a => a.status === "absent").length;
        const percentage = ((present / attendance.length) * 100).toFixed(2);

        const attendanceHTML = `
            <div style="padding: 10px; background: #f5f5f5; border-radius: 5px;">
                <p><strong>Attendance Rate:</strong> ${percentage}%</p>
                <p><strong>Present:</strong> ${present} days</p>
                <p><strong>Absent:</strong> ${absent} days</p>
            </div>
        `;
        container.innerHTML += attendanceHTML;
    } catch (error) {
        console.error("Error in loadAttendance:", error);
    }
}

/* =========================
   INIT
========================= */
async function init() {
    try {
        const parent = await getParentInfo();
        if (!parent) return;

        await loadChildren(parent.email);

        const select = document.getElementById("childSelect");
        if (select) {
            select.addEventListener("change", async () => {
                await loadReports();
                await loadFeesSummary();
                await loadAttendance();
            });
        }
    } catch (error) {
        console.error("Error in init:", error);
    }
}

/* AUTO-INIT ON LOAD */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

/* EXPORT FOR GLOBAL ACCESS */
window.loadReports = loadReports;
window.loadFeesSummary = loadFeesSummary;
window.loadAttendance = loadAttendance;

};

/* LOAD SELECTED CHILD DATA */
function loadData(){

const name = document.getElementById("childSelect").value;

const child = children.find(c => c.name === name);

if(!child) return;

document.getElementById("attendance").innerText = child.attendance;
document.getElementById("fees").innerText = "KES " + child.fees;
document.getElementById("performance").innerText = child.performance;

renderReport(name);

}

/* CBC REPORT */
function renderReport(studentName){

const table = document.getElementById("reportTable");

table.innerHTML = "";

cbcReports
.filter(r => r.student === studentName)
.forEach(r => {

table.innerHTML += `
<tr>
<td>${r.learningArea}</td>
<td>${r.strand}</td>
<td>${r.score}</td>
<td>${r.score}</td>
<td>${r.comment}</td>
</tr>
`;

});

}