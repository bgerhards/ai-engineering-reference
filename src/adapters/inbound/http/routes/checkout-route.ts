import { ErrorCode, domainError } from '../../../../domain/shared/errors.js';
import type { CheckoutCopy } from '../../../../application/use-cases/checkout-copy.js';
import { toProblemResponse } from '../problem.js';
import type { Route } from '../router.js';

interface CheckoutRequestBody {
  readonly memberId: string;
  readonly copyId: string;
}

/**
 * Adapters translate, they do not decide. This one turns untyped JSON into a
 * command and a `Result` back into a status code — nothing else.
 */
const parseBody = (body: unknown): CheckoutRequestBody | null => {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate['memberId'] !== 'string') return null;
  if (typeof candidate['copyId'] !== 'string') return null;
  return { memberId: candidate['memberId'], copyId: candidate['copyId'] };
};

export const createCheckoutRoute = (checkoutCopy: CheckoutCopy): Route => ({
  method: 'POST',
  path: '/loans',
  handler: async (request) => {
    const body = parseBody(request.body);
    if (body === null) {
      return toProblemResponse(
        domainError(
          ErrorCode.InvalidInput,
          'Request body must be an object with string `memberId` and `copyId`.',
        ),
      );
    }

    const result = await checkoutCopy(body);
    if (!result.ok) return toProblemResponse(result.error);

    return {
      status: 201,
      headers: {
        'content-type': 'application/json',
        location: `/loans/${result.value.loanId}`,
      },
      body: result.value,
    };
  },
});
