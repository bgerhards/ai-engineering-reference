import { markOnLoan } from '../../domain/catalog/book-copy.js';
import { parseBookCopyId } from '../../domain/catalog/book-copy.js';
import type { LendingPolicy } from '../../domain/lending/lending-policy.js';
import { checkBorrowingAllowance } from '../../domain/lending/lending-policy.js';
import { openLoan } from '../../domain/lending/loan.js';
import { parseMemberId } from '../../domain/lending/member.js';
import type { Clock } from '../../domain/shared/clock.js';
import type { DomainError } from '../../domain/shared/errors.js';
import { ErrorCode, domainError } from '../../domain/shared/errors.js';
import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type {
  BookCopyRepository,
  LoanRepository,
  MemberRepository,
} from '../ports/repositories.js';

export interface CheckoutCopyCommand {
  readonly memberId: string;
  readonly copyId: string;
}

/**
 * The use case returns a plain, serialisable view — never a domain entity.
 * Entities stay inside; the outside world gets a stable contract it can render.
 */
export interface CheckoutCopyResult {
  readonly loanId: string;
  readonly memberId: string;
  readonly copyId: string;
  readonly checkedOutAt: string;
  readonly dueAt: string;
}

export interface CheckoutCopyDependencies {
  readonly members: MemberRepository;
  readonly copies: BookCopyRepository;
  readonly loans: LoanRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly policy: LendingPolicy;
}

export type CheckoutCopy = (
  command: CheckoutCopyCommand,
) => Promise<Result<CheckoutCopyResult, DomainError>>;

/**
 * Check a physical copy out to a member.
 *
 * The use case orchestrates; it does not decide. Every "may this happen?"
 * question is delegated to the domain (`checkBorrowingAllowance`, `markOnLoan`),
 * which is why this function reads as a sequence of guards and stays testable
 * with nothing but in-memory fakes.
 */
export const makeCheckoutCopy = (deps: CheckoutCopyDependencies): CheckoutCopy => {
  return async (command) => {
    const memberId = parseMemberId(command.memberId);
    if (!memberId.ok) return memberId;

    const copyId = parseBookCopyId(command.copyId);
    if (!copyId.ok) return copyId;

    const member = await deps.members.findById(memberId.value);
    if (member === null) {
      return err(
        domainError(ErrorCode.MemberNotFound, 'No such member.', { memberId: command.memberId }),
      );
    }

    const copy = await deps.copies.findById(copyId.value);
    if (copy === null) {
      return err(
        domainError(ErrorCode.CopyNotFound, 'No such copy.', { copyId: command.copyId }),
      );
    }

    const now = deps.clock.now();
    const activeLoans = await deps.loans.findActiveByMember(memberId.value);

    const allowance = checkBorrowingAllowance({
      member,
      activeLoans,
      now,
      policy: deps.policy,
    });
    if (!allowance.ok) return allowance;

    const lentCopy = markOnLoan(copy);
    if (!lentCopy.ok) return lentCopy;

    const loan = openLoan({
      id: deps.ids.nextLoanId(),
      copyId: copyId.value,
      memberId: memberId.value,
      at: now,
      loanPeriodDays: deps.policy.loanPeriodDays,
    });
    if (!loan.ok) return loan;

    // Copy first: if persistence fails midway, a copy marked on-loan with no
    // loan record is recoverable by an audit job, whereas a loan pointing at an
    // available copy would let the same book be lent twice.
    await deps.copies.save(lentCopy.value);
    await deps.loans.save(loan.value);

    return ok({
      loanId: loan.value.id,
      memberId: loan.value.memberId,
      copyId: loan.value.copyId,
      checkedOutAt: loan.value.checkedOutAt.toISOString(),
      dueAt: loan.value.dueAt.toISOString(),
    });
  };
};
