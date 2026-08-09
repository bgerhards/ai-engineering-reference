import { describe, expect, it } from 'vitest';
import { all, err, flatMap, isErr, isOk, map, ok } from '@/domain/shared/result.js';

describe('Result', () => {
  it('carries the value on success', () => {
    const result = ok(42);

    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result.ok && result.value).toBe(42);
  });

  it('carries the error on failure', () => {
    const result = err('boom');

    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    expect(!result.ok && result.error).toBe('boom');
  });

  describe('map', () => {
    it('transforms a success value', () => {
      expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    });

    it('leaves a failure untouched', () => {
      expect(map(err<string>('boom'), (n: number) => n * 3)).toEqual(err('boom'));
    });
  });

  describe('flatMap', () => {
    it('chains a second fallible step', () => {
      expect(flatMap(ok(2), (n) => ok(n + 1))).toEqual(ok(3));
    });

    it('short-circuits on the first failure', () => {
      expect(flatMap(err<string>('boom'), (n: number) => ok(n + 1))).toEqual(err('boom'));
    });

    it('propagates a failure produced by the chained step', () => {
      expect(flatMap(ok(2), () => err('second'))).toEqual(err('second'));
    });
  });

  describe('all', () => {
    it('collects every success into a list', () => {
      expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it('returns the first failure and ignores later ones', () => {
      expect(all([ok(1), err('first'), err('second')])).toEqual(err('first'));
    });

    it('treats an empty list as success', () => {
      expect(all([])).toEqual(ok([]));
    });
  });
});
