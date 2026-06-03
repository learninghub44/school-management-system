const express=require("express"),{body,validationResult}=require("express-validator"),db=require("../config/db"),auth=require("../middleware/authMiddleware"),role=require("../middleware/roleMiddleware"),{audit}=require("../middleware/auditLog"),router=express.Router();
const READ=["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER"];

router.get("/cards",auth,role(READ),async(req,res)=>{
  try{const sid=req.user.role==="SUPER_ADMIN"?(req.query.school_id||null):req.user.school_id;
  const p=[];let w="WHERE 1=1";
  if(sid){p.push(sid);w+=` AND rc.school_id=$${p.length}`;}
  if(req.query.student_id){p.push(req.query.student_id);w+=` AND rc.student_id=$${p.length}`;}
  if(req.query.term){p.push(req.query.term);w+=` AND rc.term=$${p.length}`;}
  if(req.query.academic_year){p.push(req.query.academic_year);w+=` AND rc.academic_year=$${p.length}`;}
  if(req.query.class_id){p.push(req.query.class_id);w+=` AND rc.class_id=$${p.length}`;}
  const{rows}=await db.query(`SELECT rc.*,CONCAT(s.first_name,' ',s.last_name) AS student_name,s.admission_number,s.gender,CONCAT(c.grade,COALESCE(' '||c.stream,'')) AS class_label,u.name AS generated_by_name FROM report_cards rc JOIN students s ON s.id=rc.student_id JOIN classes c ON c.id=rc.class_id LEFT JOIN users u ON u.id=rc.generated_by ${w} ORDER BY rc.academic_year DESC,rc.term DESC`,p);
  return res.json({success:true,data:rows});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/cards",auth,role(READ),[body("student_id").notEmpty(),body("class_id").notEmpty().isInt(),body("term").isInt({min:1,max:3}),body("academic_year").matches(/^\d{4}$/)],async(req,res)=>{
  const errs=validationResult(req);if(!errs.isEmpty())return res.status(400).json({success:false,errors:errs.array()});
  try{const sid=req.user.role==="SUPER_ADMIN"?req.body.school_id:req.user.school_id;
  const{rows:st}=await db.query("SELECT school_id FROM students WHERE id=$1",[req.body.student_id]);
  if(!st.length||(req.user.role!=="SUPER_ADMIN"&&st[0].school_id!==sid))return res.status(403).json({success:false,message:"Access denied."});
  const{student_id,class_id,term,academic_year,class_teacher_remark,principal_remark}=req.body;
  const{rows}=await db.query(`INSERT INTO report_cards(school_id,student_id,class_id,term,academic_year,class_teacher_remark,principal_remark,generated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,student_id,term,academic_year) DO UPDATE SET class_teacher_remark=EXCLUDED.class_teacher_remark,principal_remark=EXCLUDED.principal_remark,generated_by=EXCLUDED.generated_by,generated_date=NOW() RETURNING *`,
    [sid,student_id,class_id,term,academic_year,class_teacher_remark||null,principal_remark||null,req.user.id]);
  await audit(req,"GENERATE_REPORT_CARD","report_cards",rows[0].id,null,{student_id,term,academic_year});
  return res.status(201).json({success:true,data:rows[0]});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/cards/:id/publish",auth,role(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"]),async(req,res)=>{
  try{const{rows:ex}=await db.query("SELECT * FROM report_cards WHERE id=$1",[req.params.id]);
  if(!ex.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&ex[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  await db.query("UPDATE report_cards SET is_published=TRUE WHERE id=$1",[req.params.id]);
  await audit(req,"PUBLISH_REPORT_CARD","report_cards",req.params.id);
  return res.json({success:true,message:"Published."});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.get("/dashboard",auth,role(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL","BURSAR","HOD"]),async(req,res)=>{
  try{const sid=req.user.role==="SUPER_ADMIN"?(req.query.school_id||null):req.user.school_id;
  if(!sid)return res.status(400).json({success:false,message:"school_id required."});
  const year=req.query.academic_year||new Date().getFullYear().toString();
  const[s,t,c,a,as,f]=await Promise.all([
    db.query("SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE gender='Male') AS male,COUNT(*) FILTER(WHERE gender='Female') AS female FROM students WHERE school_id=$1 AND is_active=TRUE",[sid]),
    db.query("SELECT COUNT(*) AS total FROM teachers WHERE school_id=$1 AND is_active=TRUE",[sid]),
    db.query("SELECT COUNT(*) AS total FROM classes WHERE school_id=$1 AND academic_year=$2",[sid,year]),
    db.query("SELECT COUNT(*) FILTER(WHERE status='Present') AS present,COUNT(*) FILTER(WHERE status='Absent') AS absent,COUNT(*) AS total FROM attendance WHERE school_id=$1 AND date>=CURRENT_DATE-7",[sid]),
    db.query("SELECT achievement_level,COUNT(*) AS count FROM assessments WHERE school_id=$1 AND academic_year=$2 GROUP BY achievement_level",[sid,year]),
    db.query("SELECT COALESCE(SUM(amount_paid),0) AS collected,COALESCE(SUM(balance),0) AS balance FROM payments WHERE school_id=$1 AND academic_year=$2",[sid,year]),
  ]);
  return res.json({success:true,data:{students:s.rows[0],teachers:t.rows[0],classes:c.rows[0],attendance_week:a.rows[0],assessments_by_level:as.rows,finance:f.rows[0]}});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.get("/timetable",auth,async(req,res)=>{
  try{const sid=req.user.role==="SUPER_ADMIN"?(req.query.school_id||null):req.user.school_id;
  const p=[];let w="WHERE 1=1";
  if(sid){p.push(sid);w+=` AND tt.school_id=$${p.length}`;}
  if(req.query.class_id){p.push(req.query.class_id);w+=` AND tt.class_id=$${p.length}`;}
  if(req.query.teacher_id){p.push(req.query.teacher_id);w+=` AND tt.teacher_id=$${p.length}`;}
  const{rows}=await db.query(`SELECT tt.*,la.name AS subject_name,CONCAT(t.first_name,' ',t.last_name) AS teacher_name,CONCAT(c.grade,COALESCE(' '||c.stream,'')) AS class_label FROM timetable tt JOIN learning_areas la ON la.id=tt.learning_area_id LEFT JOIN teachers t ON t.id=tt.teacher_id JOIN classes c ON c.id=tt.class_id ${w} ORDER BY CASE day WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 END,tt.start_time`,p);
  return res.json({success:true,data:rows});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/timetable",auth,role(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"]),[body("class_id").notEmpty().isInt(),body("learning_area_id").notEmpty().isInt(),body("day").isIn(["Monday","Tuesday","Wednesday","Thursday","Friday"]),body("start_time").matches(/^\d{2}:\d{2}$/),body("end_time").matches(/^\d{2}:\d{2}$/),body("academic_year").matches(/^\d{4}$/)],async(req,res)=>{
  const errs=validationResult(req);if(!errs.isEmpty())return res.status(400).json({success:false,errors:errs.array()});
  try{const sid=req.user.role==="SUPER_ADMIN"?req.body.school_id:req.user.school_id;
  const{class_id,learning_area_id,teacher_id,day,start_time,end_time,academic_year}=req.body;
  const{rows}=await db.query("INSERT INTO timetable(school_id,class_id,learning_area_id,teacher_id,day,start_time,end_time,academic_year) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[sid,class_id,learning_area_id,teacher_id||null,day,start_time,end_time,academic_year]);
  return res.status(201).json({success:true,data:rows[0]});}catch(e){if(e.code==="23505")return res.status(409).json({success:false,message:"Slot already exists."});return res.status(500).json({success:false,message:"Server error."});}
});
router.delete("/timetable/:id",auth,role(["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"]),async(req,res)=>{
  try{const{rows}=await db.query("SELECT school_id FROM timetable WHERE id=$1",[req.params.id]);
  if(!rows.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&rows[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  await db.query("DELETE FROM timetable WHERE id=$1",[req.params.id]);
  return res.json({success:true,message:"Slot deleted."});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
module.exports=router;
