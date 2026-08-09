import type { IdGenerator } from '@/application/ports/id-generator.js';
import type { Clock } from '@/domain/shared/clock.js';
import type { LoanId } from '@/domain/lending/loan.js';

/** A clock that only moves when a test tells it to. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(instant: Date): void {
    this.current = instant;
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}

/** Predictable identifiers: loan-1, loan-2, ... — assertable and readable. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  nextLoanId(): LoanId {
    this.counter += 1;
    return `loan-${String(this.counter)}` as LoanId;
  }
}
