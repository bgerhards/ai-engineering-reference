import { describe, expect, it } from 'vitest';
import type { BookCopyId } from '@/domain/catalog/book-copy.js';
import type { LoanId } from '@/domain/lending/loan.js';
import { isActive, isOverdue, openLoan, parseLoanId } from '@/domain/lending/loan.js';
import type { MemberId } from '@/domain/lending/member.js';
import { aLoan } from '@tests/support/builders.js';

const checkedOutAt = new Date('2026-01-01T09:00:00.000Z');

const openLoanInput = (loanPeriodDays: number): Parameters<typeof openLoan>[0] => ({
  id: 'loan-1' as LoanId,
  copyId: 'copy-1' as BookCopyId,
  memberId: 'member-1' as MemberId,
  at: checkedOutAt,
  loanPeriodDays,
});

describe('parseLoanId', () => {
  it('accepts a well-formed id', () => {
    const result = parseLoanId('loan-7');

    expect(result.ok && result.value).toBe('loan-7');
  });

  it('rejects a malformed id', () => {
    const result = parseLoanId('loan 7');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
  });

  it('names LoanId as the offending brand', () => {
    const result = parseLoanId('');

    expect(!result.ok && result.error.details).toMatchObject({ brand: 'LoanId' });
  });
});

describe('openLoan', () => {
  it('records the identifiers and checkout instant it was given', () => {
    const result = openLoan(openLoanInput(21));

    expect(result.ok && result.value).toMatchObject({
      id: 'loan-1',
      copyId: 'copy-1',
      memberId: 'member-1',
    });
    expect(result.ok && result.value.checkedOutAt).toBe(checkedOutAt);
  });

  it('falls due exactly one loan period after checkout', () => {
    const result = openLoan(openLoanInput(21));

    expect(result.ok && result.value.dueAt.toISOString()).toBe('2026-01-22T09:00:00.000Z');
  });

  it('starts with no return recorded', () => {
    const result = openLoan(openLoanInput(21));

    expect(result.ok && result.value.returnedAt).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
  ])('refuses a %s loan period', (_label, loanPeriodDays) => {
    const result = openLoan(openLoanInput(loanPeriodDays));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    expect(!result.ok && result.error.details).toMatchObject({ loanPeriodDays });
  });

  it('accepts the shortest sensible loan period of one day', () => {
    const result = openLoan(openLoanInput(1));

    expect(result.ok && result.value.dueAt.toISOString()).toBe('2026-01-02T09:00:00.000Z');
  });
});

describe('isActive', () => {
  it('is true while the copy is still out', () => {
    expect(isActive(aLoan({ returnedAt: null }))).toBe(true);
  });

  it('is false once the copy has come back', () => {
    expect(isActive(aLoan({ returnedAt: new Date('2026-01-10T09:00:00.000Z') }))).toBe(false);
  });
});

describe('isOverdue', () => {
  const dueAt = new Date('2026-01-22T09:00:00.000Z');

  it('is false before the due date', () => {
    const loan = aLoan({ dueAt });

    expect(isOverdue(loan, new Date('2026-01-21T09:00:00.000Z'))).toBe(false);
  });

  it('is false at the exact moment the loan falls due', () => {
    // The boundary is inclusive in the member's favour: a book handed back at
    // 09:00:00.000 on the due date is on time, not a day late.
    const loan = aLoan({ dueAt });

    expect(isOverdue(loan, new Date(dueAt.getTime()))).toBe(false);
  });

  it('is true one millisecond after the loan falls due', () => {
    const loan = aLoan({ dueAt });

    expect(isOverdue(loan, new Date(dueAt.getTime() + 1))).toBe(true);
  });

  it('is false for a returned loan even long past its due date', () => {
    const loan = aLoan({ dueAt, returnedAt: new Date('2026-01-10T09:00:00.000Z') });

    expect(isOverdue(loan, new Date('2027-01-01T09:00:00.000Z'))).toBe(false);
  });
});
