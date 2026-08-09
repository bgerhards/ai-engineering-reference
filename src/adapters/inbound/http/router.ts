export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export type RouteHandler = (request: HttpRequest) => Promise<HttpResponse>;

export interface Route {
  readonly method: string;
  /** Path pattern; `:name` segments become entries in `request.params`. */
  readonly path: string;
  readonly handler: RouteHandler;
}

export type Router = (request: Omit<HttpRequest, 'params'>) => Promise<HttpResponse>;

const matchPath = (
  pattern: string,
  actual: string,
): Readonly<Record<string, string>> | null => {
  const patternSegments = pattern.split('/').filter(Boolean);
  const actualSegments = actual.split('/').filter(Boolean);

  if (patternSegments.length !== actualSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index] ?? '';
    const received = actualSegments[index] ?? '';

    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(received);
      continue;
    }
    if (expected !== received) return null;
  }
  return params;
};

/**
 * A ~40-line router, on purpose. The HTTP framework is a detail; keeping it
 * replaceable is the point of the architecture, and a dependency you can read in
 * one sitting is easier to reason about than one you have to trust.
 */
export const createRouter = (routes: readonly Route[]): Router => {
  return async (request) => {
    let pathExists = false;

    for (const route of routes) {
      const params = matchPath(route.path, request.path);
      if (params === null) continue;
      pathExists = true;
      if (route.method !== request.method) continue;

      return route.handler({ ...request, params });
    }

    return pathExists
      ? { status: 405, body: { title: 'Method not allowed' } }
      : { status: 404, body: { title: 'Not found' } };
  };
};
