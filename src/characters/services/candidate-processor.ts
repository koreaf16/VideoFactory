/**
 * @module 후보 이미지 개별 처리
 * @description 1장의 후보 이미지를 생성, 품질 평가, DB 저장하는 로직
 *
 * @dependencies comfyui, quality-api, db, file-utils
 * @author AI Video Factory
 */

import path from 'path';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextAnchorWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { scoreImage } from '../../python-api/endpoints/quality-api';
import { getConnection } from '../../db/connection';
import { insertCandidate } from '../../db/queries/candidate-queries';
import { writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import type { CandidatePrompt } from './prompt-builder';
import type { CandidateResult, GenerationJob } from './candidate-generator';

function assignGrade(score: number): string {
  if (score >= 0.9) return 'S';
  if (score >= 0.8) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}

async function generateAndSaveImage(
  charId: string,
  promptItem: CandidatePrompt,
  outDir: string,
): Promise<string> {
  const workflow = buildKontextAnchorWorkflow({
    prompt: promptItem.prompt,
    seed: promptItem.seed,
    filenamePrefix: `${charId}_${promptItem.seed}`,
  });
  await comfyuiClient.connect();
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 120_000);
  if (images.length === 0) throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${charId}_${promptItem.seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);
  return imagePath;
}

/** 후보 이미지 1장을 생성하고 품질 평가 후 DB에 저장한다. */
export async function processOneCandidate(
  job: GenerationJob,
  promptItem: CandidatePrompt,
  outDir: string,
): Promise<void> {
  const imagePath = await generateAndSaveImage(job.charId, promptItem, outDir);

  const candidate: CandidateResult = {
    imagePath,
    prompt: promptItem.prompt,
    seed: promptItem.seed,
  };
  job.status = 'scoring';

  try {
    const scoreResult = await scoreImage(imagePath);
    if (scoreResult.success && scoreResult.data) {
      candidate.qualityScore = scoreResult.data.score;
      candidate.grade = assignGrade(scoreResult.data.score);
    }
  } catch (scoreErr: unknown) {
    const msg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
    logger.warn('품질 평가 실패 (건너뜀)', { jobId: job.jobId, error: msg });
  }

  const conn = await getConnection();
  try {
    const candidateId = await insertCandidate(conn, {
      charId: job.charId,
      jobId: job.jobId,
      imagePath,
      promptText: promptItem.prompt,
      seed: promptItem.seed,
      qualityScore: candidate.qualityScore ?? null,
      grade: candidate.grade ?? null,
    });
    candidate.candidateId = candidateId;
  } finally {
    await conn.close();
  }

  job.candidates.push(candidate);
  job.completed += 1;
  job.status = 'generating';
  logger.debug('후보 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
    score: candidate.qualityScore,
  });
}
