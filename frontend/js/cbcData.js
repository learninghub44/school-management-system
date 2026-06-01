
/*
========================================================
KENYA CBC SYSTEM (GRADE 1 - 12)
PRODUCTION READY DATA LAYER (ERP CORE)
========================================================
Used across:
- Assessments
- Students
- Teachers
- Reports
- Analytics
- Finance (fees by level)
========================================================
*/

export const CBC_GRADES = [

/* =========================
   LOWER PRIMARY (1–3)
========================= */

{
id: "G1",
grade: "Grade 1",
level: "Lower Primary",
pathway: "CBC_CORE",
cycle: "PP1",
subjects: [
{ id: "ENG_G1", name: "English" },
{ id: "KIS_G1", name: "Kiswahili" },
{ id: "MAT_G1", name: "Mathematics" },
{ id: "ENV_G1", name: "Environmental Activities" },
{ id: "CRE_G1", name: "Creative Arts" },
{ id: "RE_G1", name: "Religious Education" },
{ id: "PE_G1", name: "Physical & Health Education" }
]
},

{
id: "G2",
grade: "Grade 2",
level: "Lower Primary",
pathway: "CBC_CORE",
cycle: "PP1",
subjects: [
{ id: "ENG_G2", name: "English" },
{ id: "KIS_G2", name: "Kiswahili" },
{ id: "MAT_G2", name: "Mathematics" },
{ id: "ENV_G2", name: "Environmental Activities" },
{ id: "CRE_G2", name: "Creative Arts" },
{ id: "RE_G2", name: "Religious Education" },
{ id: "PE_G2", name: "Physical & Health Education" }
]
},

{
id: "G3",
grade: "Grade 3",
level: "Lower Primary",
pathway: "CBC_CORE",
cycle: "PP2",
subjects: [
{ id: "ENG_G3", name: "English" },
{ id: "KIS_G3", name: "Kiswahili" },
{ id: "MAT_G3", name: "Mathematics" },
{ id: "ENV_G3", name: "Environmental Activities" },
{ id: "CRE_G3", name: "Creative Arts" },
{ id: "RE_G3", name: "Religious Education" },
{ id: "PE_G3", name: "Physical & Health Education" }
]
},

/* =========================
   UPPER PRIMARY (4–6)
========================= */

{
id: "G4",
grade: "Grade 4",
level: "Upper Primary",
pathway: "CBC_CORE",
cycle: "PP2",
subjects: [
{ id: "ENG_G4", name: "English" },
{ id: "KIS_G4", name: "Kiswahili" },
{ id: "MAT_G4", name: "Mathematics" },
{ id: "SCI_G4", name: "Science & Technology" },
{ id: "SOC_G4", name: "Social Studies" },
{ id: "AGR_G4", name: "Agriculture & Nutrition" },
{ id: "CRE_G4", name: "Creative Arts" },
{ id: "PE_G4", name: "Physical & Health Education" }
]
},

{
id: "G5",
grade: "Grade 5",
level: "Upper Primary",
pathway: "CBC_CORE",
cycle: "PP2",
subjects: [
{ id: "ENG_G5", name: "English" },
{ id: "KIS_G5", name: "Kiswahili" },
{ id: "MAT_G5", name: "Mathematics" },
{ id: "SCI_G5", name: "Science & Technology" },
{ id: "SOC_G5", name: "Social Studies" },
{ id: "AGR_G5", name: "Agriculture & Nutrition" },
{ id: "CRE_G5", name: "Creative Arts" },
{ id: "PE_G5", name: "Physical & Health Education" }
]
},

{
id: "G6",
grade: "Grade 6",
level: "Upper Primary",
pathway: "CBC_CORE",
cycle: "KPSEA",
subjects: [
{ id: "ENG_G6", name: "English" },
{ id: "KIS_G6", name: "Kiswahili" },
{ id: "MAT_G6", name: "Mathematics" },
{ id: "SCI_G6", name: "Science & Technology" },
{ id: "SOC_G6", name: "Social Studies" },
{ id: "AGR_G6", name: "Agriculture & Nutrition" },
{ id: "CRE_G6", name: "Creative Arts" },
{ id: "PE_G6", name: "Physical & Health Education" }
]
},

/* =========================
   JUNIOR SECONDARY (7–9)
========================= */

{
id: "G7",
grade: "Grade 7",
level: "Junior Secondary",
pathway: "CBC_CORE",
cycle: "JSS",
subjects: [
{ id: "ENG_G7", name: "English" },
{ id: "KIS_G7", name: "Kiswahili" },
{ id: "MAT_G7", name: "Mathematics" },
{ id: "SCI_G7", name: "Integrated Science" },
{ id: "SOC_G7", name: "Social Studies" },
{ id: "AGR_G7", name: "Agriculture" },
{ id: "BUS_G7", name: "Business Studies" },
{ id: "ICT_G7", name: "Computer Science" },
{ id: "ART_G7", name: "Visual Arts" },
{ id: "PE_G7", name: "Physical Education" }
]
},

{
id: "G8",
grade: "Grade 8",
level: "Junior Secondary",
pathway: "CBC_CORE",
cycle: "JSS",
subjects: [
{ id: "ENG_G8", name: "English" },
{ id: "KIS_G8", name: "Kiswahili" },
{ id: "MAT_G8", name: "Mathematics" },
{ id: "SCI_G8", name: "Integrated Science" },
{ id: "SOC_G8", name: "Social Studies" },
{ id: "AGR_G8", name: "Agriculture" },
{ id: "BUS_G8", name: "Business Studies" },
{ id: "ICT_G8", name: "Computer Science" },
{ id: "ART_G8", name: "Visual Arts" },
{ id: "PE_G8", name: "Physical Education" }
]
},

{
id: "G9",
grade: "Grade 9",
level: "Junior Secondary",
pathway: "CBC_CORE",
cycle: "JSS",
subjects: [
{ id: "ENG_G9", name: "English" },
{ id: "KIS_G9", name: "Kiswahili" },
{ id: "MAT_G9", name: "Mathematics" },
{ id: "SCI_G9", name: "Integrated Science" },
{ id: "SOC_G9", name: "Social Studies" },
{ id: "AGR_G9", name: "Agriculture" },
{ id: "BUS_G9", name: "Business Studies" },
{ id: "ICT_G9", name: "Computer Science" },
{ id: "ART_G9", name: "Visual Arts" },
{ id: "PE_G9", name: "Physical Education" }
]
},

/* =========================
   SENIOR SCHOOL (10–12)
========================= */

{
id: "G10_STEM",
grade: "Grade 10 STEM",
level: "Senior School",
pathway: "STEM",
cycle: "SSS",
subjects: [
{ id: "MAT_S10", name: "Advanced Mathematics" },
{ id: "PHY_S10", name: "Physics" },
{ id: "CHE_S10", name: "Chemistry" },
{ id: "BIO_S10", name: "Biology" },
{ id: "ICT_S10", name: "Computer Science" }
]
},

{
id: "G11_STEM",
grade: "Grade 11 STEM",
level: "Senior School",
pathway: "STEM",
cycle: "SSS",
subjects: [
{ id: "MAT_S11", name: "Advanced Mathematics" },
{ id: "PHY_S11", name: "Physics" },
{ id: "CHE_S11", name: "Chemistry" },
{ id: "BIO_S11", name: "Biology" },
{ id: "ICT_S11", name: "Computer Science" }
]
},

{
id: "G12_STEM",
grade: "Grade 12 STEM",
level: "Senior School",
pathway: "STEM",
cycle: "SSS",
subjects: [
{ id: "MAT_S12", name: "Advanced Mathematics" },
{ id: "PHY_S12", name: "Physics" },
{ id: "CHE_S12", name: "Chemistry" },
{ id: "BIO_S12", name: "Biology" },
{ id: "ICT_S12", name: "Computer Science" }
]
}

];

/* =========================
   PERFORMANCE SCALE
========================= */

export const CBC_PERFORMANCE_SCALE = [
{ code: "EE", label: "Exceeding Expectations", min: 80, max: 100 },
{ code: "ME", label: "Meeting Expectations", min: 60, max: 79 },
{ code: "AE", label: "Approaching Expectations", min: 40, max: 59 },
{ code: "BE", label: "Below Expectations", min: 0, max: 39 }
];

/* =========================
   HELPERS
========================= */

export function getSubjectsByGrade(gradeId) {
const grade = CBC_GRADES.find(g => g.id === gradeId);
return grade ? grade.subjects : [];
}

export function getGradeByLevel(level) {
return CBC_GRADES.filter(g => g.level === level);
}

export function getAllGrades() {
return CBC_GRADES.map(g => ({
id: g.id,
grade: g.grade
}));
}

export function getPerformance(score) {
const found = CBC_PERFORMANCE_SCALE.find(
p => score >= p.min && score <= p.max
);
return found ? found.code : "BE";
}