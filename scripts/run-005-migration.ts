import oracledb from 'oracledb';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const instantClientPath = process.env.ORACLE_INSTANT_CLIENT_PATH || 'C:\\instantclient_23_0';
try {
  oracledb.initOracleClient({ libDir: instantClientPath });
} catch {
  // already initialized
}

async function run() {
  const user = process.env.ORACLE_USER || 'video';
  const password = process.env.ORACLE_PASSWORD || '';
  const dsn = process.env.ORACLE_DSN || '192.168.0.120:1521/AI_DB';

  console.log(`Connecting to ${user}@${dsn}...`);
  const conn = await oracledb.getConnection({ user, password, connectString: dsn });
  console.log('Connected.');

  let sql = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'db', 'migrations', '005_master_scripts.sql'),
    'utf8',
  );
  sql = sql.replace(/--.*$/gm, '');
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');

  const stmts = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of stmts) {
    try {
      console.log(`Running: ${stmt.substring(0, 60)}...`);
      await conn.execute(stmt);
      console.log('  OK');
    } catch (err: unknown) {
      const oraErr = err as { errorNum?: number; message: string };
      if (oraErr.errorNum === 955 || oraErr.errorNum === 1430) {
        console.log('  [SKIP] Already exists');
      } else {
        console.error(`  [ERROR] ${oraErr.message}`);
      }
    }
  }

  await conn.commit();
  await conn.close();
  console.log('Migration complete.');
}

run().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
