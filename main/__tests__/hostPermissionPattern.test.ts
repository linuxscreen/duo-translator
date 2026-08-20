// Host-permission match patterns (utils/url.ts).
//
// The single rule these pin: the pattern must NOT carry a port. Chromium
// accepts a port as a private extension to the match-pattern grammar, so
// building the pattern from `URL.origin` looked correct there — while Safari
// rejected it outright ("not a valid pattern") and Firefox accepted, stored and
// then matched nothing with it (Bugzilla 1362809), turning a permission problem
// into a CORS failure several layers away. The bug only showed on urls with an
// explicit port, i.e. LAN / self-hosted WebDAV, which is why it survived every
// ordinary https test.
import { describe, it, expect } from "vitest";
import { hostPermissionPattern, legacyHostPermissionPattern } from "@/utils/url";

describe("hostPermissionPattern", () => {
    it("drops an explicit port — the whole point", () => {
        expect(hostPermissionPattern("http://192.168.123.10:6065/dav/"))
            .toBe("http://192.168.123.10/*");
        expect(hostPermissionPattern("https://dav.example.com:5006/remote.php"))
            .toBe("https://dav.example.com/*");
    });

    it("is unchanged for a default port, which is why the bug stayed hidden", () => {
        expect(hostPermissionPattern("https://dav.example.com/remote.php/dav"))
            .toBe("https://dav.example.com/*");
        expect(hostPermissionPattern("http://dav.example.com/dav")).toBe("http://dav.example.com/*");
    });

    it("keeps the scheme and ignores path, query and hash", () => {
        expect(hostPermissionPattern("https://h.example.com/a/b?q=1#f")).toBe("https://h.example.com/*");
    });

    it("returns null for input a URL parser rejects", () => {
        expect(hostPermissionPattern("not a url")).toBeNull();
        expect(hostPermissionPattern("")).toBeNull();
    });

    it("returns null when there is no host to grant against", () => {
        // `about:blank` parses, but its hostname is empty — a pattern built from
        // it would be nonsense rather than merely narrow.
        expect(hostPermissionPattern("about:blank")).toBeNull();
    });
});

describe("legacyHostPermissionPattern", () => {
    it("reproduces the old URL.origin form for a ported url", () => {
        expect(legacyHostPermissionPattern("http://192.168.123.10:6065/dav/"))
            .toBe("http://192.168.123.10:6065/*");
    });

    it("returns null when the url has no explicit port", () => {
        // Old and new patterns are identical there, so there is nothing extra to
        // recognise and the caller must not spend a second permissions.contains.
        expect(legacyHostPermissionPattern("https://dav.example.com/dav")).toBeNull();
    });

    it("returns null for unparseable input", () => {
        expect(legacyHostPermissionPattern("not a url")).toBeNull();
    });
});
