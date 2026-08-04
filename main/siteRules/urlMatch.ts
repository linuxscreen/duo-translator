// ---------------------------------------------------------------------------
// URL pattern matching for website translation rules.
//
// The repo had no URL matching at all before this — utils/url.ts only reduces a
// URL to `hostname[:port]`, which is what the per-domain strategy and the old
// `rule_<host>` selector list key off. Rules need path/query granularity
// (`github.com/*/blob/*` vs `github.com/*/issues/*`), hence this module.
//
// Two syntaxes, distinguished by the first character:
//
//   glob     `*://*.github.com/*`   — `*` matches any run of characters,
//                                     including `/`. Anchored (full match),
//                                     case-insensitive. The scheme may be left
//                                     out (`github.com/*`), and a bare host
//                                     (`github.com`) means the whole site.
//   regex    `/^https:\/\/\w+\.zhihu\.com\/(question|p)\//i`
//                                   — leading `/`, trailing `/` + optional
//                                     flags. Unanchored (`.test()` semantics),
//                                     exactly like the author wrote it.
//
// Matching is against the FULL href (scheme, host, port, path, query, hash), so
// most patterns want a trailing `*`. Case-insensitivity for globs is deliberate:
// hostnames are case-insensitive and "GitHub.com" silently not matching is a
// support burden nobody wants.
//
// Pure module — imported by background. No storage, no DOM, no fetch.
// ---------------------------------------------------------------------------

/**
 * Compiled patterns, keyed by their source string.
 *
 * A rule set is re-matched on every page load and on every SPA route change, so
 * the same handful of patterns get compiled over and over without this. `null`
 * caches a *failed* compile so a malformed pattern is only reported once.
 */
const compiled = new Map<string, RegExp | null>();

const REGEX_FLAGS = /^[gimsuy]*$/;

/** Matches any single URL scheme, e.g. the `*` of `*://example.com/*`. */
const SCHEME_WILDCARD = '[a-zA-Z][a-zA-Z0-9+.\\-]*://';

/** Escape every regex metacharacter except `*`, which the caller turns into `.*`. */
function escapeGlob(source: string): string {
    return source.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile one pattern, or return `null` if it is malformed.
 *
 * Never throws: a single bad pattern in a subscription must not take the whole
 * rule set down with it (the old `rules.join(",")` path had exactly that
 * failure mode — one bad selector silently disabled every rule).
 */
export function compilePattern(pattern: string): RegExp | null {
    const source = pattern.trim();
    if (source === '') return null;

    const cached = compiled.get(source);
    if (cached !== undefined) return cached;

    let result: RegExp | null = null;
    try {
        if (source.startsWith('/') && source.lastIndexOf('/') > 0) {
            const end = source.lastIndexOf('/');
            const flags = source.slice(end + 1);
            const body = source.slice(1, end);
            if (body !== '' && REGEX_FLAGS.test(flags)) {
                result = new RegExp(body, flags);
            }
        } else {
            const glob = (s: string) => escapeGlob(s).replace(/\*/g, '.*');
            let prefix: string;
            let rest: string;
            const at = source.indexOf('://');
            if (at >= 0) {
                rest = source.slice(at + 3);
                const scheme = source.slice(0, at);
                // `*://` is a scheme wildcard, NOT a free wildcard. Compiling
                // that leading `*` to `.*` would make `*://github.com/*` match
                // `https://evil.com/?u=https://github.com/`, because `.*`
                // happily eats a whole URL to reach the second `://`.
                prefix = scheme === '*' ? SCHEME_WILDCARD : `${glob(scheme)}://`;
            } else {
                // No scheme written at all (`github.com/*`) — by far the most
                // natural way to type one of these, so imply the wildcard
                // rather than matching nothing.
                prefix = SCHEME_WILDCARD;
                rest = source;
            }
            // A bare host with no path (`github.com`) means the whole site.
            if (!rest.includes('/')) rest += '/*';
            result = new RegExp(`^${prefix}${glob(rest)}$`, 'i');
        }
    } catch {
        result = null;
    }

    compiled.set(source, result);
    return result;
}

/** True when `url` matches at least one of `patterns`. Malformed patterns are skipped. */
export function matchesAny(url: string, patterns: string[]): boolean {
    for (const p of patterns) {
        const re = compilePattern(p);
        // A regex literal carrying /g is stateful across .test() calls; reset it.
        if (re) {
            re.lastIndex = 0;
            if (re.test(url)) return true;
        }
    }
    return false;
}

/** True when `pattern` compiles. Used by the Options editor to validate input. */
export function isValidPattern(pattern: string): boolean {
    return compilePattern(pattern) !== null;
}

/**
 * Does this rule apply to this URL?
 *
 * `includeUrls` empty means "never matches" — an empty include list is almost
 * always a half-written rule, and treating it as "matches everything" would let
 * one typo apply a site's selectors to the entire web.
 */
export function ruleMatchesUrl(
    url: string,
    includeUrls: string[],
    excludeUrls: string[],
): boolean {
    if (includeUrls.length === 0) return false;
    if (!matchesAny(url, includeUrls)) return false;
    return !matchesAny(url, excludeUrls);
}

/** Test seam — drops the compile cache. */
export function clearPatternCache(): void {
    compiled.clear();
}
