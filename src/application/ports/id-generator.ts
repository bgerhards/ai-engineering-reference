import type { LoanId } from '../../domain/lending/loan.js';

/**
 * Identity generation is an effect, so it is a port. Tests inject a counter and
 * get stable, readable identifiers instead of asserting on random UUIDs.
 */
export interface IdGenerator {
  nextLoanId(): LoanId;
}
