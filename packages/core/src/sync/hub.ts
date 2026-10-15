import {
  SyncGroup,
  type GroupMessage,
  type GroupRequest,
  type GroupMember,
  type PlayingOnCreate,
} from './group.js';

const SWEEP_MS = 1_000;

const hubs = new Set<GroupHub>();

/** Groups by id and which group each member is in; a member is in one at most. */
export class GroupHub {
  private readonly groups = new Map<string, SyncGroup>();
  private readonly memberOf = new Map<string, SyncGroup>();
  private sweep: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly deliver: (
      group: SyncGroup,
      to: readonly string[],
      message: GroupMessage
    ) => void,
    private readonly now: () => number = Date.now
  ) {
    hubs.add(this);
  }

  /** Groups in every hub, which share one limit. */
  static total(): number {
    let total = 0;
    for (const hub of hubs) total += hub.size;
    return total;
  }

  get size(): number {
    return this.groups.size;
  }

  get(id: string): SyncGroup | undefined {
    return this.groups.get(id);
  }

  groupOf(memberId: string): SyncGroup | undefined {
    return this.memberOf.get(memberId);
  }

  list(): SyncGroup[] {
    return [...this.groups.values()];
  }

  /** `opened` sees the group before its first message goes out. */
  create(
    name: string,
    creator: GroupMember,
    opts: {
      playing?: PlayingOnCreate;
      opened?: (group: SyncGroup) => void;
    } = {}
  ): SyncGroup {
    this.leave(creator.id);
    const group: SyncGroup = new SyncGroup(
      name,
      (to, message) => this.deliver(group, to, message),
      this.now
    );
    this.groups.set(group.id, group);
    this.memberOf.set(creator.id, group);
    opts.opened?.(group);
    group.create(creator, opts.playing);
    this.startSweep();
    return group;
  }

  join(groupId: string, member: GroupMember): SyncGroup | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;
    if (this.memberOf.get(member.id) !== group) {
      this.leave(member.id);
      this.memberOf.set(member.id, group);
    }
    group.join(member);
    return group;
  }

  /** The group the member left, which is gone once empty. */
  leave(memberId: string): SyncGroup | undefined {
    const group = this.memberOf.get(memberId);
    if (!group) return undefined;
    this.memberOf.delete(memberId);
    group.leave(memberId);
    if (!group.size) this.drop(group);
    return group;
  }

  /** Removes a group with everyone in it, telling nobody. */
  drop(group: SyncGroup): void {
    for (const member of group.memberList()) this.memberOf.delete(member.id);
    this.groups.delete(group.id);
    if (!this.groups.size) this.stopSweep();
  }

  /** False when the member is in no group. */
  request(memberId: string, request: GroupRequest): boolean {
    const group = this.memberOf.get(memberId);
    if (!group) return false;
    group.handle(memberId, request);
    return true;
  }

  private startSweep(): void {
    if (this.sweep) return;
    this.sweep = setInterval(() => {
      for (const group of this.groups.values()) group.tick();
    }, SWEEP_MS);
    this.sweep.unref?.();
  }

  private stopSweep(): void {
    clearInterval(this.sweep);
    this.sweep = undefined;
  }
}
