// Addressing an element for the per-domain "no-translate area" rules, including
// elements inside shadow roots.
//
// A rule is stored as a plain string in `rule_<host>` and has two consumers:
// `document.querySelector` when rule mode re-applies the selection, and
// `el.matches(joined)` in the marking scan. Neither can name an element inside a
// shadow root: `querySelector` does not pierce, and `css-selector-generator`
// silently generates a selector relative to the *inferred* root — which for a
// shadow element is the ShadowRoot, producing a string that is ambiguous (or
// simply wrong) when evaluated against the document.
//
// So a shadow element is stored as a PATH of per-tree selectors:
//
//     <selector in document> >>> <selector in root 1> >>> … >>> <selector in root N>
//
// A rule with no ` >>> ` is a plain document selector — byte-identical to what
// this repo has always stored, so old rules keep working with no migration and
// no rewrite on load. `>>>` is not valid CSS, so it can never collide with a
// real selector. (It was Blink's old shadow-piercing combinator, which is why it
// reads naturally here.)
import getCssSelector from "css-selector-generator";
import { isShadowRoot } from "@/main/dom/shadowTraversal";

/** Separator between per-tree hops. Spaces included so it cannot appear inside a selector. */
export const SHADOW_PATH_SEP = " >>> ";

const SELECTOR_OPTIONS = {
    // Never build a selector out of our own classes — they come and go.
    selectors: ["id", "class", "tag"] as ("id" | "class" | "tag")[],
    blacklist: [".duo-*"],
};

/** Whether a stored rule addresses something inside a shadow root. */
export function isShadowRulePath(rule: string): boolean {
    return rule.includes(SHADOW_PATH_SEP);
}

/**
 * Serialize `el` to a storable rule.
 *
 * Elements in the document tree serialize exactly as before — no separator, no
 * behaviour change, and the result still goes into the joined `el.matches()`
 * string. Only a shadow element produces a path.
 */
export function serializeRuleSelector(el: Element): string {
    const hops: string[] = [];
    let current: Element | null = el;
    for (let depth = 0; current && depth < 32; depth++) {
        const root = current.getRootNode();
        // Generate within the element's OWN tree, then step out through the host
        // and repeat. Outermost hop ends up first.
        hops.unshift(getCssSelector(current, { ...SELECTOR_OPTIONS, root: root as ParentNode }));
        if (!isShadowRoot(root)) break;
        current = root.host;
    }
    return hops.join(SHADOW_PATH_SEP);
}

/**
 * Resolve a stored rule back to a live element. Returns null when any hop no
 * longer matches — a stale path must degrade to "no such element", never throw.
 */
export function resolveRuleSelector(rule: string): Element | null {
    const hops = rule.split(SHADOW_PATH_SEP);
    let scope: ParentNode | null = document;
    let found: Element | null = null;
    for (const hop of hops) {
        if (!scope) return null;
        try {
            found = scope.querySelector(hop);
        } catch {
            return null; // invalid selector — treat as a miss
        }
        if (!found) return null;
        scope = (found as HTMLElement).shadowRoot ?? null;
    }
    return found;
}

/**
 * Split stored rules into the two things the marking scan can actually consume.
 *
 * Plain selectors are joined into one string and evaluated per element with
 * `el.matches()` — which is tree-scope independent and therefore already works
 * on shadow elements. Path rules cannot go in there at all: `>>>` is illegal CSS
 * and ONE bad selector makes `matches()` throw for the whole string, silently
 * killing every rule on the page.
 */
export function partitionRules(rules: string[]): { plain: string[]; paths: string[] } {
    const plain: string[] = [];
    const paths: string[] = [];
    for (const rule of rules) {
        if (isShadowRulePath(rule)) paths.push(rule);
        else plain.push(rule);
    }
    return { plain, paths };
}

/**
 * Resolve every path rule to the element it currently names. Called once per
 * marking scan, never per element — the scan then does a single `Set.has`,
 * short-circuited on `size > 0` so pages without shadow rules pay nothing.
 */
export function resolveRulePaths(paths: string[]): Set<Element> {
    const out = new Set<Element>();
    for (const path of paths) {
        const el = resolveRuleSelector(path);
        if (el) out.add(el);
    }
    return out;
}
