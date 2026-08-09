import { describe, expect, it } from 'vitest';
import { ErrorCode, domainError } from '@/domain/shared/errors.js';

describe('domainError', () => {
  it('builds an error from a code and message', () => {
    expect(domainError(ErrorCode.InvalidInput, 'nope')).toEqual({
      code: 'INVALID_INPUT',
      message: 'nope',
    });
  });

  it('omits the details key entirely when no details are supplied', () => {
    // Not merely `details === undefined`: an absent key keeps JSON payloads and
    // structural equality assertions clean.
    expect(Object.hasOwn(domainError(ErrorCode.InvalidInput, 'nope'), 'details')).toBe(false);
  });

  it('attaches details when supplied', () => {
    expect(domainError(ErrorCode.CopyNotFound, 'gone', { copyId: 'copy-9' })).toEqual({
      code: 'COPY_NOT_FOUND',
      message: 'gone',
      details: { copyId: 'copy-9' },
    });
  });
});
