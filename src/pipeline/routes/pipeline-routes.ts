import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  createRun,
  listAllRuns,
  getRunDetail,
  advanceStage,
  setProtagonist,
  setScript,
} from '../services/pipeline-orchestrator';
import { logger } from '../../common/logger';
import type { CreateRunRequest } from '../types/pipeline.types';

const router = Router();

function parseRunId(param: string | string[], res: Response): number | null {
  const runId = Number(Array.isArray(param) ? param[0] : param);
  if (isNaN(runId) || !Number.isInteger(runId) || runId <= 0) {
    res.status(400).json({ success: false, error: 'runId는 양의 정수여야 합니다' });
    return null;
  }
  return runId;
}

// ─── 프로덕션 런 목록 ──────────────────────────────────────

router.get(
  '/runs',
  asyncHandler(async (_req: Request, res: Response) => {
    const runs = await listAllRuns();
    res.json({ success: true, data: runs });
  }),
);

// ─── 프로덕션 런 생성 ──────────────────────────────────────

router.post(
  '/runs',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateRunRequest;
    const run = await createRun(body);
    logger.info('프로덕션 런 생성 API', { runId: run.runId });
    res.json({ success: true, data: run });
  }),
);

// ─── 프로덕션 런 상세 ──────────────────────────────────────

router.get(
  '/runs/:runId',
  asyncHandler(async (req: Request, res: Response) => {
    const runId = parseRunId(req.params.runId, res);
    if (runId === null) return;
    try {
      const detail = await getRunDetail(runId);
      res.json({ success: true, data: detail });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: msg });
        return;
      }
      throw err;
    }
  }),
);

// ─── 다음 스테이지로 진행 ───────────────────────────────────

router.post(
  '/runs/:runId/advance',
  asyncHandler(async (req: Request, res: Response) => {
    const runId = parseRunId(req.params.runId, res);
    if (runId === null) return;
    try {
      const result = await advanceStage(runId);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: msg });
        return;
      }
      res.status(400).json({ success: false, error: msg });
    }
  }),
);

// ─── 주인공 지정 ────────────────────────────────────────────

router.post(
  '/runs/:runId/protagonist',
  asyncHandler(async (req: Request, res: Response) => {
    const runId = parseRunId(req.params.runId, res);
    if (runId === null) return;
    const { protagonistId } = req.body as { protagonistId: string };
    if (!protagonistId) {
      res.status(400).json({ success: false, error: 'protagonistId는 필수입니다' });
      return;
    }
    try {
      await setProtagonist(runId, protagonistId);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: msg });
        return;
      }
      throw err;
    }
  }),
);

// ─── 마스터 대본 지정 ───────────────────────────────────────

router.post(
  '/runs/:runId/script',
  asyncHandler(async (req: Request, res: Response) => {
    const runId = parseRunId(req.params.runId, res);
    if (runId === null) return;
    const { scriptId } = req.body as { scriptId: number };
    if (!scriptId) {
      res.status(400).json({ success: false, error: 'scriptId는 필수입니다' });
      return;
    }
    try {
      await setScript(runId, scriptId);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: msg });
        return;
      }
      throw err;
    }
  }),
);

export default router;
