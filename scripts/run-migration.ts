import { initPool, getConnection, closePool } from '../src/db/connection';

void (async (): Promise<void> => {
  await initPool();
  const conn = await getConnection();
  process.stdout.write('Connected OK\n');

  const stmts = [
    `CREATE TABLE production_runs (
      run_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      script_id       NUMBER REFERENCES master_scripts(script_id),
      protagonist_id  VARCHAR2(50) REFERENCES characters(char_id),
      current_stage   VARCHAR2(32) NOT NULL
                      CHECK (current_stage IN (
                        'protagonist_pending','protagonist_visual','script_pending',
                        'episode_generating','assets_creating','snapshots_generating',
                        'completed','failed','paused'
                      )),
      current_ep_num  NUMBER DEFAULT 0,
      config_json     CLOB,
      error_message   VARCHAR2(4000),
      auto_advance    NUMBER(1) DEFAULT 0,
      created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
    )`,
    `CREATE TABLE pipeline_steps (
      step_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      run_id        NUMBER REFERENCES production_runs(run_id),
      ep_id         NUMBER,
      step_type     VARCHAR2(64) NOT NULL,
      step_status   VARCHAR2(32) DEFAULT 'pending'
                    CHECK (step_status IN ('pending','running','completed','failed','skipped')),
      input_json    CLOB,
      output_json   CLOB,
      error_message VARCHAR2(4000),
      started_at    TIMESTAMP,
      completed_at  TIMESTAMP,
      created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
    )`,
    'CREATE INDEX idx_pipeline_steps_run ON pipeline_steps(run_id)',
    'CREATE INDEX idx_pipeline_steps_ep  ON pipeline_steps(ep_id)',
    'ALTER TABLE characters ADD (is_protagonist NUMBER(1) DEFAULT 0, recurring NUMBER(1) DEFAULT 1)',
    'ALTER TABLE locations ADD (recurring NUMBER(1) DEFAULT 1)',
  ];

  for (const sql of stmts) {
    try {
      await conn.execute(sql);
      process.stdout.write(`OK: ${sql.substring(0, 70).replace(/\n/g, ' ')}\n`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      process.stdout.write(`ERR: ${msg}\n`);
    }
  }
  await conn.execute('COMMIT');
  await conn.close();
  await closePool();
  process.stdout.write('Migration complete\n');
  process.exit(0);
})();
