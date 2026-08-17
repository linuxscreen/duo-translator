// Deterministic JSON serialization, shared by the snapshot merge (value
// equality + tie-breaking) and the configStore element-diff bookkeeping.
//
// Lives in its own module so configStore and snapshot can both use it without
// importing each other.

/** Deterministic stringify input (object keys sorted; array order preserved). */
function sortDeep(v: any): any {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
        const out: Record<string, any> = {};
        for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
        return out;
    }
    return v;
}

/** Deterministic stringify — equal values always produce equal strings. */
export function stableStr(v: unknown): string {
    return JSON.stringify(sortDeep(v));
}
