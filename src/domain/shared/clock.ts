/**
 * Time is an input, never an ambient global.
 *
 * Nothing in `src/domain` or `src/application` may call `new Date()` directly;
 * they receive a `Clock`. That single rule is what makes "the loan is overdue"
 * testable without sleeping, mocking timers, or waiting three weeks.
 */
export interface Clock {
  now(): Date;
}
