import { describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse, Route } from '@/adapters/inbound/http/router.js';
import { createRouter } from '@/adapters/inbound/http/router.js';

const request = (
  overrides: Partial<Omit<HttpRequest, 'params'>> = {},
): Omit<HttpRequest, 'params'> => ({
  method: 'GET',
  path: '/health',
  query: {},
  body: undefined,
  ...overrides,
});

const echoRoute = (method: string, path: string): Route => ({
  method,
  path,
  handler: (received): Promise<HttpResponse> =>
    Promise.resolve({ status: 200, body: { params: received.params, path: received.path } }),
});

describe('createRouter', () => {
  it('dispatches an exact method and path match to its handler', async () => {
    const router = createRouter([echoRoute('GET', '/health')]);

    const response = await router(request({ method: 'GET', path: '/health' }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ path: '/health' });
  });

  it('picks the route whose method matches, not merely the first path match', async () => {
    const router = createRouter([
      { method: 'POST', path: '/loans', handler: () => Promise.resolve({ status: 201 }) },
      { method: 'GET', path: '/loans', handler: () => Promise.resolve({ status: 200 }) },
    ]);

    const response = await router(request({ method: 'GET', path: '/loans' }));

    expect(response.status).toBe(200);
  });

  it('extracts a named segment into params', async () => {
    const router = createRouter([echoRoute('GET', '/loans/:id')]);

    const response = await router(request({ method: 'GET', path: '/loans/loan-42' }));

    expect(response.body).toMatchObject({ params: { id: 'loan-42' } });
  });

  it('extracts every named segment when a path has more than one', async () => {
    const router = createRouter([echoRoute('GET', '/members/:memberId/loans/:loanId')]);

    const response = await router(
      request({ method: 'GET', path: '/members/member-1/loans/loan-9' }),
    );

    expect(response.body).toMatchObject({ params: { memberId: 'member-1', loanId: 'loan-9' } });
  });

  it('URL-decodes a param before handing it to the handler', async () => {
    const router = createRouter([echoRoute('GET', '/loans/:id')]);

    const response = await router(request({ method: 'GET', path: '/loans/loan%20one%2Ftwo' }));

    expect(response.body).toMatchObject({ params: { id: 'loan one/two' } });
  });

  it('passes an empty params object to a route with no named segments', async () => {
    const router = createRouter([echoRoute('GET', '/health')]);

    const response = await router(request({ method: 'GET', path: '/health' }));

    expect(response.body).toMatchObject({ params: {} });
  });

  it('tolerates a trailing slash on the request path', async () => {
    const router = createRouter([echoRoute('GET', '/health')]);

    const response = await router(request({ method: 'GET', path: '/health/' }));

    expect(response.status).toBe(200);
  });

  it('tolerates a trailing slash in the route pattern', async () => {
    const router = createRouter([echoRoute('GET', '/health/')]);

    const response = await router(request({ method: 'GET', path: '/health' }));

    expect(response.status).toBe(200);
  });

  it('answers 404 for a path no route declares', async () => {
    const router = createRouter([echoRoute('GET', '/health')]);

    const response = await router(request({ method: 'GET', path: '/nowhere' }));

    expect(response.status).toBe(404);
  });

  it('answers 405, not 404, when the path exists but the method does not', async () => {
    // The distinction is the whole point: 404 tells a client the endpoint is
    // gone and to stop asking, while 405 tells it to change the verb.
    const router = createRouter([echoRoute('POST', '/loans')]);

    const response = await router(request({ method: 'GET', path: '/loans' }));

    expect(response.status).toBe(405);
  });

  it('answers 404 when a path has more segments than any route pattern', async () => {
    const router = createRouter([echoRoute('GET', '/loans/:id')]);

    const response = await router(request({ method: 'GET', path: '/loans/loan-1/history' }));

    expect(response.status).toBe(404);
  });

  it('answers 404 when a path has fewer segments than the route pattern', async () => {
    const router = createRouter([echoRoute('GET', '/loans/:id')]);

    const response = await router(request({ method: 'GET', path: '/loans' }));

    expect(response.status).toBe(404);
  });

  it('answers 404 when there are no routes at all', async () => {
    const router = createRouter([]);

    const response = await router(request({ method: 'GET', path: '/health' }));

    expect(response.status).toBe(404);
  });

  it('forwards the method, query and body the caller supplied', async () => {
    const router = createRouter([
      {
        method: 'POST',
        path: '/loans',
        handler: (received) => Promise.resolve({ status: 200, body: received }),
      },
    ]);

    const response = await router({
      method: 'POST',
      path: '/loans',
      query: { page: '2' },
      body: { copyId: 'copy-1' },
    });

    expect(response.body).toMatchObject({
      method: 'POST',
      query: { page: '2' },
      body: { copyId: 'copy-1' },
    });
  });
});
