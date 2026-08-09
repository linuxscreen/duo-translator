// WebDAV Basic auth header encoding (main/storage/sync/webdavProvider.ts).
//
// Credentials are free-form user input. `btoa` only accepts Latin-1, so a bare
// btoa over the raw string throws InvalidCharacterError on a CJK password or an
// accented username — and since every WebDAV verb (PROPFIND / MKCOL / GET /
// PUT / DELETE) builds its header here, that throw disables the whole provider.
import { describe, it, expect } from "vitest";
import { basicAuth } from "@/main/storage/sync/webdavProvider";

/** Decode `Basic <b64>` back to the original UTF-8 credential string. */
function decode(header: string): string {
    const b64 = header.replace(/^Basic /, "");
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

describe("basicAuth", () => {
    it("encodes plain ASCII credentials", () => {
        // Fixed vector from RFC 7617.
        expect(basicAuth("Aladdin", "open sesame")).toBe("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
    });

    it("does not throw on a non-ASCII password", () => {
        expect(() => basicAuth("user", "密码123")).not.toThrow();
    });

    it("round-trips a CJK password as UTF-8", () => {
        expect(decode(basicAuth("user", "密码123"))).toBe("user:密码123");
    });

    it("round-trips an accented username", () => {
        expect(decode(basicAuth("mül1er", "Paßwort"))).toBe("mül1er:Paßwort");
    });

    it("round-trips characters outside the BMP", () => {
        expect(decode(basicAuth("user", "pw🔑"))).toBe("user:pw🔑");
    });

    it("keeps the first colon as the separator when the password contains one", () => {
        const decoded = decode(basicAuth("user", "a:b"));
        expect(decoded).toBe("user:a:b");
        expect(decoded.slice(0, decoded.indexOf(":"))).toBe("user");
    });
});
