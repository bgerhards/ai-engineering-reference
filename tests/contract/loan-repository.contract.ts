import { describe, expect, it } from 'vitest';
import type { LoanRepository } from '@/application/ports/repositories.js';
import type { BookCopyId } from '@/domain/catalog/book-copy.js';
import type { LoanId } from '@/domain/lending/loan.js';
import type { MemberId } from '@/domain/lending/member.js';
import { aLoan } from '@tests/support/builders.js';

/**
 * The behavioural promise of the `LoanRepository` port, written once and run
 * against every adapter that claims to implement it.
 *
 * Nothing here knows how the loans are stored. If a new adapter passes this
 * suite it is substitutable; if it does not, it is not — regardless of how
 * plausible its own unit tests look.
 */
export const describeLoanRepositoryContract = (
  name: string,
  createRepository: () => Promise<LoanRepository> | LoanRepository,
): void => {
  describe(`${name} (LoanRepository contract)`, () => {
    const MEMBER = 'member-1' as MemberId;
    const OTHER_MEMBER = 'member-2' as MemberId;
    const COPY = 'copy-1' as BookCopyId;
    const OTHER_COPY = 'copy-2' as BookCopyId;
    const RETURNED_AT = new Date('2026-01-15T09:00:00.000Z');

    it('reads back a loan it has saved', async () => {
      const repository = await createRepository();
      const loan = aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY });

      await repository.save(loan);

      expect(await repository.findActiveByCopy(COPY)).toEqual(loan);
    });

    it('preserves the instants on a saved loan rather than truncating them', async () => {
      const repository = await createRepository();
      const loan = aLoan({
        id: 'loan-1' as LoanId,
        memberId: MEMBER,
        copyId: COPY,
        checkedOutAt: new Date('2026-01-01T09:07:31.123Z'),
        dueAt: new Date('2026-01-22T09:07:31.123Z'),
      });

      await repository.save(loan);

      const found = await repository.findActiveByCopy(COPY);
      expect(found?.checkedOutAt.toISOString()).toBe('2026-01-01T09:07:31.123Z');
      expect(found?.dueAt.toISOString()).toBe('2026-01-22T09:07:31.123Z');
    });

    it('treats save as an upsert, so saving the same loan twice stores one loan', async () => {
      const repository = await createRepository();
      const loan = aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY });

      await repository.save(loan);
      await repository.save(loan);

      expect(await repository.findActiveByMember(MEMBER)).toHaveLength(1);
    });

    it('replaces the stored loan when one with the same id is saved again', async () => {
      const repository = await createRepository();
      const loan = aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY });

      await repository.save(loan);
      await repository.save({ ...loan, returnedAt: RETURNED_AT });

      expect(await repository.findActiveByMember(MEMBER)).toEqual([]);
    });

    it('returns the loans belonging to the member asked about and no others', async () => {
      const repository = await createRepository();
      await repository.save(aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY }));
      await repository.save(
        aLoan({ id: 'loan-2' as LoanId, memberId: OTHER_MEMBER, copyId: OTHER_COPY }),
      );

      const found = await repository.findActiveByMember(MEMBER);

      expect(found.map((loan) => loan.id)).toEqual(['loan-1']);
    });

    it('excludes a returned loan from the active loans of a member', async () => {
      const repository = await createRepository();
      await repository.save(aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY }));
      await repository.save(
        aLoan({
          id: 'loan-2' as LoanId,
          memberId: MEMBER,
          copyId: OTHER_COPY,
          returnedAt: RETURNED_AT,
        }),
      );

      const found = await repository.findActiveByMember(MEMBER);

      expect(found.map((loan) => loan.id)).toEqual(['loan-1']);
    });

    it('returns an empty list for a member with no loans', async () => {
      const repository = await createRepository();

      expect(await repository.findActiveByMember('member-unknown' as MemberId)).toEqual([]);
    });

    it('finds the active loan holding a copy', async () => {
      const repository = await createRepository();
      await repository.save(aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY }));

      const found = await repository.findActiveByCopy(COPY);

      expect(found?.id).toBe('loan-1');
    });

    it('returns null for a copy that has never been lent', async () => {
      const repository = await createRepository();
      await repository.save(aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY }));

      expect(await repository.findActiveByCopy(OTHER_COPY)).toBeNull();
    });

    it('returns null for a copy whose only loan has been returned', async () => {
      // Otherwise a returned copy could never be lent again — the single most
      // consequential thing this port has to get right.
      const repository = await createRepository();
      await repository.save(
        aLoan({ id: 'loan-1' as LoanId, memberId: MEMBER, copyId: COPY, returnedAt: RETURNED_AT }),
      );

      expect(await repository.findActiveByCopy(COPY)).toBeNull();
    });

    it('finds the current loan for a copy that has been lent before and returned', async () => {
      const repository = await createRepository();
      await repository.save(
        aLoan({
          id: 'loan-old' as LoanId,
          memberId: MEMBER,
          copyId: COPY,
          returnedAt: RETURNED_AT,
        }),
      );
      await repository.save(
        aLoan({ id: 'loan-new' as LoanId, memberId: OTHER_MEMBER, copyId: COPY }),
      );

      const found = await repository.findActiveByCopy(COPY);

      expect(found?.id).toBe('loan-new');
    });
  });
};
