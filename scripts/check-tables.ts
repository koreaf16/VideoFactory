import * as dotenv from "dotenv";
import * as path from "path";
import oracledb from "oracledb";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const ORACLE_USER = process.env.ORACLE_USER ?? "video";
const ORACLE_PASSWORD = process.env.ORACLE_PASSWORD ?? "";
const ORACLE_DSN = process.env.ORACLE_DSN ?? "192.168.0.120:1521/AI_DB";

async function checkTables() {
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: ORACLE_USER,
      password: ORACLE_PASSWORD,
      connectString: ORACLE_DSN,
    });

    console.log("Connected to:", ORACLE_DSN);
    const result = await conn.execute(
      "SELECT table_name FROM user_tables ORDER BY table_name"
    );
    console.log("Tables found:");
    (result.rows as any[]).forEach(row => console.log(` - ${row[0]}`));

  } catch (err) {
    console.error("Failed to check tables:", err);
  } finally {
    if (conn) await conn.close();
  }
}

checkTables();
