import { createCheckoutRoute } from '../adapters/inbound/http/routes/checkout-route.js';
import { createRouter } from '../adapters/inbound/http/router.js';
import type { Router } from '../adapters/inbound/http/router.js';
import {
  InMemoryBookCopyRepository,
  InMemoryLoanRepository,
  InMemoryMemberRepository,
} from '../adapters/outbound/memory/in-memory-repositories.js';
import { randomIdGenerator } from '../adapters/outbound/system/random-id-generator.js';
import { systemClock } from '../adapters/outbound/system/system-clock.js';
import type { IdGenerator } from '../application/ports/id-generator.js';
import type {
  BookCopyRepository,
  LoanRepository,
  MemberRepository,
} from '../application/ports/repositories.js';
import { makeCheckoutCopy } from '../application/use-cases/checkout-copy.js';
import type { LendingPolicy } from '../domain/lending/lending-policy.js';
import { defaultLendingPolicy } from '../domain/lending/lending-policy.js';
import type { Clock } from '../domain/shared/clock.js';

export interface Adapters {
  readonly members: MemberRepository;
  readonly copies: BookCopyRepository;
  readonly loans: LoanRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly policy: LendingPolicy;
}

/**
 * Wiring by hand, in one readable function. No DI container, no decorators, no
 * reflection — dependencies are arguments, and this is the only file that knows
 * which concrete adapter is in play.
 */
export const createDefaultAdapters = (): Adapters => ({
  members: new InMemoryMemberRepository(),
  copies: new InMemoryBookCopyRepository(),
  loans: new InMemoryLoanRepository(),
  ids: randomIdGenerator,
  clock: systemClock,
  policy: defaultLendingPolicy,
});

export const createAppRouter = (adapters: Adapters): Router => {
  const checkoutCopy = makeCheckoutCopy(adapters);

  return createRouter([
    createCheckoutRoute(checkoutCopy),
    {
      method: 'GET',
      path: '/health',
      handler: () => Promise.resolve({ status: 200, body: { status: 'ok' } }),
    },
    // Routes added by SPEC-002+ are appended here. This list is the one
    // coordination point between parallel specs — keep additions append-only.
  ]);
};
