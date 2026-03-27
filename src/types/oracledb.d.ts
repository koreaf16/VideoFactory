declare module 'oracledb' {
  interface ConnectionAttributes {
    user?: string;
    password?: string;
    connectString?: string;
  }

  interface PoolAttributes extends ConnectionAttributes {
    poolMin?: number;
    poolMax?: number;
    poolIncrement?: number;
    poolAlias?: string;
  }

  interface ExecuteOptions {
    outFormat?: number;
    autoCommit?: boolean;
    fetchArraySize?: number;
  }

  interface Result<T = Record<string, unknown>> {
    rows?: T[];
    metaData?: Array<{ name: string }>;
    rowsAffected?: number;
    outBinds?: Record<string, unknown>;
  }

  interface Connection {
    execute<T = Record<string, unknown>>(
      sql: string,
      binds?: Record<string, unknown> | unknown[],
      options?: ExecuteOptions,
    ): Promise<Result<T>>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    close(): Promise<void>;
  }

  interface Pool {
    getConnection(): Promise<Connection>;
    close(drainTime?: number): Promise<void>;
    poolAlias?: string;
  }

  function initOracleClient(options?: { libDir?: string }): void;
  function createPool(attrs: PoolAttributes): Promise<Pool>;
  function getPool(alias?: string): Pool;
  function getConnection(attrs?: ConnectionAttributes): Promise<Connection>;

  const OUT_FORMAT_OBJECT: number;
  const BIND_OUT: number;
  const NUMBER: number;
  const STRING: number;
  const DB_TYPE_NUMBER: number;
}
