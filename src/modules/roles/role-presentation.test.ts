import { describe, expect, it } from "vitest";

import { demoRoleWorkspace } from "./role-presentation";

describe("demoRoleWorkspace", () => {
  it("keeps the three Figma default roles with Lin Zhixia selected", () => {
    expect(demoRoleWorkspace.roles.map((role) => role.name)).toEqual([
      "林知夏",
      "周予安",
      "南枝",
    ]);
    expect(demoRoleWorkspace.currentRole.name).toBe("林知夏");
  });
});
