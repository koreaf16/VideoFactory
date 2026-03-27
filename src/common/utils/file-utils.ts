/**
 * @module 파일 유틸리티
 * @description 디렉토리 생성, 파일 읽기/쓰기, 존재 확인 등
 *              파일시스템 관련 공통 유틸리티 함수 모음.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ 호출자       │ ──→ │ file-utils   │ ──→ │ fs/      │
 * │              │     │ (래퍼)       │     │ promises │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies fs/promises, path
 * @author AI Video Factory
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger';

/**
 * 디렉토리가 존재하지 않으면 재귀적으로 생성한다 (mkdir -p).
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    logger.debug('디렉토리 확인/생성 완료', { dirPath });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('디렉토리 생성 실패', { dirPath, error: message });
    throw error;
  }
}

/**
 * 파일을 Buffer로 읽어 반환한다.
 */
export async function readFileBuffer(filePath: string): Promise<Buffer> {
  try {
    const resolved = path.resolve(filePath);
    const buffer = await fs.readFile(resolved);
    logger.debug('파일 읽기 완료', { filePath: resolved, size: buffer.length });
    return buffer;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('파일 읽기 실패', { filePath, error: message });
    throw error;
  }
}

/**
 * Buffer 데이터를 파일로 저장한다. 부모 디렉토리가 없으면 자동 생성한다.
 */
export async function writeFileBuffer(filePath: string, data: Buffer): Promise<void> {
  try {
    const resolved = path.resolve(filePath);
    await ensureDir(path.dirname(resolved));
    await fs.writeFile(resolved, data);
    logger.debug('파일 쓰기 완료', { filePath: resolved, size: data.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('파일 쓰기 실패', { filePath, error: message });
    throw error;
  }
}

/**
 * 파일 존재 여부를 확인한다.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const resolved = path.resolve(filePath);
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}
