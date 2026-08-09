import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../../application/ports/id-generator.js';
import type { LoanId } from '../../../domain/lending/loan.js';

export const randomIdGenerator: IdGenerator = {
  nextLoanId: () => `loan-${randomUUID()}` as LoanId,
};
