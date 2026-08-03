// URL pattern matching for website translation rules (main/siteRules/urlMatch.ts).
// Pure module — no DOM needed.
import { describe, it, expect, beforeEach } from "vitest";
import {
    clearPatternCache,
    compilePattern,
    isValidPattern,
    matchesAny,
    ruleMatchesUrl,
} from "@/main/siteRules/urlMatch";

beforeEach(() => clearPatternCache());

describe("glob patterns", () => {
    it("matches a scheme+host wildcard", () => {
        expect(matchesAny("https://github.com/a/b", ["*://github.com/*"])).toBe(true);
        expect(matchesAny("http://github.com/a/b", ["*://github.com/*"])).toBe(true);
    });

    it("matches a subdomain wildcard but not the bare domain without a match", () => {
        expect(matchesAny("https://news.example.com/x", ["*://*.example.com/*"])).toBe(true);
        expect(matchesAny("https://example.com/x", ["*://*.example.com/*"])).toBe(false);
    });

    it("* spans path separators", () => {
        expect(matchesAny("https://github.com/o/r/blob/main/a.ts", ["*://github.com/*/blob/*"])).toBe(true);
    });

    it("is anchored — a pattern is a full match, not a substring", () => {
        expect(matchesAny("https://github.com.evil.com/", ["*://github.com/*"])).toBe(false);
    });

    it("treats the leading * of `*://` as a scheme wildcard, not a free one", () => {
        // Were it free, `.*` would eat the whole prefix to reach the second
        // `://` and this open-redirect-looking URL would match.
        expect(matchesAny("https://evil.com/?u=https://github.com/", ["*://github.com/*"])).toBe(false);
    });

    it("is case-insensitive (hostnames are)", () => {
        expect(matchesAny("https://GitHub.com/a", ["*://github.com/*"])).toBe(true);
    });

    it("matches against the full href, so query and hash are covered by a trailing *", () => {
        expect(matchesAny("https://news.ycombinator.com/item?id=42", ["*://news.ycombinator.com/item*"])).toBe(true);
        expect(matchesAny("https://x.com/a#frag", ["*://x.com/a*"])).toBe(true);
        // …and are NOT covered without one.
        expect(matchesAny("https://x.com/a#frag", ["*://x.com/a"])).toBe(false);
    });

    it("treats regex metacharacters in a glob as literals", () => {
        expect(matchesAny("https://x.com/a+b", ["*://x.com/a+b"])).toBe(true);
        expect(matchesAny("https://x.com/aab", ["*://x.com/a+b"])).toBe(false);
        // A literal dot must not match an arbitrary character.
        expect(matchesAny("https://axcom/", ["*://x.com/*"])).toBe(false);
    });

    it("includes the port when the URL has one", () => {
        expect(matchesAny("http://localhost:5173/x", ["*://localhost:5173/*"])).toBe(true);
        expect(matchesAny("http://localhost:3000/x", ["*://localhost:5173/*"])).toBe(false);
    });
});

describe("regex patterns", () => {
    it("recognises /…/ and applies unanchored .test() semantics", () => {
        expect(matchesAny("https://zhihu.com/question/1", ["/zhihu\\.com\\/question/"])).toBe(true);
        expect(matchesAny("https://zhihu.com/people/1", ["/zhihu\\.com\\/question/"])).toBe(false);
    });

    it("honours flags", () => {
        expect(matchesAny("https://ZHIHU.com/q", ["/zhihu/"])).toBe(false);
        expect(matchesAny("https://ZHIHU.com/q", ["/zhihu/i"])).toBe(true);
    });

    it("does not carry .lastIndex across calls for a /g pattern", () => {
        const patterns = ["/github/g"];
        expect(matchesAny("https://github.com/a", patterns)).toBe(true);
        expect(matchesAny("https://github.com/a", patterns)).toBe(true);
    });

    it("a bare leading slash with no closing slash is treated as a glob", () => {
        // "/foo" is a path-looking string, not a regex literal. (RegExp.source
        // escapes the delimiter, hence `\/`.)
        expect(compilePattern("/foo")!.source).toBe("^\\/foo$");
        expect(compilePattern("/foo")!.flags).toBe("i");
    });
});

describe("malformed input never throws", () => {
    it("returns null for an unclosed group and for empty input", () => {
        expect(compilePattern("/(unclosed/")).toBeNull();
        expect(compilePattern("")).toBeNull();
        expect(compilePattern("   ")).toBeNull();
        expect(isValidPattern("/(/")).toBe(false);
        expect(isValidPattern("*://ok.com/*")).toBe(true);
    });

    it("skips the bad pattern and still matches on a good sibling", () => {
        expect(matchesAny("https://ok.com/x", ["/(/", "*://ok.com/*"])).toBe(true);
    });
});

describe("ruleMatchesUrl", () => {
    it("requires an include hit", () => {
        expect(ruleMatchesUrl("https://a.com/", ["*://a.com/*"], [])).toBe(true);
        expect(ruleMatchesUrl("https://b.com/", ["*://a.com/*"], [])).toBe(false);
    });

    it("lets excludeUrls veto an include hit", () => {
        expect(
            ruleMatchesUrl("https://github.com/settings/x", ["*://github.com/*"], ["*://github.com/settings/*"]),
        ).toBe(false);
    });

    it("treats an empty includeUrls as 'never matches', not 'matches everything'", () => {
        expect(ruleMatchesUrl("https://a.com/", [], [])).toBe(false);
        expect(ruleMatchesUrl("https://a.com/", [], ["*://b.com/*"])).toBe(false);
    });
});
