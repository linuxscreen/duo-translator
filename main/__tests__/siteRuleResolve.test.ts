// The three-tier merge (main/siteRules/resolve.ts).
//
// This is the load-bearing test of the feature: the merge rule differs per
// field, and the includeSelectors rule ("highest tier that has any wins
// outright", NOT union) is the one a future refactor is most likely to
// "simplify" into a union and thereby break.
import { describe, it, expect } from "vitest";
import { mergeCandidates, resolveRules, selectCandidates } from "@/main/siteRules/resolve";
import { refKey, type RuleGroup, type SiteRule } from "@/main/siteRules/types";

const URL = "https://example.com/page";

function rule(id: string, over: Partial<SiteRule> = {}): SiteRule {
    return {
        id,
        name: id,
        description: "",
        enabled: true,
        includeUrls: ["*://example.com/*"],
        excludeUrls: [],
        matchSelectors: [],
        includeSelectors: [],
        excludeSelectors: [],
        injectCss: [],
        ...over,
    };
}

const system = (...rules: SiteRule[]): RuleGroup[] => [{ source: "system", rules }];
const user = (...rules: SiteRule[]): RuleGroup[] => [{ source: "user", rules }];
const sub = (url: string, ...rules: SiteRule[]): RuleGroup => ({ source: `sub:${url}`, rules });

describe("field-wise merge", () => {
    it("unions excludeSelectors across all three tiers, in priority order", () => {
        const r = resolveRules(URL, [
            system(rule("s", { excludeSelectors: [".ad"] })),
            [sub("u1", rule("b", { excludeSelectors: [".sidebar"] }))],
            user(rule("u", { excludeSelectors: [".footer"] })),
        ]);
        expect(r.excludeSelectors).toEqual([".ad", ".sidebar", ".footer"]);
    });

    it("dedupes exclude selectors contributed by more than one tier", () => {
        const r = resolveRules(URL, [
            system(rule("s", { excludeSelectors: [".ad", ".nav"] })),
            [],
            user(rule("u", { excludeSelectors: [".ad"] })),
        ]);
        expect(r.excludeSelectors).toEqual([".ad", ".nav"]);
    });

    it("concatenates injectCss system → subscription → user so the later one wins", () => {
        const r = resolveRules(URL, [
            system(rule("s", { injectCss: ["a{}"] })),
            [sub("u1", rule("b", { injectCss: ["b{}"] }))],
            user(rule("u", { injectCss: ["c{}"] })),
        ]);
        expect(r.injectCss).toBe("a{}\nb{}\nc{}");
    });

    it("takes includeSelectors ONLY from the highest tier that has any", () => {
        const r = resolveRules(URL, [
            system(rule("s", { includeSelectors: ["#main"] })),
            [sub("u1", rule("b", { includeSelectors: ["#content"] }))],
            user(rule("u", { includeSelectors: ["article"] })),
        ]);
        // Union would give three; that would let a lower tier widen what the
        // user deliberately narrowed.
        expect(r.includeSelectors).toEqual(["article"]);
    });

    it("falls through to the next tier down when the higher ones have no include", () => {
        const r = resolveRules(URL, [
            system(rule("s", { includeSelectors: ["#main"] })),
            [sub("u1", rule("b", { includeSelectors: ["#content"] }))],
            user(rule("u", { excludeSelectors: [".x"] })),
        ]);
        expect(r.includeSelectors).toEqual(["#content"]);
    });

    it("unions includes WITHIN a tier — all subscriptions share one tier", () => {
        const r = resolveRules(URL, [
            system(),
            [sub("u1", rule("a", { includeSelectors: ["#a"] })), sub("u2", rule("b", { includeSelectors: ["#b"] }))],
            user(),
        ]);
        expect(r.includeSelectors).toEqual(["#a", "#b"]);
    });
});

describe("participation", () => {
    it("ignores rules whose URL patterns do not match", () => {
        const r = resolveRules(URL, [
            system(
                rule("hit", { excludeSelectors: [".yes"] }),
                rule("miss", { includeUrls: ["*://other.com/*"], excludeSelectors: [".no"] }),
            ),
        ]);
        expect(r.excludeSelectors).toEqual([".yes"]);
        expect(r.matchedIds).toEqual([refKey("system", "hit")]);
    });

    it("honours excludeUrls", () => {
        const r = resolveRules("https://example.com/settings/a", [
            system(rule("s", { excludeUrls: ["*://example.com/settings/*"], excludeSelectors: [".x"] })),
        ]);
        expect(r.excludeSelectors).toEqual([]);
    });

    it("skips author-disabled rules", () => {
        const r = resolveRules(URL, [system(rule("s", { enabled: false, excludeSelectors: [".x"] }))]);
        expect(r.excludeSelectors).toEqual([]);
    });

    it("skips user-disabled rules by refKey, and only those", () => {
        const tiers = [
            system(rule("dup", { excludeSelectors: [".sys"] })),
            [sub("https://feed.example/rules.json", rule("dup", { excludeSelectors: [".sub"] }))],
        ];
        const r = resolveRules(URL, tiers, [refKey("system", "dup")]);
        // Same bare id in two sources — only the system one is off, proving the
        // disable list is keyed by refKey and not by bare id.
        expect(r.excludeSelectors).toEqual([".sub"]);
    });

    it("reports every contributing rule in matchedIds", () => {
        const r = resolveRules(URL, [
            system(rule("s")),
            [sub("u1", rule("b"))],
            user(rule("u")),
        ]);
        expect(r.matchedIds).toEqual([
            refKey("system", "s"),
            refKey("sub:u1", "b"),
            refKey("user", "u"),
        ]);
    });

    it("strips the Options-only fields out of the wire payload", () => {
        // name/description/urls cross into every frame of every page otherwise.
        const candidates = selectCandidates(URL, [system(rule("s", { description: "long text" }))]);
        expect(Object.keys(candidates.tiers[0][0]).sort()).toEqual([
            "excludeSelectors",
            "includeSelectors",
            "injectCss",
            "key",
            "matchSelectors",
        ]);
    });

    it("returns an empty result when nothing matches", () => {
        expect(resolveRules(URL, [system(), [], user()])).toEqual({
            includeSelectors: [],
            excludeSelectors: [],
            injectCss: "",
            matchedIds: [],
        });
    });
});

// The `matchSelectors` gate. Evaluating it needs a document, so background stops
// at URL selection and content applies this predicate — the split is why
// selectCandidates and mergeCandidates are separate functions.
describe("matchSelectors condition", () => {
    const tiers = [
        system(rule("plain", { excludeSelectors: [".always"] })),
        [],
        user(rule("conditional", { matchSelectors: ["body.single"], excludeSelectors: [".sometimes"] })),
    ];

    it("drops a candidate whose condition does not hold", () => {
        const r = mergeCandidates(selectCandidates(URL, tiers), () => false);
        expect(r.excludeSelectors).toEqual([]);
        expect(r.matchedIds).toEqual([]);
    });

    it("keeps unconditional candidates when a conditional sibling is excluded", () => {
        const r = mergeCandidates(
            selectCandidates(URL, tiers),
            (c) => c.matchSelectors.length === 0,
        );
        expect(r.excludeSelectors).toEqual([".always"]);
        expect(r.matchedIds).toEqual([refKey("system", "plain")]);
    });

    it("includes the conditional candidate once its condition holds", () => {
        const r = mergeCandidates(selectCandidates(URL, tiers), () => true);
        expect(r.excludeSelectors).toEqual([".always", ".sometimes"]);
    });

    it("a condition that only the higher tier fails hands includeSelectors down a tier", () => {
        const layered = [
            system(rule("s", { includeSelectors: ["#main"] })),
            [],
            user(rule("u", { matchSelectors: ["body.single"], includeSelectors: ["article"] })),
        ];
        const candidates = selectCandidates(URL, layered);
        expect(mergeCandidates(candidates, () => true).includeSelectors).toEqual(["article"]);
        // The user rule is gated out, so the system tier's include takes over —
        // "highest tier that CONTRIBUTED any", not "highest tier that has one".
        expect(mergeCandidates(candidates, (c) => c.matchSelectors.length === 0).includeSelectors)
            .toEqual(["#main"]);
    });

    it("defaults to applying every candidate when no predicate is given", () => {
        expect(mergeCandidates(selectCandidates(URL, tiers)).excludeSelectors)
            .toEqual([".always", ".sometimes"]);
    });
});
