import type { DomainError } from '../shared/errors.js';
import { ErrorCode, domainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import type { Loan } from './loan.js';
import { isActive, isOverdue } from './loan.js';
import type { Member } from './member.js';
import { requireGoodStanding } from './member.js';

/**
 * The knobs a librarian would argue about, in one place. Because the policy is
 * data rather than scattered literals, a branch library can run different rules
 * without a code change — and tests can construct absurd policies cheaply.
 */
export interface LendingPolicy {
  readonly maxActiveLoans: number;
  readonly loanPeriodDays: number;
}

export const defaultLendingPolicy: LendingPolicy = {
  maxActiveLoans: 5,
  loanPeriodDays: 21,
};

export interface BorrowingRequest {
  readonly member: Member;
  readonly activeLoans: readonly Loan[];
  readonly now: Date;
  readonly policy: LendingPolicy;
}

/**
 * The complete answer to "may this member take another book out?".
 *
 * Order matters and is deliberate: the most explanatory reason wins, so a
 * suspended member is told they are suspended rather than being told they have
 * too many books out.
 */
export const checkBorrowingAllowance = (request: BorrowingRequest): Result<void, DomainError> => {
  const standing = requireGoodStanding(request.member);
  if (!standing.ok) return standing;

  // Filter once, up front. The caller is expected to pass only open loans, but
  // relying on that made the two checks below disagree about what "active"
  // means — `isOverdue` filters internally, the limit check did not. Deriving
  // both from the same list removes the trap rather than documenting it.
  const active = request.activeLoans.filter(isActive);

  const overdue = active.filter((loan) => isOverdue(loan, request.now));
  if (overdue.length > 0) {
    return err(
      domainError(
        ErrorCode.MemberHasOverdueLoans,
        'Return the overdue items before borrowing anything else.',
        { memberId: request.member.id, overdueCount: overdue.length },
      ),
    );
  }

  if (active.length >= request.policy.maxActiveLoans) {
    return err(
      domainError(
        ErrorCode.LoanLimitReached,
        `A member may hold at most ${String(request.policy.maxActiveLoans)} items at a time.`,
        {
          memberId: request.member.id,
          activeLoans: active.length,
          maxActiveLoans: request.policy.maxActiveLoans,
        },
      ),
    );
  }

  return ok(undefined);
};
