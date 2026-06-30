const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const runSchema = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL environment variable is not set.");
        process.exit(1);
    }

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
