import { initPool, getConnection } from '../src/db/connection';
import oracledb from 'oracledb';

async function describeTable(tableName: string) {
  // pool must be initialized first
  await initPool();
  const conn = await getConnection();
  try {
    // In Oracle, use USER_TAB_COLUMNS
    const query = `
      SELECT column_name, data_type, data_length, nullable
        FROM user_tab_columns
       WHERE table_name = :tableName
       ORDER BY column_id
    `;
    const cols = await conn.execute(query, { tableName: tableName.toUpperCase() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`\n=== Table: ${tableName} ===`);
    console.table(cols.rows);
  } finally {
    await conn.close();
  }
}

async function main() {
  const tables = process.argv.slice(2);
  if (tables.length === 0) {
    await describeTable('characters');
    await describeTable('char_candidates');
    await describeTable('char_ref_images');
  } else {
    for (const table of tables) {
      await describeTable(table);
    }
  }
}

main().catch(console.error);
