const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns a new `Date` `days` after `from`. Never mutates its argument. */
export const addDays = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * MILLISECONDS_PER_DAY);

/** Whole days between two instants, truncated toward zero. */
export const daysBetween = (from: Date, to: Date): number =>
  Math.trunc((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);

export const isBefore = (left: Date, right: Date): boolean => left.getTime() < right.getTime();
