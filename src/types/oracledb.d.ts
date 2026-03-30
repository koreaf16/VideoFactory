declare module 'oracledb' {
  namespace oracledb {
    /**
     * Oracle 26ai DBType object used in version 6
     */
    interface DBType {
      toString(): string;
    }

    interface Metadata {
      name: string;
      dbType: DBType;
      dbTypeName: string;
      fetchType?: DBType;
      precision?: number;
      scale?: number;
      byteSize?: number;
      nullable?: boolean;
      dbColumnName?: string;
    }

    interface FetchTypeResponse {
      type?: DBType;
      converter?: (value: any) => any;
    }

    interface ConnectionAttributes {
      user?: string;
      password?: string;
      connectString?: string;
      connectionString?: string;
      externalAuth?: boolean;
      privilege?: number;
    }

    interface PoolAttributes extends ConnectionAttributes {
      poolMin?: number;
      poolMax?: number;
      poolIncrement?: number;
      poolAlias?: string;
      poolTimeout?: number;
      poolPingInterval?: number;
      stmtCacheSize?: number;
    }

    interface ExecuteOptions {
      outFormat?: number;
      autoCommit?: boolean;
      fetchArraySize?: number;
      fetchTypeHandler?: (metadata: Metadata, allMetadata?: Metadata[]) => FetchTypeResponse | undefined;
    }

    interface Result<T = any> {
      rows?: T[];
      metaData?: Metadata[];
      rowsAffected?: number;
      outBinds?: any;
      lastRowid?: string;
    }

    interface Connection {
      execute<T = any>(
        sql: string,
        binds?: any[] | Record<string, any>,
        options?: ExecuteOptions,
      ): Promise<Result<T>>;
      executeMany(
        sql: string,
        binds: any[],
        options?: { autoCommit?: boolean; batchErrors?: boolean },
      ): Promise<{ rowsAffected?: number }>;
      commit(): Promise<void>;
      rollback(): Promise<void>;
      close(): Promise<void>;
    }

    interface Pool {
      getConnection(): Promise<Connection>;
      close(drainTime?: number): Promise<void>;
      poolAlias?: string;
      status: number;
      connectionsInUse: number;
      connectionsOpen: number;
    }

    // Global settings and constants
    var fetchTypeHandler: (metadata: Metadata, allMetadata?: Metadata[]) => FetchTypeResponse | undefined;
    var outFormat: number;
    var autoCommit: boolean;

    function initOracleClient(options?: { libDir?: string; configDir?: string; errorUrl?: string; driverName?: string; binaryDir?: string }): void;
    function createPool(attrs: PoolAttributes): Promise<Pool>;
    function getPool(alias?: string): Pool;
    function getConnection(attrs?: ConnectionAttributes | string): Promise<Connection>;

    const OUT_FORMAT_ARRAY: number;
    const OUT_FORMAT_OBJECT: number;
    const BIND_IN: number;
    const BIND_INOUT: number;
    const BIND_OUT: number;
    
    const DB_TYPE_NUMBER: DBType;
    const DB_TYPE_VARCHAR: DBType;
    const DB_TYPE_CHAR: DBType;
    const DB_TYPE_DATE: DBType;
    const DB_TYPE_CLOB: DBType;
    const DB_TYPE_BLOB: DBType;
    const DB_TYPE_RAW: DBType;
    const DB_TYPE_TIMESTAMP: DBType;
    const DB_TYPE_TIMESTAMP_TZ: DBType;
    const DB_TYPE_TIMESTAMP_LTZ: DBType;
    const DB_TYPE_JSON: DBType;

    const STRING: DBType;
    const NUMBER: DBType;
    const DATE: DBType;
    const CURSOR: DBType;
    const BUFFER: DBType;
    const CLOB: DBType;
    const BLOB: DBType;
  }

  export = oracledb;
}
