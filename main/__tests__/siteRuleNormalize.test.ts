// Rule-package parsing (main/siteRules/normalize.ts). The contract downstream
// code relies on: every `string | string[]` field is a `string[]`, ids are
// present and unique, and one broken entry never takes the package down.
import { describe, it, expect } from "vitest";
import { bundleTime, normalizeBundle, toArray } from "@/main/siteRules/normalize";
import { SITE_RULE_SCHEMA_VERSION } from "@/main/siteRules/types";

const pkg = (rules: any[], extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    name: "Test pack",
    rules,
    ...extra,
});

describe("toArray", () => {
    it("collapses the string | string[] union and drops blanks", () => {
        expect(toArray("a")).toEqual(["a"]);
        expect(toArray("  a  ")).toEqual(["a"]);
        expect(toArray("")).toEqual([]);
        expect(toArray(["a", "", "  b "])).toEqual(["a", "b"]);
        expect(toArray(undefined)).toEqual([]);
        expect(toArray(42)).toEqual([]);
        expect(toArray([1, "a", null])).toEqual(["a"]);
    });
});

describe("normalizeBundle", () => {
    it("normalizes a minimal rule and fills defaults", () => {
        const { bundle, warnings } = normalizeBundle(
            pkg([{ id: "r1", includeUrls: "*://a.com/*", excludeSelectors: ".ad" }]),
        );
        expect(warnings).toEqual([]);
        expect(bundle.rules).toHaveLength(1);
        expect(bundle.rules[0]).toEqual({
            id: "r1",
            name: "r1", // falls back to the id
            description: "",
            enabled: true,
            includeUrls: ["*://a.com/*"],
            excludeUrls: [],
            matchSelectors: [],
            includeSelectors: [],
            excludeSelectors: [".ad"],
            injectCss: [],
        });
        expect(bundle.schemaVersion).toBe(SITE_RULE_SCHEMA_VERSION);
    });

    it("keeps enabled:false but treats a missing flag as enabled", () => {
        const { bundle } = normalizeBundle(pkg([
            { id: "on" },
            { id: "off", enabled: false },
        ]));
        expect(bundle.rules.map((r) => r.enabled)).toEqual([true, false]);
    });

    it("drops entries with no id and warns", () => {
        const { bundle, warnings } = normalizeBundle(pkg([{ id: "" }, { name: "x" }, { id: "ok" }]));
        expect(bundle.rules.map((r) => r.id)).toEqual(["ok"]);
        expect(warnings).toHaveLength(2);
    });

    it("drops duplicate ids, keeping the first", () => {
        const { bundle, warnings } = normalizeBundle(pkg([
            { id: "dup", name: "first" },
            { id: "dup", name: "second" },
        ]));
        expect(bundle.rules).toHaveLength(1);
        expect(bundle.rules[0].name).toBe("first");
        expect(warnings.join()).toContain("dup");
    });

    it("isolates a malformed URL pattern without losing the rule or its siblings", () => {
        const { bundle, warnings } = normalizeBundle(pkg([
            { id: "r1", includeUrls: ["/(/", "*://a.com/*"] },
        ]));
        expect(bundle.rules[0].includeUrls).toEqual(["*://a.com/*"]);
        expect(warnings.join()).toContain("r1");
    });

    it("does not validate selectors — no document in the service worker", () => {
        const { bundle, warnings } = normalizeBundle(pkg([
            { id: "r1", excludeSelectors: ["!!! not a selector"] },
        ]));
        expect(bundle.rules[0].excludeSelectors).toEqual(["!!! not a selector"]);
        expect(warnings).toEqual([]);
    });

    it("normalizes matchSelectors through the same string | string[] path", () => {
        const { bundle } = normalizeBundle(pkg([
            { id: "one", matchSelectors: 'meta[name="generator"][content^="VitePress"]' },
            { id: "many", matchSelectors: ["html.docs-doc-page", "", "  body.single  "] },
        ]));
        expect(bundle.rules[0].matchSelectors).toEqual(['meta[name="generator"][content^="VitePress"]']);
        expect(bundle.rules[1].matchSelectors).toEqual(["html.docs-doc-page", "body.single"]);
    });

    it("rejects a payload that is not a rule package", () => {
        expect(() => normalizeBundle(null)).toThrow();
        expect(() => normalizeBundle({ rules: "nope" })).toThrow(/rules/);
        expect(() => normalizeBundle([])).toThrow(/rules/);
    });

    it("rejects a schema version from the future", () => {
        expect(() => normalizeBundle(pkg([], { schemaVersion: SITE_RULE_SCHEMA_VERSION + 1 })))
            .toThrow(/newer than supported/);
    });
});

describe("bundleTime", () => {
    it("sorts a missing or unparseable timestamp oldest", () => {
        const at = (updatedAt: any) => bundleTime({ schemaVersion: 1, name: "", updatedAt, rules: [] });
        expect(at("2026-08-01T00:00:00Z")).toBeGreaterThan(0);
        expect(at("")).toBe(0);
        expect(at("not a date")).toBe(0);
        expect(bundleTime(undefined)).toBe(0);
    });
});
