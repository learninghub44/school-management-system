// CBC structure for frontend (sample, expand as needed)
export const CBC_STRUCTURE = {
  grades: [
    {
      grade_level: "Grade 1",
      subjects: [
        {
          subject_name: "English",
          category: "core",
          strands: [
            {
              strand_name: "Language Activities",
              sub_strands: [
                { sub_strand: "Listening & Speaking", competency_area: "Communication" },
                { sub_strand: "Reading", competency_area: "Literacy" }
              ]
            }
          ],
          assessment_types: ["formative", "summative"]
        },
        {
          subject_name: "Mathematics",
          category: "core",
          strands: [
            {
              strand_name: "Numbers",
              sub_strands: [
                { sub_strand: "Whole Numbers", competency_area: "Numeracy" }
              ]
            }
          ],
          assessment_types: ["formative", "summative"]
        }
      ]
    },
    {
      grade_level: "Grade 4",
      subjects: [
        {
          subject_name: "Mathematics",
          category: "core",
          strands: [
            {
              strand_name: "Numbers",
              sub_strands: [
                { sub_strand: "Whole Numbers", competency_area: "Numeracy" }
              ]
            }
          ],
          assessment_types: ["formative", "summative"]
        },
        {
          subject_name: "English",
          category: "core",
          strands: [
            {
              strand_name: "Language Skills",
              sub_strands: [
                { sub_strand: "Reading", competency_area: "Literacy" }
              ]
            }
          ],
          assessment_types: ["formative", "summative", "project-based"]
        }
      ]
    }
  ],
  cbc_grades: ["EE", "ME", "AE", "BE"],
  assessment_types: ["formative", "summative", "project-based"]
};
