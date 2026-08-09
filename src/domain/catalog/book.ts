import type { DomainError } from '../shared/errors.js';
import { ErrorCode, domainError } from '../shared/errors.js';
import type { Brand } from '../shared/identifier.js';
import { parseIdentifier } from '../shared/identifier.js';
import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';

export type BookId = Brand<string, 'BookId'>;

export const parseBookId = (raw: string): Result<BookId, DomainError> =>
  parseIdentifier('BookId', raw);

export type Isbn13 = Brand<string, 'Isbn13'>;

export interface Book {
  readonly id: BookId;
  readonly isbn: Isbn13;
  readonly title: string;
  readonly author: string;
}

/**
 * ISBN-13 with its checksum verified. Real catalogues receive mistyped ISBNs
 * constantly; catching them at the boundary of the domain is cheaper than
 * reconciling duplicate book records later.
 */
export const parseIsbn13 = (raw: string): Result<Isbn13, DomainError> => {
  const digits = raw.replace(/[\s-]/g, '');

  if (!/^\d{13}$/.test(digits)) {
    return err(
      domainError(ErrorCode.InvalidInput, 'An ISBN-13 must contain exactly 13 digits.', {
        received: raw,
      }),
    );
  }

  if (!hasValidIsbn13Checksum(digits)) {
    return err(
      domainError(ErrorCode.InvalidInput, 'ISBN-13 checksum digit does not match.', {
        received: raw,
      }),
    );
  }

  return ok(digits as Isbn13);
};

const hasValidIsbn13Checksum = (digits: string): boolean => {
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    const digit = Number(digits[index]);
    sum += index % 2 === 0 ? digit : digit * 3;
  }
  return sum % 10 === 0;
};

export const createBook = (input: {
  id: string;
  isbn: string;
  title: string;
  author: string;
}): Result<Book, DomainError> => {
  const id = parseBookId(input.id);
  if (!id.ok) return id;

  const isbn = parseIsbn13(input.isbn);
  if (!isbn.ok) return isbn;

  const title = input.title.trim();
  if (title.length === 0) {
    return err(domainError(ErrorCode.InvalidInput, 'A book must have a title.'));
  }

  const author = input.author.trim();
  if (author.length === 0) {
    return err(domainError(ErrorCode.InvalidInput, 'A book must have an author.'));
  }

  return ok({ id: id.value, isbn: isbn.value, title, author });
};
