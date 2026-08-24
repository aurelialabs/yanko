import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("build", () => {
  it("produces non-empty plugin and UI distribution files", () => {
    for (const file of ["dist/code.js", "dist/ui.html"]) {
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });
});