import type { DomainError } from '../../../domain/shared/errors.js';
import { ErrorCode } from '../../../domain/shared/errors.js';
import type { HttpResponse } from './router.js';

/**
 * RFC 9457 "problem details". One shape for every failure, so clients never
 * have to guess how this endpoint reports errors versus that one.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * Exhaustive by construction: `ErrorCode` is a closed union, so adding a domain
 * error without deciding its HTTP status is a compile error, not a 500 in
 * production.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ErrorCode.InvalidInput]: 400,
  [ErrorCode.MemberNotFound]: 404,
  [ErrorCode.CopyNotFound]: 404,
  [ErrorCode.MemberSuspended]: 403,
  [ErrorCode.MemberHasOverdueLoans]: 409,
  [ErrorCode.LoanLimitReached]: 409,
  [ErrorCode.CopyNotAvailable]: 409,
  [ErrorCode.CopyWithdrawn]: 409,
};

export const statusForErrorCode = (code: ErrorCode): number => STATUS_BY_CODE[code];

export const toProblemResponse = (error: DomainError): HttpResponse => {
  const status = statusForErrorCode(error.code);
  const problem: ProblemDetails = {
    type: `https://example.com/problems/${error.code.toLowerCase().replaceAll('_', '-')}`,
    title: error.code
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (character) => character.toUpperCase()),
    status,
    code: error.code,
    detail: error.message,
    ...(error.details === undefined ? {} : { extensions: error.details }),
  };

  return {
    status,
    headers: { 'content-type': 'application/problem+json' },
    body: problem,
  };
};
