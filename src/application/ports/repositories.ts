import type { BookCopy, BookCopyId } from '../../domain/catalog/book-copy.js';
import type { Loan } from '../../domain/lending/loan.js';
import type { Member, MemberId } from '../../domain/lending/member.js';

/**
 * Ports: the vocabulary the application uses to talk to the outside world.
 *
 * They are owned by the application layer, not by the database. That inversion
 * is what lets `tests/contract` prove that every adapter — in-memory today,
 * SQLite tomorrow — behaves identically.
 */

export interface MemberRepository {
  findById(id: MemberId): Promise<Member | null>;
}

export interface BookCopyRepository {
  findById(id: BookCopyId): Promise<BookCopy | null>;
  save(copy: BookCopy): Promise<void>;
}

export interface LoanRepository {
  save(loan: Loan): Promise<void>;
  findActiveByMember(memberId: MemberId): Promise<readonly Loan[]>;
  /**
   * No production caller yet — checkout prevents double-lending via copy status,
   * not a loan lookup. SPEC-002 (return a copy) is the caller: returning needs
   * the open loan for a copy. Kept because the contract suite already pins its
   * behaviour, so the SQLite adapter in SPEC-008 inherits it for free.
   */
  findActiveByCopy(copyId: BookCopyId): Promise<Loan | null>;
}
