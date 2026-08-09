import type { Clock } from '../../../domain/shared/clock.js';

/** The one place in the codebase allowed to call `new Date()`. */
export const systemClock: Clock = {
  now: () => new Date(),
};
