const express=require("express"),{body,validationResult}=require("express-validator"),db=require("../config/db"),auth=require("../middleware/authMiddleware"),role=require("../middleware/roleMiddleware"),{audit}=require("../middleware/auditLog"),router=express.Router();
const MANAGE=["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"],READ=[...MANAGE,"HOD","TEACHER","BURSAR"];
router.get("/",auth,role(READ),async(req,res)=>{
  try{const sid=req.user.role==="SUPER_ADMIN"?(req.query.school_id||null):req.user.school_id;
  if(!sid&&req.user.role!=="SUPER_ADMIN")return res.status(403).json({success:false,message:"School isolation error."});
  let q=`SELECT s.*,CONCAT(c.grade,COALESCE(' '||c.stream,'')) AS class_label,c.grade,c.stream,c.stage FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE 1=1`;
  const p=[];
  if(sid){p.push(sid);q+=` AND s.school_id=$${p.length}`;}
  if(req.query.class_id){p.push(req.query.class_id);q+=` AND s.class_id=$${p.length}`;}
  if(req.query.is_active!==undefined){p.push(req.query.is_active==="true");q+=` AND s.is_active=$${p.length}`;}
  if(req.query.search){p.push(`%${req.query.search}%`);q+=` AND (s.first_name ILIKE $${p.length} OR s.last_name ILIKE $${p.length} OR s.admission_number ILIKE $${p.length})`;}
  q+=" ORDER BY s.last_name,s.first_name LIMIT 500";
  const{rows}=await db.query(q,p);return res.json({success:true,data:rows,count:rows.length});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.get("/:id",auth,role(READ),async(req,res)=>{
  try{const{rows}=await db.query(`SELECT s.*,CONCAT(c.grade,COALESCE(' '||c.stream,'')) AS class_label,c.stage FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]);
  if(!rows.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&rows[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  return res.json({success:true,data:rows[0]});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/",auth,role(MANAGE),[body("first_name").trim().notEmpty(),body("last_name").trim().notEmpty(),body("admission_number").trim().notEmpty(),body("gender").isIn(["Male","Female"]),body("class_id").notEmpty().isInt()],async(req,res)=>{
  const errs=validationResult(req);if(!errs.isEmpty())return res.status(400).json({success:false,errors:errs.array()});
  try{const sid=req.user.role==="SUPER_ADMIN"?req.body.school_id:req.user.school_id;
  const{rows:cls}=await db.query("SELECT school_id FROM classes WHERE id=$1",[req.body.class_id]);
  if(!cls.length||(req.user.role!=="SUPER_ADMIN"&&cls[0].school_id!==sid))return res.status(400).json({success:false,message:"Invalid class."});
  const{first_name,middle_name,last_name,admission_number,upi_number,gender,date_of_birth,class_id,admission_date,parent_name,parent_phone,address}=req.body;
  const{rows}=await db.query(`INSERT INTO students(school_id,first_name,middle_name,last_name,admission_number,upi_number,gender,date_of_birth,class_id,admission_date,parent_name,parent_phone,address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [sid,first_name,middle_name||null,last_name,admission_number,upi_number||null,gender,date_of_birth||null,class_id,admission_date||null,parent_name||null,parent_phone||null,address||null]);
  await audit(req,"CREATE_STUDENT","students",rows[0].id,null,{first_name,last_name,admission_number});
  return res.status(201).json({success:true,data:rows[0]});}catch(e){if(e.code==="23505")return res.status(409).json({success:false,message:"Admission number already exists."});return res.status(500).json({success:false,message:"Server error."});}
});
router.put("/:id",auth,role(MANAGE),async(req,res)=>{
  try{const{rows:ex}=await db.query("SELECT * FROM students WHERE id=$1",[req.params.id]);
  if(!ex.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&ex[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  const{first_name,middle_name,last_name,gender,date_of_birth,class_id,parent_name,parent_phone,address,upi_number,is_active}=req.body;
  const{rows}=await db.query(`UPDATE students SET first_name=COALESCE($1,first_name),middle_name=COALESCE($2,middle_name),last_name=COALESCE($3,last_name),gender=COALESCE($4,gender),date_of_birth=COALESCE($5,date_of_birth),class_id=COALESCE($6,class_id),parent_name=COALESCE($7,parent_name),parent_phone=COALESCE($8,parent_phone),address=COALESCE($9,address),upi_number=COALESCE($10,upi_number),is_active=COALESCE($11,is_active),updated_at=NOW() WHERE id=$12 RETURNING *`,
    [first_name||null,middle_name||null,last_name||null,gender||null,date_of_birth||null,class_id||null,parent_name||null,parent_phone||null,address||null,upi_number||null,is_active??null,req.params.id]);
  await audit(req,"UPDATE_STUDENT","students",req.params.id,ex[0],rows[0]);
  return res.json({success:true,data:rows[0]});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/promote",auth,role(MANAGE),async(req,res)=>{
  try{const{student_ids,new_class_id}=req.body;
  if(!Array.isArray(student_ids)||!new_class_id)return res.status(400).json({success:false,message:"student_ids and new_class_id required."});
  const{rows:cls}=await db.query("SELECT school_id FROM classes WHERE id=$1",[new_class_id]);
  if(!cls.length||(req.user.role!=="SUPER_ADMIN"&&cls[0].school_id!==req.user.school_id))return res.status(400).json({success:false,message:"Invalid class."});
  await db.query("UPDATE students SET class_id=$1,updated_at=NOW() WHERE id=ANY($2) AND school_id=$3",[new_class_id,student_ids,req.user.school_id]);
  await audit(req,"PROMOTE_STUDENTS","students",null,null,{count:student_ids.length,new_class_id});
  return res.json({success:true,message:`${student_ids.length} student(s) promoted.`});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
module.exports=router;
