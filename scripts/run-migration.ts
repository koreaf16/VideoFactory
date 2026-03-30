/**
 * @module 데이터베이스 마이그레이션 실행기
 * @description src/db/migrations 폴더의 SQL 파일을 실행한다.
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import oracledb from "oracledb";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const ORACLE_USER = process.env.ORACLE_USER ?? "video";
const ORACLE_PASSWORD = process.env.ORACLE_PASSWORD ?? "";
const ORACLE_DSN = process.env.ORACLE_DSN ?? "192.168.0.120:1521/AI_DB";

async function runMigration(filePath: string) {
  let sql = fs.readFileSync(filePath, "utf8");
  
  // Remove single line comments
  sql = sql.replace(/--.*$/gm, "");
  // Remove multi-line comments
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, "");

  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let conn;
  try {
    conn = await oracledb.getConnection({
      user: ORACLE_USER,
      password: ORACLE_PASSWORD,
      connectString: ORACLE_DSN,
    });

    console.log(`Executing migration: ${path.basename(filePath)}`);

    for (const statement of statements) {
      try {
        console.log(`Running: ${statement.substring(0, 50)}...`);
        await conn.execute(statement);
      } catch (err: any) {
        if (err.errorNum === 955) {
          console.warn(`  [SKIP] Table already exists`);
        } else {
          console.error(`  [ERROR] ${err.message}`);
          throw err;
        }
      }
    }

    await conn.commit();
    console.log("Migration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

const migrationFile = path.resolve(__dirname, "..", "src", "db", "migrations", "20260330_lora_tables.sql");
runMigration(migrationFile);
