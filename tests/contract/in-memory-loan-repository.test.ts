import { InMemoryLoanRepository } from '@/adapters/outbound/memory/in-memory-repositories.js';
import { describeLoanRepositoryContract } from './loan-repository.contract.js';

// SPEC-008's SQLite adapter binds the same suite from a sibling file and writes
// no new behavioural assertions: if it needs its own, the promise was never in
// the port to begin with.
describeLoanRepositoryContract('InMemoryLoanRepository', () => new InMemoryLoanRepository());
