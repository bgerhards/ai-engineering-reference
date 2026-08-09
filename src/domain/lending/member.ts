import type { DomainError } from '../shared/errors.js';
import { ErrorCode, domainError } from '../shared/errors.js';
import type { Brand } from '../shared/identifier.js';
import { parseIdentifier } from '../shared/identifier.js';
import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';

export type MemberId = Brand<string, 'MemberId'>;

export const parseMemberId = (raw: string): Result<MemberId, DomainError> =>
  parseIdentifier('MemberId', raw);

export const MemberStanding = {
  Good: 'good',
  Suspended: 'suspended',
} as const;

export type MemberStanding = (typeof MemberStanding)[keyof typeof MemberStanding];

export interface Member {
  readonly id: MemberId;
  readonly name: string;
  readonly standing: MemberStanding;
}

export const isInGoodStanding = (member: Member): boolean =>
  member.standing === MemberStanding.Good;

export const requireGoodStanding = (member: Member): Result<Member, DomainError> =>
  isInGoodStanding(member)
    ? ok(member)
    : err(
        domainError(ErrorCode.MemberSuspended, 'This membership is currently suspended.', {
          memberId: member.id,
        }),
      );
