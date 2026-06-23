-- ================================================================
-- SENIOR SCHOOL PATHWAYS MIGRATION
-- Adds pathway support for Grade 10-12 (STEM / Social Sciences / Arts & Sports)
-- ================================================================

-- 1. Add pathway column to classes (NULL for PP1-Grade 9, required for Grade 10-12)
ALTER TABLE classes ADD COLUMN IF NOT EXISTS pathway VARCHAR(30);

-- 2. Constrain pathway to known values when set
ALTER TABLE classes DROP CONSTRAINT IF EXISTS chk_classes_pathway;
ALTER TABLE classes ADD CONSTRAINT chk_classes_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- 3. Update uniqueness so two pathways of the same grade/stream/year can coexist
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_school_id_grade_stream_academic_year_key;
ALTER TABLE classes ADD CONSTRAINT classes_school_grade_stream_year_pathway_key
  UNIQUE (school_id, grade, stream, academic_year, pathway);

-- 4. Helpful index for filtering Senior School classes by pathway
CREATE INDEX IF NOT EXISTS idx_classes_pathway ON classes(pathway) WHERE pathway IS NOT NULL;

-- ================================================================
-- LEARNING AREAS: pathway support + Senior Secondary seed data
-- ================================================================

-- 5. Add pathway column to learning_areas.
--    NULL = core subject, applies to all Senior School pathways (and all other stages).
--    Set  = pathway-specific elective, only relevant for Senior Secondary.
ALTER TABLE learning_areas ADD COLUMN IF NOT EXISTS pathway VARCHAR(30);

ALTER TABLE learning_areas DROP CONSTRAINT IF EXISTS chk_learning_areas_pathway;
ALTER TABLE learning_areas ADD CONSTRAINT chk_learning_areas_pathway
  CHECK (pathway IS NULL OR pathway IN ('STEM', 'Social Sciences', 'Arts & Sports'));

-- 6. Seed Senior Secondary learning areas (Grade 10-12), only if not already present.
INSERT INTO learning_areas (code, name, stage, department, is_core, sort_order, kicd_ref, pathway)
SELECT * FROM (VALUES
  -- Core subjects — common to all three pathways
  ('SS-EN',        'English',                          'Senior Secondary', 'Languages',      TRUE,  35, 'KICD/CBC/SS/001', NULL::VARCHAR),
  ('SS-KIS',       'Kiswahili',                         'Senior Secondary', 'Languages',      TRUE,  36, 'KICD/CBC/SS/002', NULL),
  ('SS-CSL',       'Community Service Learning',        'Senior Secondary', 'Social Studies', TRUE,  37, 'KICD/CBC/SS/003', NULL),
  ('SS-PHE',       'Physical Education',               'Senior Secondary', 'Physical Ed',    TRUE,  38, 'KICD/CBC/SS/004', NULL),
  -- STEM pathway electives
  ('SS-STEM-MA',   'Advanced Mathematics',              'Senior Secondary', 'Mathematics',    TRUE,  39, 'KICD/CBC/SS/STEM/001', 'STEM'),
  ('SS-STEM-PHY',  'Physics',                           'Senior Secondary', 'Science',        TRUE,  40, 'KICD/CBC/SS/STEM/002', 'STEM'),
  ('SS-STEM-CHE',  'Chemistry',                         'Senior Secondary', 'Science',        TRUE,  41, 'KICD/CBC/SS/STEM/003', 'STEM'),
  ('SS-STEM-BIO',  'Biology',                           'Senior Secondary', 'Science',        TRUE,  42, 'KICD/CBC/SS/STEM/004', 'STEM'),
  ('SS-STEM-ICT',  'Computer Science',                  'Senior Secondary', 'Technical',      TRUE,  43, 'KICD/CBC/SS/STEM/005', 'STEM'),
  ('SS-STEM-AG',   'Agriculture',                       'Senior Secondary', 'Science',        FALSE, 44, 'KICD/CBC/SS/STEM/006', 'STEM'),
  -- Social Sciences pathway electives
  ('SS-SOC-HIS',   'History & Citizenship',            'Senior Secondary', 'Social Studies', TRUE,  45, 'KICD/CBC/SS/SOC/001',  'Social Sciences'),
  ('SS-SOC-GEO',   'Geography',                         'Senior Secondary', 'Social Studies', TRUE,  46, 'KICD/CBC/SS/SOC/002',  'Social Sciences'),
  ('SS-SOC-CRE',   'Christian Religious Education',     'Senior Secondary', 'Social Studies', FALSE, 47, 'KICD/CBC/SS/SOC/003',  'Social Sciences'),
  ('SS-SOC-BUS',   'Business Studies',                  'Senior Secondary', 'Social Studies', TRUE,  48, 'KICD/CBC/SS/SOC/004',  'Social Sciences'),
  ('SS-SOC-ECO',   'Economics',                         'Senior Secondary', 'Social Studies', TRUE,  49, 'KICD/CBC/SS/SOC/005',  'Social Sciences'),
  ('SS-SOC-LIT',   'Literature',                        'Senior Secondary', 'Languages',      TRUE,  50, 'KICD/CBC/SS/SOC/006',  'Social Sciences'),
  -- Arts & Sports pathway electives
  ('SS-ART-MUS',   'Music & Dance',                     'Senior Secondary', 'Arts',           TRUE,  51, 'KICD/CBC/SS/ART/001',  'Arts & Sports'),
  ('SS-ART-VIS',   'Visual & Applied Arts',             'Senior Secondary', 'Arts',           TRUE,  52, 'KICD/CBC/SS/ART/002',  'Arts & Sports'),
  ('SS-ART-PER',   'Performing Arts',                   'Senior Secondary', 'Arts',           TRUE,  53, 'KICD/CBC/SS/ART/003',  'Arts & Sports'),
  ('SS-ART-SCI',   'Sports Science',                    'Senior Secondary', 'Physical Ed',    TRUE,  54, 'KICD/CBC/SS/ART/004',  'Arts & Sports'),
  ('SS-ART-FAS',   'Fashion & Design',                  'Senior Secondary', 'Arts',           FALSE, 55, 'KICD/CBC/SS/ART/005',  'Arts & Sports'),
  ('SS-ART-FIL',   'Film & Theatre',                    'Senior Secondary', 'Arts',           FALSE, 56, 'KICD/CBC/SS/ART/006',  'Arts & Sports')
) AS v(code, name, stage, department, is_core, sort_order, kicd_ref, pathway)
WHERE NOT EXISTS (SELECT 1 FROM learning_areas la WHERE la.code = v.code);
