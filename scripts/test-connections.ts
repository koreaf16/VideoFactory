/**
 * @module 연결 테스트
 * @description ComfyUI, Python FastAPI, Oracle DB 연결 상태를 확인한다.
 *
 * +-----------+     +-----------+     +-----------+
 * | ComfyUI   |     | FastAPI   |     | Oracle    |
 * | :8188     |     | :8000     |     | :1521     |
 * +-----------+     +-----------+     +-----------+
 *       |                 |                 |
 *       +--------+--------+--------+--------+
 *                |                  |
 *          +-----------+     +-----------+
 *          |  Results  | --> |  Summary  |
 *          +-----------+     +-----------+
 *
 * @usage ts-node scripts/test-connections.ts
 * @dependencies oracledb, dotenv
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// --- Config ---
const COMFYUI_HOST = process.env.COMFYUI_HOST ?? "192.168.0.3";
const COMFYUI_PORT = process.env.COMFYUI_PORT ?? "8188";
const PYTHON_API_HOST = process.env.PYTHON_API_HOST ?? "127.0.0.1";
const PYTHON_API_PORT = process.env.PYTHON_API_PORT ?? "8000";
const ORACLE_USER = process.env.ORACLE_USER ?? "video";
const ORACLE_PASSWORD = process.env.ORACLE_PASSWORD ?? "";
const ORACLE_DSN = process.env.ORACLE_DSN ?? "192.168.0.120:1521/AI_DB";

// --- Colors ---
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function testComfyUI(): Promise<TestResult> {
  const url = `http://${COMFYUI_HOST}:${COMFYUI_PORT}/system_stats`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { name: "ComfyUI", passed: false, detail: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { name: "ComfyUI", passed: true, detail: `Connected (${Object.keys(data).length} stats)` };
  } catch (err) {
    return { name: "ComfyUI", passed: false, detail: String(err) };
  }
}

async function testPythonAPI(): Promise<TestResult> {
  const url = `http://${PYTHON_API_HOST}:${PYTHON_API_PORT}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { name: "Python FastAPI", passed: false, detail: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { status: string; version: string };
    return { name: "Python FastAPI", passed: true, detail: `v${data.version} — status: ${data.status}` };
  } catch (err) {
    return { name: "Python FastAPI", passed: false, detail: String(err) };
  }
}

async function testOracle(): Promise<TestResult> {
  try {
    const oracledb = await import("oracledb");
    const conn = await oracledb.default.getConnection({
      user: ORACLE_USER,
      password: ORACLE_PASSWORD,
      connectString: ORACLE_DSN,
    });
    const result = await conn.execute("SELECT 1 FROM DUAL");
    await conn.close();
    const rows = result.rows as number[][] | undefined;
    const value = rows?.[0]?.[0];
    return { name: "Oracle DB", passed: value === 1, detail: `SELECT 1 = ${value}` };
  } catch (err) {
    return { name: "Oracle DB", passed: false, detail: String(err) };
  }
}

function printResult(result: TestResult): void {
  const icon = result.passed ? `${GREEN}✅` : `${RED}❌`;
  const label = result.passed ? "PASS" : "FAIL";
  console.log(`  ${icon} [${label}]${RESET} ${result.name}`);
  console.log(`         ${result.detail}`);
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}=== VideoFactory Connection Test ===${RESET}\n`);

  const results = await Promise.all([testComfyUI(), testPythonAPI(), testOracle()]);

  for (const r of results) {
    printResult(r);
    console.log();
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const color = passed === total ? GREEN : RED;

  console.log(`${BOLD}${color}Summary: ${passed}/${total} passed${RESET}\n`);

  process.exit(passed === total ? 0 : 1);
}

main();
