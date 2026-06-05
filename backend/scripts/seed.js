/**
 * ZETU CBC School ERP — Seed Super Admin
 * Run once: cd backend && node scripts/seed.js
 * Requires DATABASE_URL in .env
 */
require("dotenv").config();
const { Pool } = require("pg");
const bcrypt   = require("bcryptjs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const SUPER_ADMIN = {
  name:     "Chris Developer",
  username: "chrisdeveloper",
  email:    "chrisdeveloper8@gmail.com",
  password: "47ty7890@CHRIS",
  phone:    "0701059192",
};

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding SUPER_ADMIN...\n");

    // Check already exists
    const existing = await client.query(
      "SELECT id, email FROM users WHERE email=$1 OR username=$2 LIMIT 1",
      [SUPER_ADMIN.email, SUPER_ADMIN.username]
    );
    if (existing.rows.length) {
      console.log("✅ SUPER_ADMIN already exists:", existing.rows[0].email);
      return;
    }

    const hash = await bcrypt.hash(SUPER_ADMIN.password, 12);
    const { rows } = await client.query(
      `INSERT INTO users
         (email, username, password_hash, name, phone, role, school_id, is_active)
       VALUES ($1,$2,$3,$4,$5,'SUPER_ADMIN',NULL,TRUE)
       RETURNING id, email, username, name, role`,
      [SUPER_ADMIN.email, SUPER_ADMIN.username, hash, SUPER_ADMIN.name, SUPER_ADMIN.phone]
    );

    const u = rows[0];
    console.log("✅ SUPER_ADMIN seeded successfully!\n");
    console.log("─────────────────────────────────────");
    console.log("  ID:       ", u.id);
    console.log("  Name:     ", u.name);
    console.log("  Email:    ", u.email);
    console.log("  Username: ", u.username);
    console.log("  Password: ", SUPER_ADMIN.password);
    console.log("  Phone:    ", SUPER_ADMIN.phone);
    console.log("─────────────────────────────────────");
    console.log("\n🔐 Login at /login.html");
    console.log("   Leave School Code blank (SUPER_ADMIN)");
    console.log("⚠️  Change password after first login!\n");
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
