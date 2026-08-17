// "What has to happen to this run?" — answered from our own bookkeeping.
//
// The pipeline used to answer it from the DOM alone: `TranslationUnit.translated`
// is true iff a `.duo-translation` sits inside the run. That signal is real but
// partial, and it fails in both directions:
//
//   - **SINGLE never produces it.** That view writes the translation into the
//     page's own text nodes and inserts no marker, so every re-scan sees fresh
//     work and sends the whole paragraph again — our own output going back out
//     as if it were source text.
//   - **A structural insert hides it.** Drop a block between the run and its
//     translation and the run flushes before the marker is reached, so the
//     signal goes false and the paragraph is translated a second time.
//
// Both are the same mistake: inferring a fact about *what we did* from *where
// our output happens to sit*. The records already know — they are keyed by
// container and they hold the text nodes each translation covers. This module
// asks them, and gets a third answer the boolean could never give: the run is
// one we translated, but it is no longer the run we translated.
//
// Why the comparison is structural (which text nodes) rather than textual (a
// serialization signature): the source of a SINGLE-translated unit no longer
// exists in the page, so there is nothing to serialize and compare against. Node
// identity survives both views. Content changes to a node that IS ours are a
// different event entirely — they arrive as `characterData` mutations, which
// content.ts handles on their own path.
import type { TranslationUnit } from "@/main/dom/segments";
import { directChildOf } from "@/main/dom/unitHit";
import { isNotMarkElement } from "@/main/dom/predicates";
import { contentValid } from "@/utils/dom";

/**
 * The shape of a bookkeeping record, seen from here.
 *
 * Three field names for one concept because the two views record it under their
 * own: `DuoUnitRecord.covered` is the run's source text nodes captured before
 * insertion, while a SINGLE `TranslateResult` keeps both the nodes it read
 * (`textNodes`) and the ones it wrote into (`replacedTextNodes`) — their union,
 * since the write-back reuses most but not all of them and may mint new ones.
 */
export interface CoverageRecord {
    covered?: readonly (Text | null | undefined)[];
    replacedTextNodes?: readonly (Text | null | undefined)[];
    textNodes?: readonly (Text | null | undefined)[];
}

/** What this unit needs, and — when it is a re-translation — what it supersedes. */
export type UnitPlan<D, S> =
    | { action: "translate" }
    | { action: "skip" }
    | { action: "replace"; duo?: D; single?: S };

/** Every text node a record accounts for, deduplicated. */
function coveredNodesOf(record: CoverageRecord): Text[] {
    const out = new Set<Text>();
    for (const list of [record.covered, record.replacedTextNodes, record.textNodes]) {
        if (!list) continue;
        for (const node of list) if (node) out.add(node);
    }
    return Array.from(out);
}

/** Whether `node` still belongs to `unit` — as one of its nodes or beneath one. */
function unitHoldsNode(unit: TranslationUnit, node: Node): boolean {
    if (!node.isConnected) return false;
    const child = directChildOf(node, unit.container);
    return child !== null && unit.nodes.includes(child);
}

/**
 * Does the run hold translatable text that `known` does not account for?
 *
 * This is the "the page added something" half of the comparison, and the only
 * part that walks. It early-exits on the first unaccounted-for node, and skips
 * everything we ourselves put into the run — on the `<duo-span>` highlight
 * fallback the wrappers hold the run's own text, so counting them would mark
 * every highlighted paragraph as changed forever.
 *
 * Shadow roots are deliberately not descended into: the covered set comes from
 * `getTextNodesAndTextOfNodes`, which does not cross the boundary either, so
 * doing it here would make every unit containing a component permanently
 * "changed".
 */
function holdsForeignText(unit: TranslationUnit, known: Set<Text>): boolean {
    const stack: Node[] = [...unit.nodes];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur.nodeType === Node.TEXT_NODE) {
            if (!known.has(cur as Text) && contentValid(cur)) return true;
            continue;
        }
        if (cur.nodeType !== Node.ELEMENT_NODE) continue;
        if (isNotMarkElement(cur as HTMLElement)) continue;
        stack.push(...cur.childNodes);
    }
    return false;
}

type RecordMatch = "unrelated" | "same" | "changed";

/**
 * How `record` relates to `unit`: not about it at all, about it and still
 * accurate, or about it but stale.
 *
 * A record matches the unit when any of its nodes is still there — the run may
 * well have grown or shrunk, and that is precisely the case worth naming. It is
 * "same" only when the accounting is exact in both directions.
 *
 * Only nodes that carry text have to still be there. A record's covered set is
 * built with `contentVisible`, so the whitespace between inline children is in
 * it too — and a framework re-render dropping one of those would otherwise read
 * as a changed run and cost a request for a cosmetic edit.
 */
function matchRecord(unit: TranslationUnit, record: CoverageRecord): RecordMatch {
    const nodes = coveredNodesOf(record);
    if (nodes.length === 0) return "unrelated";
    const held = nodes.filter((node) => unitHoldsNode(unit, node));
    // Whether this record is about this unit at all has to be settled before
    // anything is called missing — otherwise a sibling unit's record, none of
    // whose nodes are here, would report the whole run as changed.
    if (held.length === 0) return "unrelated";
    if (held.length < nodes.length && nodes.some((node) => contentValid(node) && !held.includes(node))) {
        return "changed";
    }
    return holdsForeignText(unit, new Set(nodes)) ? "changed" : "same";
}

/**
 * Decide what this unit needs.
 *
 * Both record lists come straight from the container-keyed maps in content.ts,
 * so the common case — a container we have never translated — costs two failed
 * Map lookups and nothing else.
 *
 * A run that carries a `.duo-translation` but matches no record ends up
 * "skip" as well. That is the pre-existing behavior kept deliberately: the
 * bookkeeping is gone (the page rebuilt the run's nodes, or a re-scan dropped
 * the records), and translating again would insert a second translation next to
 * one we can no longer take down.
 */
export function planUnit<D extends CoverageRecord, S extends CoverageRecord>(
    unit: TranslationUnit,
    duoRecords: readonly D[] | undefined,
    singleResults: readonly S[] | undefined,
): UnitPlan<D, S> {
    let staleDuo: D | undefined;
    let staleSingle: S | undefined;
    if (duoRecords) {
        for (const record of duoRecords) {
            const match = matchRecord(unit, record);
            if (match === "same") return { action: "skip" };
            if (match === "changed") staleDuo ??= record;
        }
    }
    if (singleResults) {
        for (const result of singleResults) {
            const match = matchRecord(unit, result);
            if (match === "same") return { action: "skip" };
            if (match === "changed") staleSingle ??= result;
        }
    }
    if (staleDuo || staleSingle) return { action: "replace", duo: staleDuo, single: staleSingle };
    if (unit.translated) return { action: "skip" };
    return { action: "translate" };
}
