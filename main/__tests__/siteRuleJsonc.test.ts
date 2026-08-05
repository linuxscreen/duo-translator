import { describe, expect, it } from 'vitest';
import { parseJsonc, stripJsonComments } from '@/main/siteRules/jsonc';

describe('parseJsonc', () => {
    it('parses plain JSON unchanged', () => {
        expect(parseJsonc('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] });
    });

    it('strips line and block comments', () => {
        const text = `{
            // the id is required
            "id": "github", /* inline */
            /* multi
               line */
            "n": 1
        }`;
        expect(parseJsonc(text)).toEqual({ id: 'github', n: 1 });
    });

    it('allows trailing commas in objects and arrays', () => {
        expect(parseJsonc('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
        expect(parseJsonc('{"a":[1,2, /* c */ ],\n}')).toEqual({ a: [1, 2] });
    });

    it('never touches comment-looking or comma-looking text inside strings', () => {
        const value = parseJsonc('{"sel":"a[href*=\\"//x\\"], b /* not a comment */ ,"}');
        expect(value).toEqual({ sel: 'a[href*="//x"], b /* not a comment */ ,' });
    });

    it('keeps an escaped backslash from swallowing the closing quote', () => {
        expect(parseJsonc('{"a":"c:\\\\", "b": 1 /* c */}')).toEqual({ a: 'c:\\', b: 1 });
    });

    it('tolerates a BOM', () => {
        expect(parseJsonc('\uFEFF{"a":1}')).toEqual({ a: 1 });
    });

    it('preserves offsets and line structure so parse errors still point at the source', () => {
        const text = '{\n  // note\n  "a": oops\n}';
        const stripped = stripJsonComments(text);
        expect(stripped).toHaveLength(text.length);
        expect(stripped.split('\n')).toHaveLength(4);
        expect(() => JSON.parse(stripped)).toThrow();
    });

    it('is not JSON5 — unquoted keys and single quotes still fail', () => {
        expect(() => parseJsonc('{a: 1}')).toThrow();
        expect(() => parseJsonc("{'a': 1}")).toThrow();
    });
});
