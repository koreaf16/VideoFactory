import { initPool, getConnection, closePool } from '../src/db/connection';

async function main() {
  await initPool();
  const conn = await getConnection();
  const result = await conn.execute('SELECT char_id, name FROM characters');
  console.log(result.rows);
  await conn.close();
  await closePool();
}

main();
