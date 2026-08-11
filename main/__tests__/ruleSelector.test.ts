// @vitest-environment jsdom
//
// main/dom/ruleSelector.ts — how a "no-translate area" rule addresses an element
// that lives inside a shadow root, and how old rules keep working.
import { describe, it, expect, beforeEach } from "vitest";
import {
    isShadowRulePath,
    partitionRules,
    resolveRulePaths,
    resolveRuleSelector,
    serializeRuleSelector,
    SHADOW_PATH_SEP,
} from "@/main/dom/ruleSelector";

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("serializeRuleSelector", () => {
    it("emits a plain selector for a light-DOM element (back-compat pin)", () => {
        // Nothing about the stored format changes for the existing 100% of
        // rules — no separator, no migration, no rewrite on load.
        document.body.innerHTML = "<div id='ads'><p>x</p></div>";
        const rule = serializeRuleSelector(document.getElementById("ads")!);

        expect(isShadowRulePath(rule)).toBe(false);
        expect(rule).not.toContain(SHADOW_PATH_SEP);
        expect(document.querySelector(rule)).toBe(document.getElementById("ads"));
    });

    it("emits a per-tree path for an element inside a shadow root", () => {
        document.body.innerHTML = "<div id='host'></div>";
        const host = document.getElementById("host")!;
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = "<aside id='promo'>ad</aside>";

        const rule = serializeRuleSelector(root.getElementById("promo")!);

        expect(isShadowRulePath(rule)).toBe(true);
        expect(rule.split(SHADOW_PATH_SEP)).toHaveLength(2);
        expect(resolveRuleSelector(rule)).toBe(root.getElementById("promo"));
    });

    it("round-trips through two nested roots", () => {
        document.body.innerHTML = "<div id='outer'></div>";
        const outer = document.getElementById("outer")!;
        const outerRoot = outer.attachShadow({ mode: "open" });
        outerRoot.innerHTML = "<div id='inner'></div>";
        const inner = outerRoot.getElementById("inner")!;
        const innerRoot = inner.attachShadow({ mode: "open" });
        innerRoot.innerHTML = "<aside id='deep'>ad</aside>";
        const target = innerRoot.getElementById("deep")!;

        const rule = serializeRuleSelector(target);

        expect(rule.split(SHADOW_PATH_SEP)).toHaveLength(3);
        expect(resolveRuleSelector(rule)).toBe(target);
    });
});

describe("resolveRuleSelector", () => {
    it("returns null when a hop no longer matches", () => {
        document.body.innerHTML = "<div id='host'></div>";
        const host = document.getElementById("host")!;
        host.attachShadow({ mode: "open" }).innerHTML = "<aside id='promo'>ad</aside>";
        const rule = serializeRuleSelector(host.shadowRoot!.getElementById("promo")!);

        host.shadowRoot!.innerHTML = "";

        expect(resolveRuleSelector(rule)).toBeNull();
    });

    it("returns null when an intermediate host lost its root", () => {
        expect(resolveRuleSelector(`#gone${SHADOW_PATH_SEP}#deep`)).toBeNull();
    });

    it("degrades to null on an invalid selector instead of throwing", () => {
        expect(resolveRuleSelector(":::bad")).toBeNull();
    });

    it("still resolves an ordinary document selector", () => {
        document.body.innerHTML = "<div id='ads'>x</div>";
        expect(resolveRuleSelector("#ads")).toBe(document.getElementById("ads"));
    });
});

describe("partitionRules / resolveRulePaths", () => {
    it("keeps path rules out of the joined matches() string", () => {
        // `>>>` is illegal CSS and ONE bad selector makes el.matches() throw for
        // the whole list — which would silently disable every rule on the page.
        const { plain, paths } = partitionRules(["#ads", `#host${SHADOW_PATH_SEP}#promo`, ".sidebar"]);
        expect(plain).toEqual(["#ads", ".sidebar"]);
        expect(paths).toEqual([`#host${SHADOW_PATH_SEP}#promo`]);
    });

    it("resolves path rules to live elements, skipping stale ones", () => {
        document.body.innerHTML = "<div id='host'></div>";
        const host = document.getElementById("host")!;
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = "<aside id='promo'>ad</aside>";
        const live = serializeRuleSelector(root.getElementById("promo")!);

        const targets = resolveRulePaths([live, `#nope${SHADOW_PATH_SEP}#gone`]);

        expect(targets.size).toBe(1);
        expect(targets.has(root.getElementById("promo")!)).toBe(true);
    });
});
