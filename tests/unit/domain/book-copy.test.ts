import { describe, expect, it } from 'vitest';
import { CopyStatus, isAvailable, markOnLoan, parseBookCopyId } from '@/domain/catalog/book-copy.js';
import { aBookCopy } from '@tests/support/builders.js';

describe('parseBookCopyId', () => {
  it('accepts a well-formed id', () => {
    expect(parseBookCopyId('copy-1').ok).toBe(true);
  });

  it('rejects a malformed id', () => {
    expect(parseBookCopyId('copy 1').ok).toBe(false);
  });
});

describe('isAvailable', () => {
  it('is true only for an available copy', () => {
    expect(isAvailable(aBookCopy({ status: CopyStatus.Available }))).toBe(true);
    expect(isAvailable(aBookCopy({ status: CopyStatus.OnLoan }))).toBe(false);
    expect(isAvailable(aBookCopy({ status: CopyStatus.Withdrawn }))).toBe(false);
  });
});

describe('markOnLoan', () => {
  it('moves an available copy to on-loan', () => {
    const result = markOnLoan(aBookCopy({ status: CopyStatus.Available }));

    expect(result.ok && result.value.status).toBe('on-loan');
  });

  it('returns a new object rather than mutating the original', () => {
    const original = aBookCopy({ status: CopyStatus.Available });

    markOnLoan(original);

    expect(original.status).toBe('available');
  });

  it('refuses a copy that is already on loan', () => {
    const result = markOnLoan(aBookCopy({ status: CopyStatus.OnLoan }));

    expect(!result.ok && result.error.code).toBe('COPY_NOT_AVAILABLE');
  });

  it('refuses a withdrawn copy, and says so specifically', () => {
    // A withdrawn copy is a different operational problem from a lent one:
    // one needs a librarian, the other needs patience.
    const result = markOnLoan(aBookCopy({ status: CopyStatus.Withdrawn }));

    expect(!result.ok && result.error.code).toBe('COPY_WITHDRAWN');
  });
});
