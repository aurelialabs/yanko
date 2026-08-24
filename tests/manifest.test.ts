import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("manifest", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

  it("targets Figma Design with built entry files", () => {
    expect(manifest.editorType).toEqual(["figma"]);
    expect(manifest.main).toBe("dist/code.js");
    expect(manifest.ui).toBe("dist/ui.html");
    expect(manifest.documentAccess).toBe("dynamic-page");
  });

  it("does not request network access", () => {
    expect(manifest.networkAccess.allowedDomains).toEqual(["none"]);
  });
});
