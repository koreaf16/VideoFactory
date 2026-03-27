/**
 * @module 시간 유틸리티
 * @description 타임스탬프 포맷팅, 소요 시간 표시, 작업 ID 생성,
 *              비동기 대기 등 시간 관련 공통 유틸리티.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ 호출자       │ ──→ │ time-utils   │ ──→ │ 포맷된   │
 * │              │     │ (변환)       │     │ 문자열   │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies crypto
 * @author AI Video Factory
 */

import crypto from 'crypto';
import { logger } from '../logger';

/**
 * Date 객체를 ISO 8601 포맷 문자열로 변환한다.
 * date를 생략하면 현재 시각을 사용한다.
 *
 * @param date - 변환할 Date 객체 (기본값: 현재 시각)
 * @returns ISO 형식 타임스탬프 문자열
 */
export function formatTimestamp(date?: Date): string {
  return (date ?? new Date()).toISOString();
}

/**
 * 밀리초 단위 소요 시간을 사람이 읽기 쉬운 형식으로 변환한다.
 *
 * @param ms - 밀리초 단위 소요 시간
 * @returns 예: "2m 30s", "500ms", "1h 5m 3s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes % 60 > 0) {
    parts.push(`${minutes % 60}m`);
  }
  if (seconds % 60 > 0) {
    parts.push(`${seconds % 60}s`);
  }

  return parts.join(' ');
}

/**
 * 고유한 작업 ID를 생성한다.
 * crypto.randomBytes를 사용하여 충돌 방지.
 *
 * @param prefix - ID 접두어 (기본값: "job")
 * @returns 예: "job_a1b2c3d4e5f6"
 */
export function generateJobId(prefix: string = 'job'): string {
  const randomHex = crypto.randomBytes(6).toString('hex');
  const jobId = `${prefix}_${randomHex}`;

  logger.debug('작업 ID 생성', { jobId });

  return jobId;
}

/**
 * 지정된 밀리초만큼 비동기 대기한다.
 *
 * @param ms - 대기할 밀리초
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
