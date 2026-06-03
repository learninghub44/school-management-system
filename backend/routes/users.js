const express=require("express"),bcrypt=require("bcryptjs"),{body,validationResult}=require("express-validator"),db=require("../config/db"),auth=require("../middleware/authMiddleware"),role=require("../middleware/roleMiddleware"),{audit}=require("../middleware/auditLog"),router=express.Router();
const MANAGE=["SUPER_ADMIN","PRINCIPAL","DEPUTY_PRINCIPAL"];
router.get("/",auth,role([...MANAGE,"HOD"]),async(req,res)=>{
  try{const sid=req.user.role==="SUPER_ADMIN"?(req.query.school_id||null):req.user.school_id;
  if(!sid&&req.user.role!=="SUPER_ADMIN")return res.status(403).json({success:false,message:"School isolation error."});
  let q=`SELECT u.id,u.username,u.email,u.name,u.phone,u.role,u.is_active,u.must_change_password,u.last_login,u.created_at,s.name AS school_name FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.role!='SUPER_ADMIN'`;
  const p=[];
  if(sid){p.push(sid);q+=` AND u.school_id=$${p.length}`;}
  if(req.query.role){p.push(req.query.role);q+=` AND u.role=$${p.length}`;}
  q+=" ORDER BY u.name";
  const{rows}=await db.query(q,p);return res.json({success:true,data:rows,count:rows.length});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.get("/:id",auth,role([...MANAGE,"HOD"]),async(req,res)=>{
  try{const{rows}=await db.query("SELECT id,username,email,name,phone,role,is_active,last_login,created_at,school_id FROM users WHERE id=$1",[req.params.id]);
  if(!rows.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&rows[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  return res.json({success:true,data:rows[0]});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/",auth,role(MANAGE),[body("username").trim().notEmpty().matches(/^[a-zA-Z0-9._-]+$/),body("email").isEmail().normalizeEmail(),body("name").trim().notEmpty(),body("password").isLength({min:8}).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),body("role").isIn(["PRINCIPAL","DEPUTY_PRINCIPAL","HOD","TEACHER","BURSAR"])],async(req,res)=>{
  const errs=validationResult(req);if(!errs.isEmpty())return res.status(400).json({success:false,errors:errs.array()});
  try{const sid=req.user.role==="SUPER_ADMIN"?req.body.school_id:req.user.school_id;
  if(!sid)return res.status(400).json({success:false,message:"school_id required."});
  const{username,email,name,password,role:userRole,phone}=req.body;
  const dup=await db.query("SELECT id FROM users WHERE username=$1 OR email=$2",[username,email]);
  if(dup.rows.length)return res.status(409).json({success:false,message:"Username or email already taken."});
  const hash=await bcrypt.hash(password,12);
  const{rows}=await db.query(`INSERT INTO users(school_id,username,email,password_hash,name,phone,role) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,email,name,phone,role,is_active,created_at`,[sid,username,email,hash,name,phone||null,userRole]);
  await audit(req,"CREATE_USER","users",rows[0].id,null,{username,email,role:userRole});
  return res.status(201).json({success:true,message:"Staff account created.",data:rows[0]});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.put("/:id",auth,role(MANAGE),async(req,res)=>{
  try{const{rows:ex}=await db.query("SELECT * FROM users WHERE id=$1",[req.params.id]);
  if(!ex.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&ex[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  const{name,phone,role:newRole,is_active}=req.body;
  const{rows}=await db.query("UPDATE users SET name=COALESCE($1,name),phone=COALESCE($2,phone),role=COALESCE($3,role),is_active=COALESCE($4,is_active),updated_at=NOW() WHERE id=$5 RETURNING id,username,email,name,phone,role,is_active",[name||null,phone||null,newRole||null,is_active??null,req.params.id]);
  await audit(req,"UPDATE_USER","users",req.params.id,ex[0],rows[0]);
  return res.json({success:true,data:rows[0]});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.post("/:id/reset-password",auth,role(MANAGE),[body("new_password").isLength({min:8}).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)],async(req,res)=>{
  const errs=validationResult(req);if(!errs.isEmpty())return res.status(400).json({success:false,errors:errs.array()});
  try{const{rows}=await db.query("SELECT school_id FROM users WHERE id=$1",[req.params.id]);
  if(!rows.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&rows[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  const hash=await bcrypt.hash(req.body.new_password,12);
  await db.query("UPDATE users SET password_hash=$1,must_change_password=TRUE,failed_login_attempts=0,locked_until=NULL WHERE id=$2",[hash,req.params.id]);
  await audit(req,"RESET_PASSWORD","users",req.params.id);
  return res.json({success:true,message:"Password reset. User must change on next login."});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
router.delete("/:id",auth,role(MANAGE),async(req,res)=>{
  try{if(req.params.id===req.user.id)return res.status(400).json({success:false,message:"Cannot deactivate your own account."});
  const{rows}=await db.query("SELECT school_id FROM users WHERE id=$1",[req.params.id]);
  if(!rows.length)return res.status(404).json({success:false,message:"Not found."});
  if(req.user.role!=="SUPER_ADMIN"&&rows[0].school_id!==req.user.school_id)return res.status(403).json({success:false,message:"Access denied."});
  await db.query("UPDATE users SET is_active=FALSE,updated_at=NOW() WHERE id=$1",[req.params.id]);
  await audit(req,"DEACTIVATE_USER","users",req.params.id);
  return res.json({success:true,message:"User deactivated."});}catch(e){return res.status(500).json({success:false,message:"Server error."});}
});
module.exports=router;
