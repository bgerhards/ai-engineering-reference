import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isBefore } from '@/domain/shared/date.js';

describe('date helpers', () => {
  const noon = new Date('2026-03-01T12:00:00.000Z');

  describe('addDays', () => {
    it('moves the instant forward', () => {
      expect(addDays(noon, 3).toISOString()).toBe('2026-03-04T12:00:00.000Z');
    });

    it('moves backwards for a negative count', () => {
      expect(addDays(noon, -1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    });

    it('does not mutate its argument', () => {
      addDays(noon, 10);

      expect(noon.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    });
  });

  describe('daysBetween', () => {
    it('counts whole days', () => {
      expect(daysBetween(noon, addDays(noon, 5))).toBe(5);
    });

    it('truncates a partial day rather than rounding up', () => {
      expect(daysBetween(noon, new Date('2026-03-06T11:59:00.000Z'))).toBe(4);
    });

    it('is negative when the second instant is earlier', () => {
      expect(daysBetween(noon, addDays(noon, -2))).toBe(-2);
    });
  });

  describe('isBefore', () => {
    it('is true when the left instant is earlier', () => {
      expect(isBefore(noon, addDays(noon, 1))).toBe(true);
    });

    it('is false for identical instants', () => {
      expect(isBefore(noon, new Date(noon.getTime()))).toBe(false);
    });
  });
});
