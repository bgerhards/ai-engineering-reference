import { describe, expect, it } from 'vitest';
import { createBook, parseBookId, parseIsbn13 } from '@/domain/catalog/book.js';

const VALID_ISBN = '9780306406157';

describe('parseIsbn13', () => {
  it('accepts a checksum-valid ISBN-13', () => {
    const result = parseIsbn13(VALID_ISBN);

    expect(result.ok && result.value).toBe(VALID_ISBN);
  });

  it('normalises hyphenated and spaced input', () => {
    const result = parseIsbn13('978-0-306 40615-7');

    expect(result.ok && result.value).toBe(VALID_ISBN);
  });

  it('rejects a value that is not thirteen digits', () => {
    const result = parseIsbn13('0306406152');

    expect(!result.ok && result.error.message).toContain('exactly 13 digits');
  });

  it('rejects thirteen non-digit characters', () => {
    expect(parseIsbn13('abcdefghijklm').ok).toBe(false);
  });

  it('rejects a mistyped final digit', () => {
    const result = parseIsbn13('9780306406158');

    expect(!result.ok && result.error.message).toContain('checksum');
  });
});

describe('parseBookId', () => {
  it('accepts a well-formed id', () => {
    expect(parseBookId('book-1').ok).toBe(true);
  });

  it('rejects a malformed id', () => {
    expect(parseBookId('').ok).toBe(false);
  });
});

describe('createBook', () => {
  const validInput = {
    id: 'book-1',
    isbn: VALID_ISBN,
    title: '  Structure and Interpretation of Computer Programs  ',
    author: '  Abelson  ',
  };

  it('builds a book and trims its text fields', () => {
    const result = createBook(validInput);

    expect(result.ok && result.value).toEqual({
      id: 'book-1',
      isbn: VALID_ISBN,
      title: 'Structure and Interpretation of Computer Programs',
      author: 'Abelson',
    });
  });

  it('rejects an invalid id', () => {
    expect(createBook({ ...validInput, id: 'book 1' }).ok).toBe(false);
  });

  it('rejects an invalid isbn', () => {
    expect(createBook({ ...validInput, isbn: '123' }).ok).toBe(false);
  });

  it('rejects a whitespace-only title', () => {
    const result = createBook({ ...validInput, title: '   ' });

    expect(!result.ok && result.error.message).toContain('title');
  });

  it('rejects a whitespace-only author', () => {
    const result = createBook({ ...validInput, author: '   ' });

    expect(!result.ok && result.error.message).toContain('author');
  });
});
