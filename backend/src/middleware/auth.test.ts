import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { branchMatchesUser, effectiveBranchId } from "./auth";

function request(user: Partial<NonNullable<Request["user"]>>, query: Record<string, string> = {}, body: Record<string, string> = {}, params: Record<string, string> = {}) {
  return { user: { permissions: new Set<string>(), ...user }, query, body, params } as unknown as Request;
}

describe("branch access context", () => {
  it("allows all-branch users to access any branch", () => {
    expect(branchMatchesUser(request({ canViewAllBranches: true }), "other-branch")).toBe(true);
  });

  it("keeps branch users inside their assigned branch", () => {
    expect(branchMatchesUser(request({ canViewAllBranches: false, branchId: "branch-a" }), "branch-a")).toBe(true);
    expect(branchMatchesUser(request({ canViewAllBranches: false, branchId: "branch-a" }), "branch-b")).toBe(false);
  });

  it("uses the requested branch only for authorized all-branch users", () => {
    expect(effectiveBranchId(request({ canViewAllBranches: true, branchId: "branch-a" }, { branchId: "branch-b" }))).toBe("branch-b");
    expect(effectiveBranchId(request({ canViewAllBranches: false, branchId: "branch-a" }, { branchId: "branch-b" }))).toBe("branch-a");
  });
});
