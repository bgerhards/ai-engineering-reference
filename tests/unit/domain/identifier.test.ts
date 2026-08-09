import { describe, expect, it } from 'vitest';
import { parseIdentifier } from '@/domain/shared/identifier.js';

describe('parseIdentifier', () => {
  it('accepts letters, digits, hyphens and underscores', () => {
    const result = parseIdentifier('MemberId', 'member_42-A');

    expect(result.ok && result.value).toBe('member_42-A');
  });

  it('trims surrounding whitespace', () => {
    const result = parseIdentifier('MemberId', '  member-1  ');

    expect(result.ok && result.value).toBe('member-1');
  });

  it('rejects an empty identifier', () => {
    const result = parseIdentifier('MemberId', '   ');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    expect(!result.ok && result.error.message).toContain('must not be empty');
  });

  it.each([
    ['a space', 'member 1'],
    ['a slash', 'member/1'],
    ['a leading hyphen', '-member'],
    ['a unicode character', 'membér'],
  ])('rejects an identifier containing %s', (_label, raw) => {
    expect(parseIdentifier('MemberId', raw).ok).toBe(false);
  });

  it('accepts an identifier of exactly 64 characters', () => {
    expect(parseIdentifier('MemberId', 'a'.repeat(64)).ok).toBe(true);
  });

  it('rejects an identifier of 65 characters', () => {
    expect(parseIdentifier('MemberId', 'a'.repeat(65)).ok).toBe(false);
  });

  it('names the offending brand in the error', () => {
    const result = parseIdentifier('BookCopyId', '');

    expect(!result.ok && result.error.details).toMatchObject({ brand: 'BookCopyId' });
  });
});
