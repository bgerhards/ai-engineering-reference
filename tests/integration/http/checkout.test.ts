import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '@/adapters/inbound/http/server.js';
import {
  InMemoryBookCopyRepository,
  InMemoryLoanRepository,
  InMemoryMemberRepository,
} from '@/adapters/outbound/memory/in-memory-repositories.js';
import { createAppRouter } from '@/composition/container.js';
import type { BookCopyId } from '@/domain/catalog/book-copy.js';
import { CopyStatus } from '@/domain/catalog/book-copy.js';
import { defaultLendingPolicy } from '@/domain/lending/lending-policy.js';
import type { MemberId } from '@/domain/lending/member.js';
import { MemberStanding } from '@/domain/lending/member.js';
import { aBookCopy, aMember } from '@tests/support/builders.js';
import { FixedClock, SequentialIdGenerator } from '@tests/support/fakes.js';

const NOW = new Date('2026-03-01T10:00:00.000Z');

const members = new InMemoryMemberRepository();
const copies = new InMemoryBookCopyRepository();
const loans = new InMemoryLoanRepository();

let server: Server;
let baseUrl: string;

const post = async (path: string, body: string): Promise<Response> =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

beforeAll(async () => {
  // Wired by hand rather than via `createDefaultAdapters()`: the test needs to
  // seed a member and a copy, and needs a clock that does not move under it.
  members.add(aMember({ id: 'member-1' as MemberId }));
  members.add(aMember({ id: 'member-suspended' as MemberId, standing: MemberStanding.Suspended }));
  copies.add(aBookCopy({ id: 'copy-1' as BookCopyId, status: CopyStatus.Available }));
  copies.add(aBookCopy({ id: 'copy-withdrawn' as BookCopyId, status: CopyStatus.Withdrawn }));

  server = createHttpServer(
    createAppRouter({
      members,
      copies,
      loans,
      ids: new SequentialIdGenerator(),
      clock: new FixedClock(NOW),
      policy: defaultLendingPolicy,
    }),
  );

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

describe('POST /loans', () => {
  it('creates a loan and points at it with a location header', async () => {
    const response = await post(
      '/loans',
      JSON.stringify({ memberId: 'member-1', copyId: 'copy-1' }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe('/loans/loan-1');
    expect(await response.json()).toEqual({
      loanId: 'loan-1',
      memberId: 'member-1',
      copyId: 'copy-1',
      checkedOutAt: '2026-03-01T10:00:00.000Z',
      dueAt: '2026-03-22T10:00:00.000Z',
    });
  });

  it('reports a withdrawn copy as a conflict in problem+json', async () => {
    const response = await post(
      '/loans',
      JSON.stringify({ memberId: 'member-1', copyId: 'copy-withdrawn' }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'COPY_WITHDRAWN', status: 409 });
  });

  it('reports a suspended member as forbidden', async () => {
    const response = await post(
      '/loans',
      JSON.stringify({ memberId: 'member-suspended', copyId: 'copy-1' }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'MEMBER_SUSPENDED' });
  });

  it('rejects a body that is not valid JSON', async () => {
    const response = await post('/loans', '{ not json');

    expect(response.status).toBe(400);
  });

  it('rejects a body that omits the copy id', async () => {
    const response = await post('/loans', JSON.stringify({ memberId: 'member-1' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a body that is valid JSON but not an object', async () => {
    const response = await post('/loans', JSON.stringify('member-1'));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a member id that is not a string', async () => {
    const response = await post('/loans', JSON.stringify({ memberId: 7, copyId: 'copy-1' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('the served routes', () => {
  it('answers a health check', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers 404 for a path the service does not serve', async () => {
    const response = await fetch(`${baseUrl}/nowhere`);

    expect(response.status).toBe(404);
  });

  it('answers 405 for a known path reached with the wrong method', async () => {
    const response = await fetch(`${baseUrl}/loans`);

    expect(response.status).toBe(405);
  });
});
