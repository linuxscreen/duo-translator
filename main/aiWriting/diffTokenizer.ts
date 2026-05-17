import { diffArrays, type Change } from "diff";

/**
 * Tokenizer that produces sensible diff hunks for mixed-language text.
 *
 * `diffWords` from `jsdiff` splits on whitespace, which works fine for
 * European languages but treats an entire run of CJK characters as a single
 * token — meaning a one-character correction shows the whole sentence as
 * replaced. We split CJK character-by-character and group ASCII / numbers /
 * URLs as single tokens. Whitespace is preserved as its own token so the
 * renderer can decide whether to highlight it.
 */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

export function tokenizeMixed(input: string): string[] {
    if (!input) return [];
    const out: string[] = [];
    let i = 0;
    const len = input.length;
    while (i < len) {
        const ch = input[i];
        if (CJK_RE.test(ch)) {
            out.push(ch);
            i++;
            continue;
        }
        if (/\s/.test(ch)) {
            let j = i + 1;
            while (j < len && /\s/.test(input[j])) j++;
            out.push(input.slice(i, j));
            i = j;
            continue;
        }
        // Letters, digits, punctuation, symbols: greedy run of non-CJK,
        // non-whitespace characters of the same broad category.
        const isAlnum = (c: string) => /[A-Za-z0-9_\-']/.test(c);
        if (isAlnum(ch)) {
            let j = i + 1;
            while (j < len && isAlnum(input[j])) j++;
            out.push(input.slice(i, j));
            i = j;
            continue;
        }
        // Single non-alnum non-whitespace non-CJK character (punctuation).
        out.push(ch);
        i++;
    }
    return out;
}

export interface DiffPart {
    kind: "eq" | "ins" | "del";
    text: string;
}

/** Compute a token-level diff, returning a flat list of equal / insert / delete parts. */
export function diffTexts(original: string, rewritten: string): DiffPart[] {
    const a = tokenizeMixed(original);
    const b = tokenizeMixed(rewritten);
    const changes: Change[] = diffArrays(a, b);
    const parts: DiffPart[] = [];
    for (const c of changes) {
        const text = (c.value as string[]).join("");
        if (c.added) parts.push({ kind: "ins", text });
        else if (c.removed) parts.push({ kind: "del", text });
        else parts.push({ kind: "eq", text });
    }
    return parts;
}
