import { describe, expect, it } from "vite-plus/test";

import { areaOf, globToRegExp, parseAreas } from "./areas";

describe("areas", () => {
  it("match files by globs from the repo root", () => {
    expect(globToRegExp("apps/patient-app/**").test("apps/patient-app/src/a.tsx")).toBe(true);
    expect(globToRegExp("apps/*/package.json").test("apps/x/package.json")).toBe(true);
    expect(globToRegExp("apps/*/package.json").test("apps/x/y/package.json")).toBe(false);
    expect(globToRegExp("**/*.rb").test("app/models/user.rb")).toBe(true);
    expect(globToRegExp("**/*.rb").test("user.rb")).toBe(true);
  });

  it("take the first area that matches, and colour areas that name no colour", () => {
    const areas = parseAreas(
      JSON.stringify({
        areas: [
          { id: "tele", label: "Telehealth", paths: ["packages/telehealth/**"] },
          { label: "Packages", color: "#123456", paths: ["packages/**"] },
        ],
      }),
    );
    expect(areaOf(areas, "packages/telehealth/src/x.ts")?.label).toBe("Telehealth");
    expect(areaOf(areas, "packages/other/x.ts")?.color).toBe("#123456");
    expect(areaOf(areas, "apps/x.ts")).toBeNull();
    expect(areas[0]?.color).toMatch(/^#/);
  });

  it("read a broken file as no areas", () => {
    expect(parseAreas("{ nope")).toEqual([]);
  });
});
