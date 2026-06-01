const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const runSchema = async () => {
    // Corrected pooler URL and URL-encoded password
    const connectionString = "postgresql://postgres.dbjpzxwxcyscnaytqnfi:47ty7890%40CHRIS@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";
    
    const client = new Client({
        connectionString,
    });

    try {
        console.log("Connecting to the database...");
        await client.connect();
        console.log("Connected successfully.");

        const schemaPath = path.join(__dirname, "cbc_schema.sql");
        const schemaSql = fs.readFileSync(schemaPath, "utf-8");

        console.log("Executing schema SQL...");
        await client.query(schemaSql);
        
        console.log("Schema executed successfully! Database setup is complete.");
    } catch (err) {
        console.error("Error executing schema:", err);
    } finally {
        await client.end();
    }
};

runSchema();
