import type { BookCopyId } from '../catalog/book-copy.js';
import { addDays, isBefore } from '../shared/date.js';
import type { DomainError } from '../shared/errors.js';
import { ErrorCode, domainError } from '../shared/errors.js';
import type { Brand } from '../shared/identifier.js';
import { parseIdentifier } from '../shared/identifier.js';
import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import type { MemberId } from './member.js';

export type LoanId = Brand<string, 'LoanId'>;

export const parseLoanId = (raw: string): Result<LoanId, DomainError> =>
  parseIdentifier('LoanId', raw);

export interface Loan {
  readonly id: LoanId;
  readonly copyId: BookCopyId;
  readonly memberId: MemberId;
  readonly checkedOutAt: Date;
  readonly dueAt: Date;
  /** `null` while the copy is still out. Set once, on return. */
  readonly returnedAt: Date | null;
}

export interface OpenLoanInput {
  readonly id: LoanId;
  readonly copyId: BookCopyId;
  readonly memberId: MemberId;
  readonly at: Date;
  readonly loanPeriodDays: number;
}

export const openLoan = (input: OpenLoanInput): Result<Loan, DomainError> => {
  if (!Number.isInteger(input.loanPeriodDays) || input.loanPeriodDays <= 0) {
    return err(
      domainError(ErrorCode.InvalidInput, 'A loan period must be a positive whole number of days.', {
        loanPeriodDays: input.loanPeriodDays,
      }),
    );
  }

  return ok({
    id: input.id,
    copyId: input.copyId,
    memberId: input.memberId,
    checkedOutAt: input.at,
    dueAt: addDays(input.at, input.loanPeriodDays),
    returnedAt: null,
  });
};

export const isActive = (loan: Loan): boolean => loan.returnedAt === null;

export const isOverdue = (loan: Loan, now: Date): boolean =>
  isActive(loan) && isBefore(loan.dueAt, now);
