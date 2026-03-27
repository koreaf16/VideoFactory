/**
 * @module 캐릭터 API 라우터
 * @description 캐릭터 CRUD, 후보 생성/조회/좋아요/앵커 설정 API.
 *
 * ┌──────────┐     ┌──────────────┐     ┌───────────────────┐
 * │  Client  │ ──→ │  character   │ ──→ │ candidate-generator│
 * │  (API)   │     │  routes      │     │ / DB queries       │
 * └──────────┘     └──────────────┘     └───────────────────┘
 *
 * @dependencies express, candidate-generator, db queries
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  findCharacterById,
  listCharacters,
  updateCharacterStatus,
} from '../../db/queries/character-queries';
import {
  toggleCandidateLike,
  setAnchorCandidate,
  listCandidatesByJob,
  getLatestJobByChar,
} from '../../db/queries/candidate-queries';
import {
  startCandidateGeneration,
  getJob,
  getJobCandidates,
  stopCandidateGeneration,
} from '../services/candidate-generator';
import {
  startDerivativeGeneration,
  getDerivativeJob,
  derivativeEvents,
  stopDerivativeGeneration,
} from '../services/derivative-generator';
import { logger } from '../../common/logger';
import type { CandidateGenerateRequest } from '../types/character.types';

const router = Router();

// ─── 캐릭터 목록/상세 ──────────────────────────────────────

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const conn = await getConnection();
  try {
    const rows = await listCharacters(conn);
    // 각 캐릭터의 최신 jobId를 병렬 조회
    const withJobs = await Promise.all(
      rows.map(async (r) => {
        const latestJobId = await getLatestJobByChar(conn, r.CHAR_ID as string);
        return { ...r, LATEST_JOB_ID: latestJobId };
      })
    );
    res.json({ success: true, data: withJobs });
  } finally {
    await conn.close();
  }
}));

router.get('/:charId', asyncHandler(async (req: Request, res: Response) => {
  const charId = String(req.params.charId);
  const conn = await getConnection();
  try {
    const row = await findCharacterById(conn, charId);
    if (!row) {
      res.status(404).json({ success: false, error: '캐릭터를 찾을 수 없습니다' });
      return;
    }
    res.json({ success: true, data: row });
  } finally {
    await conn.close();
  }
}));

// ─── 후보 생성/조회 ────────────────────────────────────────

router.post('/generate-candidates', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CandidateGenerateRequest;
  if (!body.charId) {
    res.status(400).json({ success: false, error: 'charId는 필수입니다' });
    return;
  }

  const conn = await getConnection();
  try {
    const exists = await findCharacterById(conn, body.charId);
    if (!exists) {
      res.status(404).json({ success: false, error: '캐릭터를 찾을 수 없습니다' });
      return;
    }
  } finally {
    await conn.close();
  }

  const count = body.count ?? 10;
  const customPrompt = (req.body as Record<string, unknown>).prompt as string | undefined;
  const jobId = await startCandidateGeneration(body.charId, count, customPrompt);
  logger.info('후보 생성 API 호출', { charId: body.charId, count, jobId, custom: !!customPrompt });

  res.json({ success: true, jobId, status: 'generating' });
}));

router.get('/candidates/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getJob(jobId);

  // 메모리에 있으면 실시간 데이터 반환
  if (job) {
    res.json({
      success: true,
      data: {
        jobId: job.jobId,
        charId: job.charId,
        status: job.status,
        total: job.total,
        completed: job.completed,
        candidates: getJobCandidates(jobId),
      },
    });
    return;
  }

  // 메모리에 없으면 DB에서 조회 (서버 재시작 후 기존 job)
  const conn = await getConnection();
  try {
    const rows = await listCandidatesByJob(conn, jobId);
    if (rows.length === 0) {
      res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
      return;
    }
    const charId = rows[0].CHAR_ID;
    const candidates = rows.map((r) => ({
      candidateId: r.CANDIDATE_ID,
      imagePath: r.IMAGE_PATH,
      prompt: r.PROMPT_TEXT ?? '',
      seed: r.SEED ?? 0,
      qualityScore: r.QUALITY_SCORE ?? undefined,
      grade: r.GRADE ?? undefined,
      liked: r.LIKED === 1,
      isAnchor: r.IS_ANCHOR === 1,
      jobId: r.JOB_ID,
    }));
    res.json({
      success: true,
      data: {
        jobId,
        charId,
        status: 'completed',   // DB에 있으면 이미 완료된 job
        total: rows.length,
        completed: rows.length,
        candidates,
      },
    });
  } finally {
    await conn.close();
  }
}));

router.get('/candidates/:jobId/status', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
    return;
  }

  res.json({
    success: true,
    data: {
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      completed: job.completed,
    },
  });
}));

// ─── 좋아요/앵커 ───────────────────────────────────────────

router.post('/candidates/:jobId/like', asyncHandler(async (req: Request, res: Response) => {
  const { candidateId } = req.body as { candidateId: number };
  if (!candidateId) {
    res.status(400).json({ success: false, error: 'candidateId는 필수입니다' });
    return;
  }

  const conn = await getConnection();
  try {
    const newValue = await toggleCandidateLike(conn, candidateId);
    res.json({ success: true, liked: newValue });
  } finally {
    await conn.close();
  }
}));

router.post('/candidates/:jobId/anchor', asyncHandler(async (req: Request, res: Response) => {
  const { anchorCandidateId } = req.body as { anchorCandidateId: number };
  if (!anchorCandidateId) {
    res.status(400).json({ success: false, error: 'anchorCandidateId는 필수입니다' });
    return;
  }

  const conn = await getConnection();
  try {
    await setAnchorCandidate(conn, anchorCandidateId);

    const candidates = await listCandidatesByJob(conn, String(req.params.jobId));
    const anchor = candidates.find((c) => c.CANDIDATE_ID === anchorCandidateId);
    if (anchor) {
      await updateCharacterStatus(conn, anchor.CHAR_ID, 'anchor_set');
    }

    // 앵커 확정 후 파생 생성 자동 시작
    let derivJobId: string | null = null;
    if (anchor) {
      const charRow = await findCharacterById(conn, anchor.CHAR_ID);
      const basePrompt = anchor.PROMPT_TEXT ?? '';
      derivJobId = startDerivativeGeneration(
        anchor.CHAR_ID,
        anchor.IMAGE_PATH,
        basePrompt,
      );
      logger.info('앵커 확정 → 파생 생성 시작', {
        charId: anchor.CHAR_ID, anchorCandidateId, derivJobId,
      });
    }

    res.json({ success: true, derivativeJobId: derivJobId });
  } finally {
    await conn.close();
  }
}));

// ─── 파생 이미지 ────────────────────────────────────────────

router.post('/derivatives/generate', asyncHandler(async (req: Request, res: Response) => {
  const { charId, anchorPath, basePrompt, count } = req.body as {
    charId: string; anchorPath: string; basePrompt: string; count?: number;
  };
  if (!charId || !anchorPath) {
    res.status(400).json({ success: false, error: 'charId와 anchorPath는 필수입니다' });
    return;
  }

  const jobId = startDerivativeGeneration(charId, anchorPath, basePrompt || '', count);
  res.json({ success: true, jobId });
}));

router.get('/derivatives/:jobId/status', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getDerivativeJob(jobId);

  if (!job) {
    res.status(404).json({ success: false, error: '파생 작업을 찾을 수 없습니다' });
    return;
  }

  res.json({ success: true, data: job });
}));

// ─── SSE 실시간 진행 상태 ────────────────────────────────────

router.get('/derivatives/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getDerivativeJob(jobId);

  if (!job) {
    res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 현재 상태 즉시 전송
  res.write(`data: ${JSON.stringify({
    jobId: job.jobId, status: job.status,
    total: job.total, completed: job.completed,
    currentStep: job.currentStep, results: job.results,
  })}\n\n`);

  // 이벤트 리스너
  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  derivativeEvents.on(`job:${jobId}`, onProgress);

  req.on('close', () => {
    derivativeEvents.off(`job:${jobId}`, onProgress);
  });
});

// ─── 후보 생성 SSE ──────────────────────────────────────────

router.get('/candidates/:jobId/stream', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getJob(jobId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 메모리에 없으면 DB에서 즉시 완료 상태로 반환
  if (!job) {
    const conn = await getConnection();
    try {
      const rows = await listCandidatesByJob(conn, jobId);
      const candidates = rows.map((r) => ({
        candidateId: r.CANDIDATE_ID,
        imagePath: r.IMAGE_PATH,
        prompt: r.PROMPT_TEXT ?? '',
        seed: r.SEED ?? 0,
        qualityScore: r.QUALITY_SCORE ?? undefined,
        grade: r.GRADE ?? undefined,
        liked: r.LIKED === 1,
        isAnchor: r.IS_ANCHOR === 1,
        jobId: r.JOB_ID,
      }));
      const charId = rows[0]?.CHAR_ID ?? '';
      res.write(`data: ${JSON.stringify({
        jobId, charId, status: 'completed',
        total: rows.length, completed: rows.length, candidates,
      })}\n\n`);
    } finally {
      await conn.close();
    }
    res.end();
    return;
  }

  // 메모리에 있으면 실시간 폴링
  const sendState = (): void => {
    res.write(`data: ${JSON.stringify({
      jobId: job.jobId, status: job.status,
      total: job.total, completed: job.completed,
      candidates: job.candidates,
    })}\n\n`);
  };

  sendState();
  const timer = setInterval(() => {
    sendState();
    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(timer);
      res.end();
    }
  }, 2000);

  req.on('close', () => { clearInterval(timer); });
}));

// ─── 생성 작업 중단 ───────────────────────────────────────

router.post('/candidates/:jobId/stop', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const stopped = stopCandidateGeneration(jobId);

  if (!stopped) {
    res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
    return;
  }

  res.json({ success: true, message: '후보 생성 중단 요청 완료' });
}));

router.post('/derivatives/:jobId/stop', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const stopped = stopDerivativeGeneration(jobId);

  if (!stopped) {
    res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
    return;
  }

  res.json({ success: true, message: '파생 생성 중단 요청 완료' });
}));

export default router;
