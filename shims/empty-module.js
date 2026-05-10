// Empty shim used to replace modules that packages mark as `false`
// in their `browser` field (e.g. immediate/lib/nextTick).
// Vite 8 replaces such modules with a throwing Proxy by default,
// which breaks code that does feature-detection like `mod && mod.test`.
export default {};
