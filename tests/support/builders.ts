import type { BookCopy, BookCopyId } from '@/domain/catalog/book-copy.js';
import { CopyStatus as Status } from '@/domain/catalog/book-copy.js';
import type { BookId } from '@/domain/catalog/book.js';
import type { Loan, LoanId } from '@/domain/lending/loan.js';
import type { Member, MemberId } from '@/domain/lending/member.js';
import { MemberStanding as Standing } from '@/domain/lending/member.js';

/**
 * Test data builders.
 *
 * Every builder has a valid default, so a test only states the one thing it
 * cares about. `aMember({ standing: 'suspended' })` reads as the scenario it is
 * testing; a literal with six irrelevant fields does not.
 */

export const aMember = (overrides: Partial<Member> = {}): Member => ({
  id: 'member-1' as MemberId,
  name: 'Ada Lovelace',
  standing: Standing.Good,
  ...overrides,
});

export const aBookCopy = (overrides: Partial<BookCopy> = {}): BookCopy => ({
  id: 'copy-1' as BookCopyId,
  bookId: 'book-1' as BookId,
  status: Status.Available,
  ...overrides,
});

export const aLoan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'loan-1' as LoanId,
  copyId: 'copy-1' as BookCopyId,
  memberId: 'member-1' as MemberId,
  checkedOutAt: new Date('2026-01-01T09:00:00.000Z'),
  dueAt: new Date('2026-01-22T09:00:00.000Z'),
  returnedAt: null,
  ...overrides,
});
