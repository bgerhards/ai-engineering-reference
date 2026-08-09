/**
 * Every domain failure is one of these codes. The list is deliberately closed:
 * adding a failure mode means adding a code here, which forces the HTTP layer's
 * exhaustive status mapping to be updated in the same change.
 */
export const ErrorCode = {
  InvalidInput: 'INVALID_INPUT',
  MemberNotFound: 'MEMBER_NOT_FOUND',
  MemberSuspended: 'MEMBER_SUSPENDED',
  MemberHasOverdueLoans: 'MEMBER_HAS_OVERDUE_LOANS',
  LoanLimitReached: 'LOAN_LIMIT_REACHED',
  CopyNotFound: 'COPY_NOT_FOUND',
  CopyNotAvailable: 'COPY_NOT_AVAILABLE',
  CopyWithdrawn: 'COPY_WITHDRAWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface DomainError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const domainError = (
  code: ErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError => (details === undefined ? { code, message } : { code, message, details });
