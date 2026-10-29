import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, type DomainErrorCode } from '@owdms/domain';
import { mapPgError } from '@owdms/db';
import { ZodError } from 'zod';

const STATUS: Record<DomainErrorCode, number> = {
  INVALID_AMOUNT: 422, INVALID_QUANTITY: 422, ALLOCATION_EXCEEDS_REMAINING: 422, ALLOCATION_SUM_MISMATCH: 422,
  INSUFFICIENT_STOCK: 409, LOT_EXPIRED: 422, SELF_APPROVAL_FORBIDDEN: 403, STALE_VERSION: 409, APPROVED_IMMUTABLE: 409,
  PERIOD_CLOSED: 409, INVALID_STATE_TRANSITION: 409, CAPABILITY_DISABLED: 422, IDEMPOTENCY_CONFLICT: 409, FORBIDDEN: 403,
  NOT_FOUND: 404, VALUATION_UNCONFIRMED: 422, VALIDATION_FAILED: 422,
};

export class Unauthorized extends Error {}

export function requestId(req: Request): string {
  const r = req as Request & { requestId?: string };
  r.requestId ??= randomUUID();
  return r.requestId;
}

/** 오류 응답: code, safeMessage, fieldErrors, requestId. 개인정보·SQL·스택은 노출하지 않는다. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(raw: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    const rid = requestId(req);
    const err = mapPgError(raw);
    const send = (status: number, code: string, safeMessage: string, fieldErrors: Record<string, string> = {}) =>
      res.status(status).json({ code, safeMessage, fieldErrors, requestId: rid });
    if (err instanceof DomainError) return send(STATUS[err.code] ?? 422, err.code, err.safeMessage, err.fieldErrors);
    if (err instanceof ZodError) {
      const fieldErrors = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message]));
      return send(422, 'VALIDATION_FAILED', '입력값을 확인하십시오.', fieldErrors);
    }
    if (err instanceof Unauthorized) return send(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    if (err instanceof HttpException) return send(err.getStatus(), 'HTTP_ERROR', err.getStatus() === 404 ? '경로를 찾을 수 없습니다.' : '요청을 처리할 수 없습니다.');
    // 내부 오류 상세는 서버 로그에만(요청ID로 추적), 응답에는 안전한 문구만
    console.error(`[${rid}]`, (err as Error)?.message);
    return send(500, 'INTERNAL', '처리 중 오류가 발생했습니다.');
  }
}
