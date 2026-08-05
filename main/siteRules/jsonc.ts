// ---------------------------------------------------------------------------
// JSONC (JSON with comments) support for rule packages.
//
// Rule packages are hand-maintained: a rule is a list of opaque CSS selectors,
// and "why is this selector here" is exactly the kind of note that has to live
// next to the selector. Plain JSON has nowhere to put it, so every package we
// read — the bundled baseline, a fetched subscription, a user's import file —
// goes through `parseJsonc` instead of `JSON.parse`.
//
// Accepted beyond JSON: `//` line comments, block comments, and trailing commas
// before `}` / `]`. Nothing else — this is not JSON5, so unquoted keys and
// single-quoted strings still fail, and they fail with the exact message and
// offset JSON.parse would give (comments are blanked in place rather than
// removed, so every character keeps its original index).
//
// Pure module — no storage/DOM/fetch. Imported by background and by Options.
// ---------------------------------------------------------------------------

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/**
 * Replace comments with spaces and drop trailing commas, preserving the length
 * and line structure of the input so JSON.parse error offsets still point at
 * the right place in the original text.
 */
export function stripJsonComments(input: string): string {
    // A BOM is legal in a file but not in JSON.parse's grammar.
    const text = input.charCodeAt(0) === 0xfeff ? ' ' + input.slice(1) : input;
    const n = text.length;
    const out: string[] = new Array(n);
    // Index of a comma that has not yet been followed by a value; if the next
    // structural character turns out to be `}` or `]`, it was a trailing comma.
    let pendingComma = -1;
    let i = 0;

    while (i < n) {
        const c = text[i];

        if (c === '"') {
            // Copy the whole string literal verbatim; `//`, `/*` and `,` inside
            // it are data, not syntax.
            out[i] = c;
            i++;
            while (i < n) {
                const s = text[i];
                out[i] = s;
                i++;
                if (s === '\\') {
                    if (i < n) out[i] = text[i];
                    i++;
                } else if (s === '"') {
                    break;
                }
            }
            pendingComma = -1;
            continue;
        }

        if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') out[i++] = ' ';
            continue;
        }

        if (c === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            const stop = close < 0 ? n : close + 2; // unterminated: to end of input
            while (i < stop) {
                out[i] = text[i] === '\n' ? '\n' : ' ';
                i++;
            }
            continue;
        }

        if (c === ',') {
            pendingComma = i;
        } else if (c === '}' || c === ']') {
            if (pendingComma >= 0) out[pendingComma] = ' ';
            pendingComma = -1;
        } else if (!WHITESPACE.has(c)) {
            pendingComma = -1;
        }
        out[i] = c;
        i++;
    }

    return out.join('');
}

/** `JSON.parse` that also accepts comments and trailing commas. Throws the same errors. */
export function parseJsonc<T = unknown>(text: string): T {
    return JSON.parse(stripJsonComments(text)) as T;
}
