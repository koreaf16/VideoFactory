/**
 * @module 구조화된 로거
 * @description console.log 대신 사용하는 구조화된 로깅 모듈.
 *              타임스탬프, 로그 레벨, 컬러 출력을 지원한다.
 *
 * ┌──────────┐     ┌──────────┐     ┌──────────┐
 * │ 호출자   │ ──→ │  Logger  │ ──→ │  stdout  │
 * │          │     │ (필터링) │     │ (컬러)   │
 * └──────────┘     └──────────┘     └──────────┘
 *
 * @dependencies config
 * @author AI Video Factory
 */

import { config } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

function shouldLog(level: LogLevel): boolean {
  const configLevel = config.log.level as LogLevel;
  return LEVEL_PRIORITY[level] >= (LEVEL_PRIORITY[configLevel] ?? 0);
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const color = LEVEL_COLOR[level];
  const tag = `${color}[${level.toUpperCase()}]${RESET}`;
  const timestamp = formatTimestamp();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';

  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`${timestamp} ${tag} ${message}${contextStr}`);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>): void => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>): void => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>): void => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>): void => log('error', msg, ctx),
};
