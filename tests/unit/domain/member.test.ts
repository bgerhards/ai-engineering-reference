import { describe, expect, it } from 'vitest';
import {
  MemberStanding,
  isInGoodStanding,
  parseMemberId,
  requireGoodStanding,
} from '@/domain/lending/member.js';
import { aMember } from '@tests/support/builders.js';

describe('parseMemberId', () => {
  it('accepts a well-formed id', () => {
    const result = parseMemberId('member-42');

    expect(result.ok && result.value).toBe('member-42');
  });

  it('rejects a malformed id', () => {
    const result = parseMemberId('member 42');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
  });

  it('names MemberId as the offending brand', () => {
    const result = parseMemberId('');

    expect(!result.ok && result.error.details).toMatchObject({ brand: 'MemberId' });
  });
});

describe('isInGoodStanding', () => {
  it('is true for a member in good standing', () => {
    expect(isInGoodStanding(aMember({ standing: MemberStanding.Good }))).toBe(true);
  });

  it('is false for a suspended member', () => {
    expect(isInGoodStanding(aMember({ standing: MemberStanding.Suspended }))).toBe(false);
  });
});

describe('requireGoodStanding', () => {
  it('returns the member unchanged when they are in good standing', () => {
    const member = aMember({ standing: MemberStanding.Good });

    const result = requireGoodStanding(member);

    expect(result.ok && result.value).toBe(member);
  });

  it('refuses a suspended member', () => {
    const result = requireGoodStanding(aMember({ standing: MemberStanding.Suspended }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('MEMBER_SUSPENDED');
  });

  it('names the suspended member in the error details', () => {
    const member = aMember({ standing: MemberStanding.Suspended });

    const result = requireGoodStanding(member);

    expect(!result.ok && result.error.details).toMatchObject({ memberId: member.id });
  });
});
