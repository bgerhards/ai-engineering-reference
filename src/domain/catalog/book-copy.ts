import type { DomainError } from '../shared/errors.js';
import { ErrorCode, domainError } from '../shared/errors.js';
import type { Brand } from '../shared/identifier.js';
import { parseIdentifier } from '../shared/identifier.js';
import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import type { BookId } from './book.js';

export type BookCopyId = Brand<string, 'BookCopyId'>;

export const parseBookCopyId = (raw: string): Result<BookCopyId, DomainError> =>
  parseIdentifier('BookCopyId', raw);

export const CopyStatus = {
  Available: 'available',
  OnLoan: 'on-loan',
  Withdrawn: 'withdrawn',
} as const;

export type CopyStatus = (typeof CopyStatus)[keyof typeof CopyStatus];

/**
 * A physical copy on a shelf. The catalogue owns *what* a book is; a copy owns
 * *whether it can leave the building*.
 */
export interface BookCopy {
  readonly id: BookCopyId;
  readonly bookId: BookId;
  readonly status: CopyStatus;
}

/**
 * State transitions live with the entity, not in the use case. A use case that
 * flipped `status` by hand could put a withdrawn copy back into circulation;
 * routing every change through here makes that unrepresentable.
 */
export const markOnLoan = (copy: BookCopy): Result<BookCopy, DomainError> => {
  if (copy.status === CopyStatus.Withdrawn) {
    return err(
      domainError(ErrorCode.CopyWithdrawn, 'This copy has been withdrawn and cannot be lent.', {
        copyId: copy.id,
      }),
    );
  }

  if (copy.status === CopyStatus.OnLoan) {
    return err(
      domainError(ErrorCode.CopyNotAvailable, 'This copy is already on loan.', {
        copyId: copy.id,
      }),
    );
  }

  return ok({ ...copy, status: CopyStatus.OnLoan });
};

export const isAvailable = (copy: BookCopy): boolean => copy.status === CopyStatus.Available;
