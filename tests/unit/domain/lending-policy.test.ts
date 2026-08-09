import { describe, expect, it } from 'vitest';
import type { LendingPolicy } from '@/domain/lending/lending-policy.js';
import { checkBorrowingAllowance, defaultLendingPolicy } from '@/domain/lending/lending-policy.js';
import type { Loan, LoanId } from '@/domain/lending/loan.js';
import { MemberStanding } from '@/domain/lending/member.js';
import { aLoan, aMember } from '@tests/support/builders.js';

const now = new Date('2026-01-10T09:00:00.000Z');
const notYetDue = new Date('2026-01-22T09:00:00.000Z');
const alreadyDue = new Date('2026-01-05T09:00:00.000Z');

const activeLoans = (count: number, overrides: Partial<Loan> = {}): readonly Loan[] =>
  Array.from({ length: count }, (_unused, index) =>
    aLoan({ id: `loan-${String(index + 1)}` as LoanId, dueAt: notYetDue, ...overrides }),
  );

describe('checkBorrowingAllowance', () => {
  it('allows a member in good standing who is below the loan limit', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: activeLoans(2),
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(true);
  });

  it('allows a member with no loans at all', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: [],
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a suspended member', () => {
    const result = checkBorrowingAllowance({
      member: aMember({ standing: MemberStanding.Suspended }),
      activeLoans: [],
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('MEMBER_SUSPENDED');
  });

  it('tells a suspended member with overdue books that they are suspended', () => {
    // Precedence is deliberate, not incidental: when several reasons apply the
    // most explanatory one wins. Suspension is the fact the member has to act on
    // first, so it must outrank both the overdue check and the loan limit.
    const result = checkBorrowingAllowance({
      member: aMember({ standing: MemberStanding.Suspended }),
      activeLoans: activeLoans(5, { dueAt: alreadyDue }),
      now,
      policy: defaultLendingPolicy,
    });

    expect(!result.ok && result.error.code).toBe('MEMBER_SUSPENDED');
  });

  it('refuses a member holding a book that is past its due date', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: [aLoan({ dueAt: alreadyDue })],
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('MEMBER_HAS_OVERDUE_LOANS');
  });

  it('reports how many books are overdue', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: [
        aLoan({ id: 'loan-1' as LoanId, dueAt: alreadyDue }),
        aLoan({ id: 'loan-2' as LoanId, dueAt: alreadyDue }),
        aLoan({ id: 'loan-3' as LoanId, dueAt: notYetDue }),
      ],
      now,
      policy: defaultLendingPolicy,
    });

    expect(!result.ok && result.error.details).toMatchObject({ overdueCount: 2 });
  });

  it('reports the overdue reason ahead of the loan limit', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: activeLoans(5, { dueAt: alreadyDue }),
      now,
      policy: defaultLendingPolicy,
    });

    expect(!result.ok && result.error.code).toBe('MEMBER_HAS_OVERDUE_LOANS');
  });

  it('allows a member holding one fewer book than the limit', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: activeLoans(defaultLendingPolicy.maxActiveLoans - 1),
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a member holding exactly the maximum number of books', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: activeLoans(defaultLendingPolicy.maxActiveLoans),
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('LOAN_LIMIT_REACHED');
  });

  it('does not count a returned loan toward the active limit', () => {
    // The neighbouring overdue check filters returned loans (isOverdue calls
    // isActive). This one must agree, or the same list yields two different
    // notions of "active" three lines apart.
    const loans = [
      aLoan({ id: 'loan-returned' as LoanId, returnedAt: new Date('2026-01-05T00:00:00.000Z') }),
      ...activeLoans(defaultLendingPolicy.maxActiveLoans - 1),
    ];

    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: loans,
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(true);
  });

  it('reports the count and the limit that produced the refusal', () => {
    const member = aMember();

    const result = checkBorrowingAllowance({
      member,
      activeLoans: activeLoans(5),
      now,
      policy: defaultLendingPolicy,
    });

    expect(!result.ok && result.error.details).toMatchObject({
      memberId: member.id,
      activeLoans: 5,
      maxActiveLoans: 5,
    });
  });

  it('enforces whatever limit the supplied policy names, not a hard-coded five', () => {
    // The policy is data. A branch library that lends one book at a time gets
    // the same code path, and this test fails if a literal creeps back in.
    const strictPolicy: LendingPolicy = { maxActiveLoans: 1, loanPeriodDays: 7 };

    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: activeLoans(1),
      now,
      policy: strictPolicy,
    });

    expect(!result.ok && result.error.code).toBe('LOAN_LIMIT_REACHED');
    expect(!result.ok && result.error.message).toContain('at most 1');
  });

  it('allows a borrower under a strict one-book policy who holds nothing', () => {
    const strictPolicy: LendingPolicy = { maxActiveLoans: 1, loanPeriodDays: 7 };

    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: [],
      now,
      policy: strictPolicy,
    });

    expect(result.ok).toBe(true);
  });

  it('does not treat a returned book as overdue, however late it came back', () => {
    const result = checkBorrowingAllowance({
      member: aMember(),
      activeLoans: [aLoan({ dueAt: alreadyDue, returnedAt: new Date('2026-01-09T09:00:00.000Z') })],
      now,
      policy: defaultLendingPolicy,
    });

    expect(result.ok).toBe(true);
  });
});

describe('defaultLendingPolicy', () => {
  it('lends five books for three weeks', () => {
    expect(defaultLendingPolicy).toEqual({ maxActiveLoans: 5, loanPeriodDays: 21 });
  });
});
