/**
 * @module 파생 이미지 생성 서비스
 * @description 앵커 이미지 기준으로 유사 얼굴 이미지를 목표 수량까지 반복 생성한다.
 *
 * ┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
 * │ 프리셋   │ ──→ │ ComfyUI  │ ──→ │face_recognition│ ──→ │ 유사: 유지│
 * │ + 외모   │     │ (SDXL)   │     │ (유사도 비교)  │     │ 비유사: 삭제│
 * └──────────┘     └──────────┘     └──────────────┘     └──────────┘
 *       ↑                                                      │
 *  30장 미만이면 ←────────────── 반복 ────────────────────────────┘
 *
 * @dependencies comfyui, workflow-builder, face_recognition, db
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { config } from '../../config';
import { comfyuiClient } from '../../comfyui/client';
import { buildDerivativeWorkflow } from '../../comfyui/workflow-builder';
import { getConnection } from '../../db/connection';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { compareFaces } from '../../python-api/endpoints/embedding-api';
import { logger } from '../../common/logger';

// ─── 파생 포즈/표정 프리셋 ──────────────────────────────

interface DerivativePreset {
  label: string;
  promptSuffix: string;
  negativeExtra: string;  // 프리셋별 추가 네거티브 프롬프트
}

// 모든 프리셋 공통 네거티브 (야외 배경 차단)
const COMMON_NEGATIVE = 'outdoor, nature, trees, park, garden, forest, street, city, sky, clouds, bokeh, blurry background, depth of field';

/**
 * 프리셋이 포즈/표정/구도/배경을 완전히 제어한다.
 * 베이스 프롬프트에서는 외모(머리, 눈, 피부, 의상)만 사용.
 *
 * 핵심: 배경은 (plain white background:1.8)로 강제 + 네거티브로 야외 차단
 *       표정은 높은 가중치 + 네거티브로 반대 표정 차단
 */
const DERIVATIVE_PRESETS: DerivativePreset[] = [
  { label: '정면 미소', promptSuffix: '(masterpiece:1.2), 1girl, solo, head and shoulders portrait, front view, facing camera, (gentle smile:1.3), (plain white background:1.8), (studio soft lighting:1.5), simple background', negativeExtra: '' },
  { label: '정면 진지', promptSuffix: '(masterpiece:1.2), 1girl, solo, head and shoulders portrait, front view, facing camera, (serious expression:1.6), (neutral face:1.5), (no smile:1.5), (closed mouth:1.4), (plain white background:1.8), (studio soft lighting:1.5), simple background', negativeExtra: 'smile, smiling, happy, grin, laughing, open mouth' },
  { label: '45도 미소', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, (three quarter view:1.5), (face turned 45 degrees right:1.4), soft smile, (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'front view, facing camera' },
  { label: '45도 놀람', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, (three quarter view:1.5), (face turned 45 degrees left:1.4), (surprised expression:1.6), (open mouth:1.4), (wide eyes:1.5), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'smile, smiling, calm, neutral, front view, facing camera' },
  { label: '측면 프로필', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, (perfect side profile:1.6), (face turned 90 degrees:1.5), (showing ear:1.3), showing nose silhouette, (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'front view, facing camera, looking at viewer' },
  { label: '살짝 고개숙임', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, front view, (head tilted down:1.5), (looking up through lashes:1.4), (shy expression:1.4), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: '' },
  { label: '웃음 클로즈업', promptSuffix: '(masterpiece:1.2), 1girl, solo, (extreme close-up face:1.6), (face only:1.4), (bright laugh:1.5), (eyes closed from laughing:1.4), showing teeth, (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'upper body, full body, half body' },
  { label: '화난 표정', promptSuffix: '(masterpiece:1.2), 1girl, solo, head and shoulders, front view, (angry expression:1.7), (furrowed eyebrows:1.5), (intense glare:1.5), (frowning:1.5), (no smile:1.6), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'smile, smiling, happy, grin, laughing, gentle, cute, friendly' },
  { label: '슬픈 표정', promptSuffix: '(masterpiece:1.2), 1girl, solo, head and shoulders, front view, (sad expression:1.7), (downcast eyes:1.5), (tearful:1.4), (pouting:1.4), (no smile:1.6), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'smile, smiling, happy, grin, laughing, cheerful, bright' },
  { label: '윙크', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, front view, (winking one eye:1.6), (one eye closed:1.5), (playful expression:1.4), (peace sign:1.3), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: '' },
  { label: '뒷모습', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, (from behind:1.7), (back of head:1.6), (back view:1.6), (showing back:1.5), showing hair from back, (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'facing camera, front view, looking at viewer, looking at camera, face visible' },
  { label: '전신 정면', promptSuffix: '(masterpiece:1.2), 1girl, solo, (full body:1.6), (standing straight:1.4), arms at sides, front view, facing camera, (head to toe visible:1.5), (feet visible:1.3), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'close-up, portrait, upper body only' },
  { label: '전신 측면', promptSuffix: '(masterpiece:1.2), 1girl, solo, (full body:1.6), (side view:1.5), (profile:1.4), standing, (head to toe visible:1.5), (feet visible:1.3), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'front view, facing camera, close-up, portrait' },
  { label: '상반신 팔짱', promptSuffix: '(masterpiece:1.2), 1girl, solo, upper body, front view, (arms crossed:1.6), (crossed arms:1.5), (confident smirk:1.4), (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: '' },
  { label: '클로즈업 눈', promptSuffix: '(masterpiece:1.2), 1girl, solo, (extreme close-up:1.6), (detailed eyes:1.6), (iris detail:1.5), (eyelashes:1.4), (eyes only:1.4), upper face only, (plain white background:1.8), (studio lighting:1.5), simple background', negativeExtra: 'full body, upper body, half body, portrait' },
];

// ─── 설정 상수 ──────────────────────────────────────────

const TARGET_SIMILAR_COUNT = 30;  // 목표 유사 이미지 수
const MAX_BATCHES = 10;           // 최대 반복 횟수 (15*10=150장 상한)
const FACE_SIMILARITY_THRESHOLD = 0.4;  // 유사 판정 거리 기준

// ─── 외모 전용 프롬프트 추출 ─────────────────────────────

function extractAppearanceOnly(prompt: string): string {
  const tokens = prompt.split(',').map((t) => t.trim()).filter(Boolean);

  const REMOVE_KEYWORDS = [
    'smile', 'smiling', 'radiant smile', 'gentle smile', 'bright smile',
    'laughing', 'grinning', 'serious', 'angry', 'sad', 'surprised',
    'crying', 'winking', 'pouting', 'frowning', 'neutral face',
    'no smile', 'open mouth', 'closed mouth', 'bright radiant',
    'selfie', 'self shot', 'self-shot', 'front view', 'side view',
    'back view', 'three quarter view', 'profile view', 'facing camera',
    'looking at camera', 'looking at viewer', 'looking up', 'looking down',
    'looking away', 'head tilt', 'arms crossed', 'arms at sides',
    'standing', 'sitting', 'walking', 'running', 'peace sign', 'v sign',
    'waving', 'pointing', 'full body', 'upper body', 'half body',
    'head shot', 'close-up', 'close up', 'closeup', 'portrait',
    'cowboy shot', 'bust shot', 'from above', 'from below', 'from behind',
    'from side', 'head and shoulders',
    'background', 'cherry blossom', 'sakura', 'outdoor', 'indoor',
    'forest', 'city', 'street', 'classroom', 'office', 'beach',
    'sunset', 'sunrise', 'golden hour', 'soft lighting', 'studio lighting',
    'studio light', 'natural lighting', 'dramatic lighting', 'rim lighting',
    'trees', 'sky', 'clouds', 'garden', 'park', 'cafe', 'restaurant',
    'room', 'night', 'day',
    'selfie stick', 'holding phone', 'holding smartphone', 'holding camera',
    'phone camera', 'smartphone', 'taking selfie', 'taking photo',
    'vlogging', 'vlog', 'recording', 'filming',
    'masterpiece', 'best quality', 'high quality', 'ultra detailed',
    'highres', 'absurdres', '8k',
    '1girl', '1boy', 'solo',
  ];

  const filtered = tokens.filter((token) => {
    const plain = token.replace(/\(([^)]+):[0-9.]+\)/g, '$1').toLowerCase();
    return !REMOVE_KEYWORDS.some((kw) => plain.includes(kw));
  });

  return filtered.join(', ');
}

// ─── 인터페이스 ─────────────────────────────────────────

export interface DerivativeResult {
  refId?: number;
  imagePath: string;
  label: string;
  prompt: string;
  seed: number;
  distance?: number;
}

export interface DerivativeJob {
  jobId: string;
  charId: string;
  anchorPath: string;
  status: 'preparing' | 'generating' | 'filtering' | 'completed' | 'failed' | 'stopped';
  total: number;        // 목표 유사 이미지 수
  completed: number;    // 현재 유사 이미지 수
  generated: number;    // 총 생성된 이미지 수
  deleted: number;      // 삭제된 이미지 수
  batch: number;        // 현재 배치 번호
  currentStep: string;
  results: DerivativeResult[];
  shouldStop?: boolean;  // 중단 요청 플래그
}

// ─── SSE 이벤트 에미터 ──────────────────────────────────

export const derivativeEvents = new EventEmitter();
derivativeEvents.setMaxListeners(50);

function emitProgress(job: DerivativeJob): void {
  derivativeEvents.emit(`job:${job.jobId}`, {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    completed: job.completed,
    generated: job.generated,
    deleted: job.deleted,
    batch: job.batch,
    currentStep: job.currentStep,
    results: job.results,
  });
}

// ─── 인메모리 작업 관리 ──────────────────────────────────

const activeJobs: Map<string, DerivativeJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/derivatives');

function getComfyOutputUrl(filename: string, subfolder: string): string {
  const params = new URLSearchParams({ filename, subfolder, type: 'output' });
  return `${config.comfyui.httpUrl}/view?${params.toString()}`;
}

// ─── 공개 API ───────────────────────────────────────────

/** 파생 이미지 생성을 시작한다. 목표 수량까지 반복 생성. */
export function startDerivativeGeneration(
  charId: string,
  anchorPath: string,
  basePrompt: string,
  targetCount?: number,
): string {
  const jobId = generateJobId('deriv');
  const job: DerivativeJob = {
    jobId, charId, anchorPath,
    status: 'preparing',
    total: targetCount ?? TARGET_SIMILAR_COUNT,
    completed: 0,
    generated: 0,
    deleted: 0,
    batch: 0,
    currentStep: '준비 중...',
    results: [],
  };

  activeJobs.set(jobId, job);
  logger.info('파생 생성 시작 (유사도 필터링 모드)', {
    jobId, charId, targetCount: job.total,
  });

  processDerivativeLoop(job, basePrompt).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('파생 생성 실패', { jobId, error: message });
    job.status = 'failed';
    job.currentStep = `실패: ${message}`;
    emitProgress(job);
  });

  return jobId;
}

export function getDerivativeJob(jobId: string): DerivativeJob | undefined {
  return activeJobs.get(jobId);
}

export function stopDerivativeGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;

  job.shouldStop = true;
  logger.info('파생 생성 중단 요청', { jobId });
  return true;
}

// ─── 이미지 생성 (1장) ──────────────────────────────────

async function generateOneImage(
  job: DerivativeJob,
  preset: DerivativePreset,
  basePrompt: string,
  outDir: string,
): Promise<DerivativeResult | null> {
  const seed = Math.floor(Math.random() * 999999999);
  const appearancePrompt = extractAppearanceOnly(basePrompt);
  const fullPrompt = appearancePrompt
    ? `${preset.promptSuffix}, ${appearancePrompt}`
    : preset.promptSuffix;

  // 프리셋별 네거티브 프롬프트 조합
  const negativeExtra = [COMMON_NEGATIVE, preset.negativeExtra].filter(Boolean).join(', ');

  job.currentStep = `배치${job.batch} — ${preset.label} 생성 중... (유사: ${job.completed}/${job.total})`;
  emitProgress(job);

  const workflow = buildDerivativeWorkflow({
    prompt: fullPrompt,
    negativePrompt: negativeExtra || undefined,
    anchorImagePath: '',
    seed,
  });

  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId);

  if (images.length === 0) {
    logger.warn('이미지 생성 결과 없음', { label: preset.label });
    return null;
  }

  const filename = `${job.charId}_${preset.label}_${seed}.png`;
  const imagePath = path.join(outDir, filename);

  const imageUrl = getComfyOutputUrl(images[0].filename, images[0].subfolder);
  const response = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  await writeFileBuffer(imagePath, imageBuffer);

  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  // DB 저장
  const oracledb = await import('oracledb');
  const conn = await getConnection();
  let refId: number | undefined;
  try {
    const insertResult = await conn.execute(
      `INSERT INTO char_ref_images (char_id, image_path, pose_tag)
       VALUES (:charId, :imagePath, :poseTag)
       RETURNING ref_id INTO :refId`,
      {
        charId: job.charId,
        imagePath,
        poseTag: preset.label,
        refId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const outBinds = insertResult.outBinds as unknown as { refId: number[] };
    refId = outBinds.refId[0];
  } finally {
    await conn.close();
  }

  job.generated += 1;

  return { refId, imagePath, label: preset.label, prompt: fullPrompt, seed };
}

// ─── 유사도 필터링 + 삭제 ───────────────────────────────

async function filterAndDeleteDissimilar(
  job: DerivativeJob,
  batchResults: DerivativeResult[],
): Promise<DerivativeResult[]> {
  if (batchResults.length === 0) return [];

  job.status = 'filtering';
  job.currentStep = `배치${job.batch} — 얼굴 유사도 분석 중... (${batchResults.length}장)`;
  emitProgress(job);

  const imagePaths = batchResults.map((r) => r.imagePath);

  let compareResult;
  try {
    compareResult = await compareFaces(
      job.anchorPath,
      imagePaths,
      FACE_SIMILARITY_THRESHOLD,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('얼굴 비교 API 호출 실패', { error: msg });
    // API 실패 시 전부 유지 (삭제 안 함)
    return batchResults;
  }

  const similarPaths = new Set(
    compareResult.results.filter((r) => r.similar).map((r) => r.path),
  );

  const kept: DerivativeResult[] = [];
  const toDelete: DerivativeResult[] = [];

  for (const result of batchResults) {
    if (similarPaths.has(result.imagePath)) {
      // 유사도 거리 저장
      const compareItem = compareResult.results.find((r) => r.path === result.imagePath);
      result.distance = compareItem?.distance;
      kept.push(result);
    } else {
      toDelete.push(result);
    }
  }

  // 비유사 이미지 삭제 (파일 + 썸네일 + DB)
  for (const result of toDelete) {
    try {
      // 파일 삭제
      if (fs.existsSync(result.imagePath)) {
        fs.unlinkSync(result.imagePath);
      }
      // 썸네일 삭제
      const thumbPath = path.join(
        path.dirname(result.imagePath),
        `thumb_${path.basename(result.imagePath)}`,
      );
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
      // DB 삭제
      if (result.refId) {
        const conn = await getConnection();
        try {
          await conn.execute(
            'DELETE FROM char_ref_images WHERE ref_id = :refId',
            { refId: result.refId },
            { autoCommit: true },
          );
        } finally {
          await conn.close();
        }
      }
      job.deleted += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('비유사 이미지 삭제 실패', { path: result.imagePath, error: msg });
    }
  }

  logger.info('유사도 필터링 완료', {
    jobId: job.jobId, batch: job.batch,
    generated: batchResults.length, kept: kept.length, deleted: toDelete.length,
  });

  return kept;
}

// ─── 메인 루프 ──────────────────────────────────────────

async function processDerivativeLoop(
  job: DerivativeJob,
  basePrompt: string,
): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, job.charId, job.jobId);
  await ensureDir(outDir);
  await comfyuiClient.connect();

  job.status = 'generating';

  while (job.completed < job.total && job.batch < MAX_BATCHES) {
    if (job.shouldStop) {
      job.status = 'stopped';
      job.currentStep = `중단됨 — 유사 ${job.completed}장 확보 (총 ${job.generated}장 생성)`;
      emitProgress(job);
      logger.info('파생 생성 중단', {
        jobId: job.jobId, completed: job.completed, generated: job.generated,
      });
      break;
    }

    job.batch += 1;

    logger.info('배치 시작', {
      jobId: job.jobId, batch: job.batch, currentSimilar: job.completed, target: job.total,
    });

    // 15개 프리셋으로 1배치 생성
    const batchResults: DerivativeResult[] = [];

    for (const preset of DERIVATIVE_PRESETS) {
      if (job.shouldStop) break;

      try {
        const result = await generateOneImage(job, preset, basePrompt, outDir);
        if (result) {
          batchResults.push(result);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('이미지 생성 실패', { label: preset.label, error: msg });
        job.currentStep = `${preset.label} 실패 — 다음으로`;
        emitProgress(job);
      }
    }

    // 유사도 필터링
    const kept = await filterAndDeleteDissimilar(job, batchResults);
    job.results.push(...kept);
    job.completed = job.results.length;

    job.currentStep = `배치${job.batch} 완료 — 유사 ${job.completed}/${job.total}장 (생성 ${job.generated}, 삭제 ${job.deleted})`;
    job.status = 'generating';
    emitProgress(job);

    // 목표 달성 확인
    if (job.completed >= job.total) {
      break;
    }

    logger.info('목표 미달, 다음 배치 진행', {
      jobId: job.jobId, current: job.completed, target: job.total,
    });
  }

  job.status = 'completed';
  job.currentStep = `완료! 유사 ${job.completed}장 확보 (총 ${job.generated}장 생성, ${job.deleted}장 삭제)`;
  emitProgress(job);

  logger.info('파생 생성 완료', {
    jobId: job.jobId,
    similarCount: job.completed,
    totalGenerated: job.generated,
    totalDeleted: job.deleted,
    batches: job.batch,
  });
}
