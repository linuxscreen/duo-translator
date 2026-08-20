import { APP_NAME_WITH_SUFFIX } from "@/main/constants";

/**
 * get domain with port from url
 * @param url
 */
export function getDomainWithPortFromUrl(url: string) {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.port !== "") {
            return parsedUrl.hostname + ':' + parsedUrl.port; // For non-standard ports, we need to add a port number
        }
        return parsedUrl.hostname; // only get the domain name
    } catch (error) {
        console.log(APP_NAME_WITH_SUFFIX, 'Invalid URL:', error);
        return "";
    }
}

/**
 * The host-permission match pattern for `url`, or null when the url is unusable.
 *
 * The port is deliberately DROPPED, and that is the whole point of this helper.
 * A match pattern's host may not carry a port: Chromium accepts one as a private
 * extension to the grammar (and then matches ONLY that port), while the two
 * standards-following engines fail in opposite, equally unhelpful ways —
 *
 *   Safari  rejects the pattern outright: "'http://192.168.1.10:6065/*' is not a
 *           valid pattern", thrown from permissions.request().
 *   Firefox neither rejects nor matches (Bugzilla 1362809): it stores the grant,
 *           permissions.request() AND permissions.contains() both report success,
 *           and the permission is inert. The failure then surfaces much later and
 *           somewhere else, as a CORS-blocked fetch — "NetworkError when
 *           attempting to fetch resource" — which points nowhere near permissions.
 *
 * Building the pattern from `URL.origin` (what this replaces) put the port in
 * whenever it was not the scheme default, so the bug was invisible for ordinary
 * https hosts and hit exactly the LAN / self-hosted case.
 *
 * A pattern without a port matches EVERY port on that host. That is broader than
 * we need and is also the only thing the grammar can express.
 */
export function hostPermissionPattern(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (!parsed.hostname) return null;
        return `${parsed.protocol}//${parsed.hostname}/*`;
    } catch {
        return null;
    }
}

/**
 * The pattern this code used to build — `URL.origin`, port included.
 *
 * Only ever used to RECOGNISE a grant an older build already obtained, never to
 * request one, and only on Chromium (see `IS_CHROMIUM` at the call site): there
 * the port form is honoured, so those users hold a real, working permission and
 * must not be asked to reconnect. Returns null when the url has no explicit
 * port, i.e. when the old and new patterns were identical anyway.
 */
export function legacyHostPermissionPattern(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (!parsed.port) return null;
        return `${parsed.origin}/*`;
    } catch {
        return null;
    }
}
