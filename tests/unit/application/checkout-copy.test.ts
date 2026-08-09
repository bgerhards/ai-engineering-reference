import { describe, expect, it } from 'vitest';
import {
  InMemoryBookCopyRepository,
  InMemoryLoanRepository,
  InMemoryMemberRepository,
} from '@/adapters/outbound/memory/in-memory-repositories.js';
import type { CheckoutCopy } from '@/application/use-cases/checkout-copy.js';
import { makeCheckoutCopy } from '@/application/use-cases/checkout-copy.js';
import type { BookCopyId, CopyStatus } from '@/domain/catalog/book-copy.js';
import { CopyStatus as Status } from '@/domain/catalog/book-copy.js';
import type { LendingPolicy } from '@/domain/lending/lending-policy.js';
import { defaultLendingPolicy } from '@/domain/lending/lending-policy.js';
import type { LoanId } from '@/domain/lending/loan.js';
import type { MemberId } from '@/domain/lending/member.js';
import { MemberStanding } from '@/domain/lending/member.js';
import { aBookCopy, aLoan, aMember } from '@tests/support/builders.js';
import { FixedClock, SequentialIdGenerator } from '@tests/support/fakes.js';

const MEMBER_ID = 'member-1' as MemberId;
const COPY_ID = 'copy-1' as BookCopyId;
const NOW = new Date('2026-03-01T10:00:00.000Z');
const DUE_21_DAYS_LATER = '2026-03-22T10:00:00.000Z';

interface Harness {
  readonly checkoutCopy: CheckoutCopy;
  readonly members: InMemoryMemberRepository;
  readonly copies: InMemoryBookCopyRepository;
  readonly loans: InMemoryLoanRepository;
  readonly clock: FixedClock;
}

/**
 * A member in good standing and one available copy, wired to the real in-memory
 * adapters. Each test then states only the thing that makes it different.
 */
const setup = (policy: LendingPolicy = defaultLendingPolicy): Harness => {
  const members = new InMemoryMemberRepository();
  const copies = new InMemoryBookCopyRepository();
  const loans = new InMemoryLoanRepository();
  const clock = new FixedClock(NOW);

  members.add(aMember({ id: MEMBER_ID }));
  copies.add(aBookCopy({ id: COPY_ID, status: Status.Available }));

  const checkoutCopy = makeCheckoutCopy({
    members,
    copies,
    loans,
    ids: new SequentialIdGenerator(),
    clock,
    policy,
  });

  return { checkoutCopy, members, copies, loans, clock };
};

/**
 * A refused checkout must leave nothing behind: no loan against the copy, and
 * the copy's status exactly as it was. Half-applied writes are the expensive
 * failure mode here, so every failure test asserts on both.
 */
const expectNoDebris = async (
  harness: Harness,
  expected: { readonly copyStatus: CopyStatus | null; readonly activeLoans: number },
): Promise<void> => {
  const copy = await harness.copies.findById(COPY_ID);
  const loanForCopy = await harness.loans.findActiveByCopy(COPY_ID);
  const memberLoans = await harness.loans.findActiveByMember(MEMBER_ID);

  expect(copy?.status ?? null).toBe(expected.copyStatus);
  expect(loanForCopy).toBeNull();
  expect(memberLoans).toHaveLength(expected.activeLoans);
};

describe('checkoutCopy', () => {
  it('returns the new loan, dated by the injected clock', async () => {
    const harness = setup();

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(result.ok && result.value).toEqual({
      loanId: 'loan-1',
      memberId: 'member-1',
      copyId: 'copy-1',
      checkedOutAt: '2026-03-01T10:00:00.000Z',
      dueAt: DUE_21_DAYS_LATER,
    });
  });

  it('puts the copy on loan in the repository, not merely in the response', async () => {
    const harness = setup();

    await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    const copy = await harness.copies.findById(COPY_ID);
    expect(copy?.status).toBe('on-loan');
  });

  it('records the loan so it is findable among the active loans for that member', async () => {
    const harness = setup();

    await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    const loans = await harness.loans.findActiveByMember(MEMBER_ID);
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({
      id: 'loan-1',
      copyId: 'copy-1',
      memberId: 'member-1',
      returnedAt: null,
    });
  });

  it('records the loan against the copy so the copy cannot be lent twice', async () => {
    const harness = setup();

    await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    const loan = await harness.loans.findActiveByCopy(COPY_ID);
    expect(loan?.dueAt.toISOString()).toBe(DUE_21_DAYS_LATER);
  });

  it('does not count a returned loan against the loan limit', async () => {
    const harness = setup();
    for (let index = 0; index < 5; index += 1) {
      await harness.loans.save(
        aLoan({
          id: `old-${String(index)}` as LoanId,
          copyId: `copy-old-${String(index)}` as BookCopyId,
          memberId: MEMBER_ID,
          returnedAt: new Date('2026-02-01T10:00:00.000Z'),
        }),
      );
    }

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(result.ok).toBe(true);
  });

  it('refuses a malformed member id', async () => {
    const harness = setup();

    const result = await harness.checkoutCopy({ memberId: 'member 1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 0 });
  });

  it('refuses a malformed copy id', async () => {
    const harness = setup();

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: '' });

    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 0 });
  });

  it('refuses a member the library has never heard of', async () => {
    const harness = setup();

    const result = await harness.checkoutCopy({ memberId: 'member-999', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('MEMBER_NOT_FOUND');
    expect(!result.ok && result.error.details).toMatchObject({ memberId: 'member-999' });
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 0 });
  });

  it('refuses a copy that is not in the catalogue', async () => {
    const harness = setup();

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-999' });

    expect(!result.ok && result.error.code).toBe('COPY_NOT_FOUND');
    expect(!result.ok && result.error.details).toMatchObject({ copyId: 'copy-999' });
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 0 });
  });

  it('refuses a copy that is already out with someone else', async () => {
    const harness = setup();
    harness.copies.add(aBookCopy({ id: COPY_ID, status: Status.OnLoan }));

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('COPY_NOT_AVAILABLE');
    await expectNoDebris(harness, { copyStatus: 'on-loan', activeLoans: 0 });
  });

  it('refuses a withdrawn copy', async () => {
    const harness = setup();
    harness.copies.add(aBookCopy({ id: COPY_ID, status: Status.Withdrawn }));

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('COPY_WITHDRAWN');
    await expectNoDebris(harness, { copyStatus: 'withdrawn', activeLoans: 0 });
  });

  it('refuses a suspended member', async () => {
    const harness = setup();
    harness.members.add(aMember({ id: MEMBER_ID, standing: MemberStanding.Suspended }));

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('MEMBER_SUSPENDED');
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 0 });
  });

  it('refuses a member who is already at the loan limit', async () => {
    const harness = setup();
    for (let index = 0; index < defaultLendingPolicy.maxActiveLoans; index += 1) {
      await harness.loans.save(
        aLoan({
          id: `held-${String(index)}` as LoanId,
          copyId: `copy-held-${String(index)}` as BookCopyId,
          memberId: MEMBER_ID,
          dueAt: new Date('2026-03-20T10:00:00.000Z'),
        }),
      );
    }

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('LOAN_LIMIT_REACHED');
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 5 });
  });

  it('refuses a member who is holding something overdue', async () => {
    const harness = setup();
    await harness.loans.save(
      aLoan({
        id: 'late-1' as LoanId,
        copyId: 'copy-late' as BookCopyId,
        memberId: MEMBER_ID,
        dueAt: new Date('2026-02-20T10:00:00.000Z'),
      }),
    );

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('MEMBER_HAS_OVERDUE_LOANS');
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 1 });
  });

  it('refuses to open a loan under a policy with a nonsensical loan period', async () => {
    const harness = setup({ maxActiveLoans: 5, loanPeriodDays: 0 });

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    await expectNoDebris(harness, { copyStatus: 'available', activeLoans: 0 });
  });

  it('honours a loan period supplied by the policy rather than a fixed three weeks', async () => {
    const harness = setup({ maxActiveLoans: 5, loanPeriodDays: 7 });

    const result = await harness.checkoutCopy({ memberId: 'member-1', copyId: 'copy-1' });

    expect(result.ok && result.value.dueAt).toBe('2026-03-08T10:00:00.000Z');
  });
});
