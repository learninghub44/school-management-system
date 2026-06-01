const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
    console.error("PostgreSQL pool error:", err.message);
});

// Test connection on startup
pool.query("SELECT NOW()").then(() => {
    console.log("✅ PostgreSQL connected");
}).catch(err => {
    console.error("❌ PostgreSQL connection failed:", err.message);
    process.exit(1);
});

/**
 * Run a callback function with RLS context set for the current user.
 * Grabs a dedicated client from the pool, sets app.user_id / app.user_role
 * / app.school_id as transaction-scoped GUC variables, runs your callback,
 * then commits and releases — all on the same connection so RLS sees the context.
 *
 * Usage:
 *   const rows = await withRLSContext(req.user, async (client) => {
 *     const { rows } = await client.query("SELECT * FROM students");
 *     return rows;
 *   });
 */
async function withRLSContext(user, callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Set session context — true = transaction-scoped (safe with pooler)
        await client.query(
            `SELECT
                set_config('app.user_id',   $1, true),
                set_config('app.user_role', $2, true),
                set_config('app.school_id', $3, true)`,
            [
                user.id,
                user.role,
                user.school_id || "",
            ]
        );

        // Run the caller's queries on the same client
        const result = await callback(client);

        await client.query("COMMIT");
        return result;

    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

module.exports = pool;
module.exports.withRLSContext = withRLSContext;
