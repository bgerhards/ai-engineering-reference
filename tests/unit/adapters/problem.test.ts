import { describe, expect, it } from 'vitest';
import type { ProblemDetails } from '@/adapters/inbound/http/problem.js';
import { statusForErrorCode, toProblemResponse } from '@/adapters/inbound/http/problem.js';
import { ErrorCode, domainError } from '@/domain/shared/errors.js';

const problemBodyOf = (error: Parameters<typeof toProblemResponse>[0]): ProblemDetails =>
  toProblemResponse(error).body as ProblemDetails;

describe('statusForErrorCode', () => {
  it.each(Object.values(ErrorCode))(
    'maps %s to a client-error status rather than leaving it unmapped',
    (code) => {
      // Iterating the closed union means adding a new ErrorCode without a status
      // fails here, instead of surfacing as an `undefined` status in production.
      const status = statusForErrorCode(code);

      expect(typeof status).toBe('number');
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(499);
    },
  );

  it.each([
    [ErrorCode.InvalidInput, 400],
    [ErrorCode.MemberNotFound, 404],
    [ErrorCode.CopyNotFound, 404],
    [ErrorCode.MemberSuspended, 403],
    [ErrorCode.MemberHasOverdueLoans, 409],
    [ErrorCode.LoanLimitReached, 409],
    [ErrorCode.CopyNotAvailable, 409],
    [ErrorCode.CopyWithdrawn, 409],
  ])('answers %s with %i', (code, expected) => {
    expect(statusForErrorCode(code)).toBe(expected);
  });
});

describe('toProblemResponse', () => {
  it('serves problem details under the RFC 9457 media type', () => {
    const response = toProblemResponse(domainError(ErrorCode.CopyNotFound, 'No such copy.'));

    expect(response.headers).toMatchObject({ 'content-type': 'application/problem+json' });
  });

  it('uses the status the code maps to for both the header and the body', () => {
    const response = toProblemResponse(domainError(ErrorCode.MemberSuspended, 'Suspended.'));

    expect(response.status).toBe(403);
    expect((response.body as ProblemDetails).status).toBe(403);
  });

  it('carries the machine-readable code and the human-readable message through', () => {
    const problem = problemBodyOf(domainError(ErrorCode.CopyWithdrawn, 'This copy is withdrawn.'));

    expect(problem.code).toBe('COPY_WITHDRAWN');
    expect(problem.detail).toBe('This copy is withdrawn.');
  });

  it('derives a dereferenceable type URI from the code', () => {
    const problem = problemBodyOf(domainError(ErrorCode.MemberHasOverdueLoans, 'Overdue.'));

    expect(problem.type).toBe('https://example.com/problems/member-has-overdue-loans');
  });

  it('derives a human-readable title from the code', () => {
    const problem = problemBodyOf(domainError(ErrorCode.MemberHasOverdueLoans, 'Overdue.'));

    expect(problem.title).toBe('Member has overdue loans');
  });

  it('surfaces domain error details as problem extensions', () => {
    const problem = problemBodyOf(
      domainError(ErrorCode.LoanLimitReached, 'Too many.', {
        memberId: 'member-1',
        maxActiveLoans: 5,
      }),
    );

    expect(problem.extensions).toEqual({ memberId: 'member-1', maxActiveLoans: 5 });
  });

  it('omits the extensions key entirely when the error carries no details', () => {
    const problem = problemBodyOf(domainError(ErrorCode.InvalidInput, 'Bad request.'));

    expect(Object.hasOwn(problem, 'extensions')).toBe(false);
  });

  it.each(Object.values(ErrorCode))('produces a complete problem document for %s', (code) => {
    const problem = problemBodyOf(domainError(code, 'Something went wrong.'));

    expect(problem).toEqual({
      type: expect.stringContaining('https://example.com/problems/') as string,
      title: expect.any(String) as string,
      status: statusForErrorCode(code),
      code,
      detail: 'Something went wrong.',
    });
  });
});
