import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Router } from './router.js';

const MAX_BODY_BYTES = 1_000_000;

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined;

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return undefined;
  return JSON.parse(raw);
};

const send = (response: ServerResponse, status: number, headers: Record<string, string>, body: unknown): void => {
  if (body === undefined) {
    response.writeHead(status, headers);
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(payload);
};

/**
 * The only place `node:http` is mentioned. Swapping this for Fastify, Hono or a
 * Lambda handler touches this file and nothing else.
 */
export const createHttpServer = (router: Router): Server =>
  createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');

      let body: unknown;
      try {
        body = await readBody(request);
      } catch {
        send(response, 400, {}, { title: 'Malformed request body', status: 400 });
        return;
      }

      try {
        const result = await router({
          method: request.method ?? 'GET',
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body,
        });
        send(response, result.status, { ...result.headers }, result.body);
      } catch (error) {
        console.error('Unhandled error while routing request', error);
        send(response, 500, {}, { title: 'Internal server error', status: 500 });
      }
    })();
  });
