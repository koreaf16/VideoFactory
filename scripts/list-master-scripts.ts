import oracledb from "oracledb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

async function main() {
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_DSN,
    });

    const result = await conn.execute("SELECT SCRIPT_ID, TITLE, GENRE, STATUS FROM MASTER_SCRIPTS");
    console.log("Master Scripts:");
    console.log(JSON.stringify(result.rows, null, 2));

    const epResult = await conn.execute("SELECT EP_ID, SCRIPT_ID, TITLE FROM EPISODES");
    console.log("Episodes:");
    console.log(JSON.stringify(epResult.rows, null, 2));

    // To delete all:
    await conn.execute("DELETE FROM EPISODES");
    await conn.execute("DELETE FROM MASTER_SCRIPTS");
    await conn.commit();
    console.log("All dummy data deleted.");

  } catch (err) {
    console.error(err);
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

main();
