// Wire protocol between the MAIN-world shadow bridge
// (entrypoints/shadow-bridge.content.ts) and the isolated-world content script.
//
// Dependency-free on purpose — the MAIN-world side imports this and nothing
// else, mirroring main/videoSubtitle/bridgeProtocol.ts.
//
// TWO channels, because neither one alone can do the job:
//
//   - `window.postMessage` is structured-cloned, so it CANNOT carry a node
//     reference. It is used only for the handshake.
//   - a `CustomEvent` dispatched ON the host can: both worlds observe the same
//     DOM node, so an isolated-world listener reads the real host out of
//     `event.composedPath()[0]`. `composed: true` is what makes that work when
//     the host itself lives inside another shadow root.

/**
 * MAIN → isolated. Dispatched on the host element that just got a root.
 *
 * No detail payload: the host node IS the message. (It used to carry
 * `forcedOpen` for closed roots the bridge had rewritten to open; that rewrite
 * is gone for good — see the header of entrypoints/shadow-bridge.content.ts.)
 */
export const SHADOW_ATTACH_EVENT = "duo:shadow-attached";

/** isolated → MAIN (postMessage). "I am listening; replay your buffer." */
export const SHADOW_BRIDGE_READY = "DUO_SHADOW_BRIDGE_READY";

/** MAIN → isolated (postMessage). "Patch installed." Absence ⇒ no late discovery. */
export const SHADOW_BRIDGE_HELLO = "DUO_SHADOW_BRIDGE_HELLO";
