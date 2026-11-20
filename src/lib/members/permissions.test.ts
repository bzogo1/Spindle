import { describe, expect, it } from "vitest"

import {
  canAssignRole,
  canChangeMemberRole,
  canInviteMembers,
  canManageInvites,
  canManageMembers,
  canRemoveMember,
  computeBulkTargets,
  isWorkspaceRole,
  type MemberRoleHolder,
} from "./permissions"

const owner: MemberRoleHolder = { id: "mem_owner", role: "owner" }
const admin: MemberRoleHolder = { id: "mem_admin", role: "admin" }
const member: MemberRoleHolder = { id: "mem_member", role: "member" }
const secondOwner: MemberRoleHolder = { id: "mem_owner_2", role: "owner" }

const roster = [owner, admin, member]
const twoOwnerRoster = [owner, secondOwner, admin, member]

describe("isWorkspaceRole", () => {
  it("accepts the three workspace roles and rejects anything else", () => {
    expect(isWorkspaceRole("owner")).toBe(true)
    expect(isWorkspaceRole("admin")).toBe(true)
    expect(isWorkspaceRole("member")).toBe(true)
    expect(isWorkspaceRole("viewer")).toBe(false)
    expect(isWorkspaceRole(null)).toBe(false)
    expect(isWorkspaceRole(undefined)).toBe(false)
  })
})

describe("canAssignRole", () => {
  it("lets owners grant any role", () => {
    expect(canAssignRole("owner", "owner")).toBe(true)
    expect(canAssignRole("owner", "admin")).toBe(true)
    expect(canAssignRole("owner", "member")).toBe(true)
  })

  it("lets admins grant admin and member but never owner", () => {
    expect(canAssignRole("admin", "admin")).toBe(true)
    expect(canAssignRole("admin", "member")).toBe(true)
    expect(canAssignRole("admin", "owner")).toBe(false)
  })

  it("lets members grant nothing", () => {
    expect(canAssignRole("member", "member")).toBe(false)
    expect(canAssignRole(null, "member")).toBe(false)
    expect(canAssignRole(undefined, "member")).toBe(false)
  })
})

describe("membership management", () => {
  it("allows owner/admin to manage members and invites, denies members", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(canManageMembers(role)).toBe(true)
      expect(canInviteMembers(role)).toBe(true)
      expect(canManageInvites(role)).toBe(true)
    }
    expect(canManageMembers("member")).toBe(false)
    expect(canInviteMembers("member")).toBe(false)
    expect(canManageInvites("member")).toBe(false)
    expect(canManageMembers(null)).toBe(false)
  })
})

describe("canChangeMemberRole", () => {
  it("lets an owner change any other member's role", () => {
    expect(canChangeMemberRole(owner, admin, roster, "member")).toBe(true)
    expect(canChangeMemberRole(owner, member, roster, "admin")).toBe(true)
    expect(canChangeMemberRole(owner, member, roster, "owner")).toBe(true)
  })

  it("lets an owner demote a co-owner while another owner remains", () => {
    expect(canChangeMemberRole(owner, secondOwner, twoOwnerRoster, "admin")).toBe(true)
  })

  it("blocks the last owner from being demoted", () => {
    expect(canChangeMemberRole(owner, owner, roster, "admin")).toBe(false)
    expect(canChangeMemberRole(secondOwner, owner, [owner, member], "member")).toBe(false)
  })

  it("blocks self role changes even for owners", () => {
    expect(canChangeMemberRole(owner, owner, twoOwnerRoster, "admin")).toBe(false)
    expect(canChangeMemberRole(admin, admin, roster, "member")).toBe(false)
  })

  it("lets an admin change member rows but not owners or admins", () => {
    expect(canChangeMemberRole(admin, member, roster, "admin")).toBe(true)
    expect(canChangeMemberRole(admin, member, roster, "member")).toBe(true)
    expect(canChangeMemberRole(admin, owner, roster, "member")).toBe(false)
    expect(canChangeMemberRole(admin, secondOwner, twoOwnerRoster, "member")).toBe(false)
    // Peer admins are off-limits too.
    expect(canChangeMemberRole(admin, { ...admin, id: "mem_admin_2" }, roster, "member")).toBe(
      false,
    )
  })

  it("blocks admins from granting owner and members from changing anything", () => {
    expect(canChangeMemberRole(admin, member, roster, "owner")).toBe(false)
    expect(canChangeMemberRole(member, member, roster, "admin")).toBe(false)
    expect(canChangeMemberRole(null, member, roster, "admin")).toBe(false)
  })
})

describe("canRemoveMember", () => {
  it("lets an owner remove other members", () => {
    expect(canRemoveMember(owner, admin, roster)).toBe(true)
    expect(canRemoveMember(owner, member, roster)).toBe(true)
    expect(canRemoveMember(owner, secondOwner, twoOwnerRoster)).toBe(true)
  })

  it("blocks self-removal and member actors", () => {
    expect(canRemoveMember(owner, owner, twoOwnerRoster)).toBe(false)
    expect(canRemoveMember(member, member, roster)).toBe(false)
    expect(canRemoveMember(member, admin, roster)).toBe(false)
  })

  it("lets an admin remove members only", () => {
    expect(canRemoveMember(admin, member, roster)).toBe(true)
    expect(canRemoveMember(admin, owner, roster)).toBe(false)
    expect(canRemoveMember(admin, { ...admin, id: "mem_admin_2" }, roster)).toBe(false)
    expect(canRemoveMember(admin, admin, roster)).toBe(false)
  })

  it("never removes the last owner", () => {
    expect(canRemoveMember(owner, owner, roster)).toBe(false)
    expect(canRemoveMember(admin, owner, roster)).toBe(false)
  })
})

describe("computeBulkTargets", () => {
  // An owner who is not on the roster (e.g. resolved from the session) can act
  // on both owners without tripping the self-guard.
  const outsideOwner: MemberRoleHolder = { id: "session:ops", role: "owner" }

  it("spends the last-owner budget sequentially across selected owners", () => {
    // Both owners pass the per-member checks against the static roster, but
    // only the first may be demoted/removed — the second would leave the
    // workspace ownerless.
    const selected = [owner, secondOwner, admin, member]
    const eligible = (target: MemberRoleHolder) =>
      canChangeMemberRole(outsideOwner, target, twoOwnerRoster, "member")
    expect(computeBulkTargets(outsideOwner, selected, twoOwnerRoster, eligible)).toEqual([
      owner,
      admin,
      member,
    ])
  })

  it("applies the same budget to removals", () => {
    const selected = [owner, secondOwner, member]
    expect(
      computeBulkTargets(outsideOwner, selected, twoOwnerRoster, (target) =>
        canRemoveMember(outsideOwner, target, twoOwnerRoster),
      ),
    ).toEqual([owner, member])
  })

  it("returns everything eligible when the owner budget is not exhausted", () => {
    const selected = [secondOwner, member]
    expect(
      computeBulkTargets(outsideOwner, selected, twoOwnerRoster, (target) =>
        canRemoveMember(outsideOwner, target, twoOwnerRoster),
      ),
    ).toEqual([secondOwner, member])
  })

  it("returns no targets without an actor", () => {
    expect(computeBulkTargets(null, [member], roster, () => true)).toEqual([])
    expect(computeBulkTargets(undefined, [member], roster, () => true)).toEqual([])
  })
})
