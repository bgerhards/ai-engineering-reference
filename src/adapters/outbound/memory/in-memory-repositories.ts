import type {
  BookCopyRepository,
  LoanRepository,
  MemberRepository,
} from '../../../application/ports/repositories.js';
import type { BookCopy, BookCopyId } from '../../../domain/catalog/book-copy.js';
import type { Loan } from '../../../domain/lending/loan.js';
import { isActive } from '../../../domain/lending/loan.js';
import type { Member, MemberId } from '../../../domain/lending/member.js';

/**
 * In-memory adapters. They are production-shaped, not test doubles: they satisfy
 * the same contract suite in `tests/contract` that any database adapter must,
 * which is what makes swapping in SPEC-008's SQLite adapter a non-event.
 */

export class InMemoryMemberRepository implements MemberRepository {
  private readonly members = new Map<string, Member>();

  add(member: Member): void {
    this.members.set(member.id, member);
  }

  findById(id: MemberId): Promise<Member | null> {
    return Promise.resolve(this.members.get(id) ?? null);
  }
}

export class InMemoryBookCopyRepository implements BookCopyRepository {
  private readonly copies = new Map<string, BookCopy>();

  add(copy: BookCopy): void {
    this.copies.set(copy.id, copy);
  }

  findById(id: BookCopyId): Promise<BookCopy | null> {
    return Promise.resolve(this.copies.get(id) ?? null);
  }

  save(copy: BookCopy): Promise<void> {
    this.copies.set(copy.id, copy);
    return Promise.resolve();
  }
}

export class InMemoryLoanRepository implements LoanRepository {
  private readonly loans = new Map<string, Loan>();

  save(loan: Loan): Promise<void> {
    this.loans.set(loan.id, loan);
    return Promise.resolve();
  }

  findActiveByMember(memberId: MemberId): Promise<readonly Loan[]> {
    const matches = [...this.loans.values()].filter(
      (loan) => loan.memberId === memberId && isActive(loan),
    );
    return Promise.resolve(matches);
  }

  findActiveByCopy(copyId: BookCopyId): Promise<Loan | null> {
    const match = [...this.loans.values()].find(
      (loan) => loan.copyId === copyId && isActive(loan),
    );
    return Promise.resolve(match ?? null);
  }
}
