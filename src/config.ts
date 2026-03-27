/**
 * @module 환경 설정 로더
 * @description .env 파일에서 환경 변수를 로드하고 타입 안전한 config 객체를 제공한다.
 *
 * ┌──────────┐     ┌──────────┐     ┌──────────┐
 * │  .env    │ ──→ │  dotenv  │ ──→ │  config  │
 * │  파일    │     │  parse   │     │  객체    │
 * └──────────┘     └──────────┘     └──────────┘
 *
 * @dependencies dotenv
 * @author AI Video Factory
 */

import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`필수 환경 변수 ${key}가 설정되지 않았습니다.`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function numEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  return raw ? parseInt(raw, 10) : defaultValue;
}

export const config = {
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',

  server: {
    port: numEnv('PORT', 2020),
  },

  comfyui: {
    host: optionalEnv('COMFYUI_HOST', '192.168.0.3'),
    port: numEnv('COMFYUI_PORT', 8188),
    get wsUrl(): string {
      return `ws://${config.comfyui.host}:${config.comfyui.port}/ws`;
    },
    get httpUrl(): string {
      return `http://${config.comfyui.host}:${config.comfyui.port}`;
    },
  },

  pythonApi: {
    host: optionalEnv('PYTHON_API_HOST', '127.0.0.1'),
    port: numEnv('PYTHON_API_PORT', 8000),
    get baseUrl(): string {
      return `http://${config.pythonApi.host}:${config.pythonApi.port}`;
    },
  },

  oracle: {
    user: requireEnv('ORACLE_USER', 'video'),
    password: requireEnv('ORACLE_PASSWORD'),
    dsn: requireEnv('ORACLE_DSN', '192.168.0.120:1521/AI_DB'),
    instantClientPath: optionalEnv('ORACLE_INSTANT_CLIENT_PATH', 'C:\\instantclient_23_0'),
    poolMin: numEnv('ORACLE_POOL_MIN', 2),
    poolMax: numEnv('ORACLE_POOL_MAX', 10),
  },

  redis: {
    host: optionalEnv('REDIS_HOST', '127.0.0.1'),
    port: numEnv('REDIS_PORT', 6379),
  },

  log: {
    level: optionalEnv('LOG_LEVEL', 'debug'),
  },
} as const;
