import type { DomainError } from './errors.js';
import { ErrorCode, domainError } from './errors.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';

/**
 * Branded primitives. A `MemberId` and a `BookCopyId` are both strings at
 * runtime, but the compiler refuses to let you swap them — which is exactly the
 * bug that argument-order mistakes produce in an unbranded codebase.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The single place identifiers are validated. Every aggregate wraps this rather
 * than re-implementing the rule, so identifier semantics can never drift.
 */
export const parseIdentifier = <B extends string>(
  brand: B,
  raw: string,
): Result<Brand<string, B>, DomainError> => {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return err(domainError(ErrorCode.InvalidInput, `${brand} must not be empty.`, { brand }));
  }

  if (!IDENTIFIER_PATTERN.test(trimmed)) {
    return err(
      domainError(
        ErrorCode.InvalidInput,
        `${brand} must be 1-64 characters of letters, digits, hyphens or underscores.`,
        { brand, received: raw },
      ),
    );
  }

  return ok(trimmed as Brand<string, B>);
};
