/**
 * @module 비동기 핸들러 래퍼
 * @description async Express 핸들러의 에러를 자동으로 catch하여
 *              next()로 전달하는 유틸리티 래퍼.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Route        │ ──→ │ asyncHandler │ ──→ │ Error        │
 * │ Handler      │     │ (try-catch)  │     │ Handler MW   │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies express
 * @author AI Video Factory
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

/**
 * async Express 핸들러를 래핑하여 에러를 자동으로 next()에 전달한다.
 *
 * @example
 * router.get('/items', asyncHandler(async (req, res) => {
 *   const items = await fetchItems();
 *   res.json(items);
 * }));
 */
export function asyncHandler(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error: unknown) => {
      logger.debug('asyncHandler 에러 캐치', {
        method: req.method,
        url: req.originalUrl,
      });
      next(error);
    });
  };
}
