// Element-level merging of collection keys (main/storage/collections.ts +
// the collection branch of mergeSnapshots / applyImportedSnapshot).
//
// The property under test: for a key whose value is an ARRAY of independent
// elements, two devices editing *different elements* must both keep their edit.
// The per-key LWW that used to run here resolved the whole array, so "device A
// added a provider" silently deleted "device B added a different provider".
//
// The mirror property matters just as much and is easy to break while fixing
// the first one: a DELETED element must not come back. That is what the element
// tombstones (and the seeding in configStore's elementMetaFor) are for.
import { describe, it, expect, beforeEach, vi } from "vitest";

let store: Record<string, unknown> = {};
const stripArea = (key: string) => key.replace(/^local:/, "");

// Values are cloned in and out, like the real chrome.storage: a caller must
// never end up holding a live reference into the store (the sync-meta reader
// below relies on reading an immutable copy).
const clone = <T,>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

vi.mock("wxt/utils/storage", () => ({
    storage: {
        snapshot: vi.fn(async (_area: string, opts?: { excludeKeys?: string[] }) => {
            const out: Record<string, unknown> = {};
            const skip = new Set(opts?.excludeKeys ?? []);
            for (const [k, v] of Object.entries(store)) if (!skip.has(k)) out[k] = clone(v);
            return out;
        }),
        setItems: vi.fn(async (items: { key: string; value: unknown }[]) => {
            for (const { key, value } of items) store[stripArea(key)] = clone(value);
        }),
        removeItems: vi.fn(async (keys: string[]) => {
            for (const k of keys) delete store[stripArea(k)];
        }),
        getItem: vi.fn(async (key: string) => clone(store[stripArea(key)] ?? null)),
        setItem: vi.fn(async (key: string, value: unknown) => {
            store[stripArea(key)] = clone(value);
        }),
        removeItem: vi.fn(async (key: string) => {
            delete store[stripArea(key)];
        }),
    },
}));

import {
    buildSnapshot,
    mergeSnapshots,
    applyMergedToLocal,
    applyImportedSnapshot,
    type Snapshot,
} from "@/main/storage/snapshot";
import {
    STORAGE_PREFIX,
    configRepo,
    ruleRepo,
    getSyncMeta,
    type ElementSyncMeta,
} from "@/main/storage/configStore";
import { collectionIdentity } from "@/main/storage/collections";
import { APP_NAME_KEBAB_CASE, CONFIG_KEY } from "@/main/constants";

const PROVIDERS = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AI_PROVIDERS}`;
const SUBS = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS}`;
const DISABLED = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.DISABLED_TRANSLATE_SERVICES}`;
const RULE_HOST = `${STORAGE_PREFIX.RULE}example.com`;
const TARGET_LANG = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.TARGET_LANGUAGE}`;

// Fixture clocks must sit inside the 60-day tombstone TTL — a fixed epoch
// constant would silently start getting garbage-collected as the calendar moves.
const T0 = Date.now() - 10 * 60 * 1000;
const p = (id: string, name = id) => ({ id, name, baseURL: "https://x", model: "m", apiKey: "" });

type Parts = {
    data?: Record<string, unknown>;
    meta?: Record<string, number>;
    tombstones?: Record<string, number>;
    elements?: Record<string, ElementSyncMeta>;
};

function snap(parts: Parts): Snapshot {
    return {
        app: APP_NAME_KEBAB_CASE,
        schemaVersion: 2,
        data: parts.data ?? {},
        meta: parts.meta ?? {},
        tombstones: parts.tombstones ?? {},
        ...(parts.elements ? { elements: parts.elements } : {}),
    };
}

/** Element metadata with every listed id clocked at `ts`. */
const em = (clocks: Record<string, number>, tombstones: Record<string, number> = {}): ElementSyncMeta => ({
    clocks,
    tombstones,
});

const ids = (value: unknown) => (value as { id: string }[]).map((e) => e.id);

beforeEach(() => {
    store = {};
});

describe("collectionIdentity registry", () => {
    it("identifies every array-valued config key plus the dynamic rule_ prefix", () => {
        expect(collectionIdentity(PROVIDERS)!(p("p1"))).toBe("p1");
        expect(collectionIdentity(`${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SITE_RULE_USER}`)!({ id: "r1" })).toBe("r1");
        // Subscriptions have no `id` field — the URL is the identity.
        expect(collectionIdentity(SUBS)!({ url: "https://a/rules.jsonc", enabled: true })).toBe(
            "https://a/rules.jsonc",
        );
        expect(collectionIdentity(`${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SITE_RULE_DISABLED_IDS}`)!("sys#gh")).toBe(
            "sys#gh",
        );
        expect(collectionIdentity(DISABLED)!("deepl")).toBe("deepl");
        expect(collectionIdentity(RULE_HOST)!(".ads")).toBe(".ads");
        expect(collectionIdentity(`${STORAGE_PREFIX.RULE}other.org`)).not.toBeNull();
    });

    it("leaves scalar and object-valued keys alone", () => {
        expect(collectionIdentity(TARGET_LANG)).toBeNull();
        expect(collectionIdentity(`${STORAGE_PREFIX.DOMAIN}example.com`)).toBeNull();
        expect(collectionIdentity(`${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.VIDEO_SUBTITLE_STYLE}`)).toBeNull();
    });

    it("returns no identity for corrupt elements", () => {
        const idOf = collectionIdentity(PROVIDERS)!;
        expect(idOf(null)).toBeNull();
        expect(idOf({ name: "no id" })).toBeNull();
        expect(idOf({ id: "" })).toBeNull();
        expect(collectionIdentity(DISABLED)!("")).toBeNull();
    });
});

describe("mergeSnapshots — collection keys", () => {
    it("keeps elements added independently on two devices", () => {
        const local = snap({
            data: { [PROVIDERS]: [p("p1"), p("p3")] },
            meta: { [PROVIDERS]: T0 + 300 },
            elements: { [PROVIDERS]: em({ p1: T0, p3: T0 + 300 }) },
        });
        const remote = snap({
            data: { [PROVIDERS]: [p("p1"), p("p4")] },
            meta: { [PROVIDERS]: T0 + 200 },
            elements: { [PROVIDERS]: em({ p1: T0, p4: T0 + 200 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect(ids(merged.data[PROVIDERS])).toEqual(["p1", "p3", "p4"]);
    });

    it("does not resurrect an element another device deleted", () => {
        // B deleted p1. A never saw that, and then edited p2 — which bumps A's
        // KEY clock past B's deletion. Under whole-key LWW p1 came back.
        const local = snap({
            data: { [PROVIDERS]: [p("p1"), p("p2", "renamed")] },
            meta: { [PROVIDERS]: T0 + 500 },
            elements: { [PROVIDERS]: em({ p1: T0, p2: T0 + 500 }) },
        });
        const remote = snap({
            data: { [PROVIDERS]: [p("p2")] },
            meta: { [PROVIDERS]: T0 + 100 },
            elements: { [PROVIDERS]: em({ p2: T0 }, { p1: T0 + 100 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect(ids(merged.data[PROVIDERS])).toEqual(["p2"]);
        // The local edit to p2 still wins.
        expect((merged.data[PROVIDERS] as any[])[0].name).toBe("renamed");
        expect(merged.elements![PROVIDERS].tombstones.p1).toBe(T0 + 100);
    });

    it("lets a re-add win over an older deletion", () => {
        const local = snap({
            data: { [PROVIDERS]: [p("p1", "re-added")] },
            meta: { [PROVIDERS]: T0 + 900 },
            elements: { [PROVIDERS]: em({ p1: T0 + 900 }) },
        });
        const remote = snap({
            data: { [PROVIDERS]: [] },
            meta: { [PROVIDERS]: T0 + 100 },
            elements: { [PROVIDERS]: em({}, { p1: T0 + 100 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect(ids(merged.data[PROVIDERS])).toEqual(["p1"]);
        expect(merged.elements![PROVIDERS].tombstones).toEqual({});
    });

    it("treats a whole-key deletion as a death event for every element it held", () => {
        // Local deleted rule_example.com entirely at T0+400. Remote still has
        // two selectors, last written at T0+100.
        const local = snap({
            tombstones: { [RULE_HOST]: T0 + 400 },
            elements: { [RULE_HOST]: em({}, { ".a": T0 + 400, ".b": T0 + 400 }) },
        });
        const remote = snap({
            data: { [RULE_HOST]: [".a", ".b"] },
            meta: { [RULE_HOST]: T0 + 100 },
            elements: { [RULE_HOST]: em({ ".a": T0 + 100, ".b": T0 + 100 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect(merged.data[RULE_HOST]).toBeUndefined();
        expect(merged.tombstones[RULE_HOST]).toBe(T0 + 400);
    });

    it("distinguishes an emptied-but-alive array from a deleted key", () => {
        const local = snap({
            data: { [DISABLED]: [] },
            meta: { [DISABLED]: T0 + 400 },
            elements: { [DISABLED]: em({}, { deepl: T0 + 400 }) },
        });
        const remote = snap({
            data: { [DISABLED]: ["deepl"] },
            meta: { [DISABLED]: T0 + 100 },
            elements: { [DISABLED]: em({ deepl: T0 + 100 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect(merged.data[DISABLED]).toEqual([]);
        expect(merged.tombstones[DISABLED]).toBeUndefined();
    });

    it("merges subscriptions on url, not id", () => {
        const a = { url: "https://a/r.jsonc", enabled: true, addedAt: T0 };
        const b = { url: "https://b/r.jsonc", enabled: true, addedAt: T0 };
        const local = snap({
            data: { [SUBS]: [a] },
            meta: { [SUBS]: T0 + 10 },
            elements: { [SUBS]: em({ [a.url]: T0 + 10 }) },
        });
        const remote = snap({
            data: { [SUBS]: [b] },
            meta: { [SUBS]: T0 + 20 },
            elements: { [SUBS]: em({ [b.url]: T0 + 20 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect((merged.data[SUBS] as any[]).map((s) => s.url)).toEqual([a.url, b.url]);
    });

    it("orders the result by element identity, independent of argument order", () => {
        const local = snap({
            data: { [PROVIDERS]: [p("zz"), p("aa")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ zz: T0, aa: T0 }) },
        });
        const remote = snap({
            data: { [PROVIDERS]: [p("mm")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ mm: T0 }) },
        });

        const forward = mergeSnapshots(local, remote).merged;
        const backward = mergeSnapshots(remote, local).merged;
        expect(ids(forward.data[PROVIDERS])).toEqual(["aa", "mm", "zz"]);
        expect(forward.data).toEqual(backward.data);
    });

    it("converges regardless of the order events arrive in", () => {
        // Three devices' snapshots; merging them in any pairing must agree.
        const a = snap({
            data: { [PROVIDERS]: [p("p1", "A")] },
            meta: { [PROVIDERS]: T0 + 300 },
            elements: { [PROVIDERS]: em({ p1: T0 + 300 }) },
        });
        const b = snap({
            data: { [PROVIDERS]: [p("p1", "B"), p("p2")] },
            meta: { [PROVIDERS]: T0 + 100 },
            elements: { [PROVIDERS]: em({ p1: T0 + 100, p2: T0 + 100 }) },
        });
        const c = snap({
            data: { [PROVIDERS]: [p("p3")] },
            meta: { [PROVIDERS]: T0 + 200 },
            elements: { [PROVIDERS]: em({ p3: T0 + 200 }) },
        });

        const abThenC = mergeSnapshots(mergeSnapshots(a, b).merged, c).merged;
        const cbThenA = mergeSnapshots(mergeSnapshots(c, b).merged, a).merged;
        const bcThenA = mergeSnapshots(mergeSnapshots(b, c).merged, a).merged;

        expect(abThenC.data).toEqual(cbThenA.data);
        expect(abThenC.data).toEqual(bcThenA.data);
        expect(ids(abThenC.data[PROVIDERS])).toEqual(["p1", "p2", "p3"]);
        // p1's newest edit (A) wins; whole-element LWW, by design.
        expect((abThenC.data[PROVIDERS] as any[])[0].name).toBe("A");
    });

    it("reports no change when both sides already agree", () => {
        const one = snap({
            data: { [PROVIDERS]: [p("p1"), p("p2")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ p1: T0, p2: T0 }) },
        });
        const { localChanged, remoteChanged } = mergeSnapshots(one, snap({
            data: { [PROVIDERS]: [p("p1"), p("p2")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ p1: T0, p2: T0 }) },
        }));
        expect(localChanged).toBe(false);
        expect(remoteChanged).toBe(false);
    });
});

describe("mergeSnapshots — mixed-version transition", () => {
    it("takes the union and deletes nothing when a peer has no element metadata", () => {
        // Remote was written by a client that predates element merging: it has
        // no `elements` section at all. Local believes p1 was deleted.
        const local = snap({
            data: { [PROVIDERS]: [p("p2")] },
            meta: { [PROVIDERS]: T0 + 400 },
            elements: { [PROVIDERS]: em({ p2: T0 + 400 }, { p1: T0 + 400 }) },
        });
        const remote = snap({
            data: { [PROVIDERS]: [p("p1"), p("p2")] },
            meta: { [PROVIDERS]: T0 + 100 },
        });

        const { merged } = mergeSnapshots(local, remote);
        // p1 comes back — a resurrection is the accepted failure here, silent
        // loss is not.
        expect(ids(merged.data[PROVIDERS])).toEqual(["p1", "p2"]);
        // ...but the deletion record survives, so it can still be applied once
        // the other device speaks the same protocol.
        expect(merged.elements![PROVIDERS].tombstones.p1).toBe(T0 + 400);
    });

    it("applies the deferred deletion on the next round, once both sides carry element metadata", () => {
        const local = snap({
            data: { [PROVIDERS]: [p("p2")] },
            meta: { [PROVIDERS]: T0 + 400 },
            elements: { [PROVIDERS]: em({ p2: T0 + 400 }, { p1: T0 + 400 }) },
        });
        const legacyRemote = snap({
            data: { [PROVIDERS]: [p("p1"), p("p2")] },
            meta: { [PROVIDERS]: T0 + 100 },
        });

        const first = mergeSnapshots(local, legacyRemote).merged;
        // Second round: `first` is now on both sides, element metadata and all.
        const second = mergeSnapshots(first, first).merged;
        expect(ids(second.data[PROVIDERS])).toEqual(["p2"]);
    });
});

describe("mergeSnapshots — degenerate values", () => {
    it("falls back to whole-key LWW when a collection value is not an array", () => {
        const local = snap({
            data: { [PROVIDERS]: "corrupt" },
            meta: { [PROVIDERS]: T0 + 500 },
        });
        const remote = snap({
            data: { [PROVIDERS]: [p("p1")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ p1: T0 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        expect(merged.data[PROVIDERS]).toBe("corrupt");
        expect(merged.elements![PROVIDERS]).toBeUndefined();
    });

    it("carries unidentifiable elements along with the whole-key winner", () => {
        const local = snap({
            data: { [PROVIDERS]: [p("p1"), { name: "no id" }] },
            meta: { [PROVIDERS]: T0 + 500 },
            elements: { [PROVIDERS]: em({ p1: T0 + 500 }) },
        });
        const remote = snap({
            data: { [PROVIDERS]: [p("p2")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ p2: T0 }) },
        });

        const { merged } = mergeSnapshots(local, remote);
        const out = merged.data[PROVIDERS] as any[];
        expect(out.filter((e) => e.id).map((e) => e.id)).toEqual(["p1", "p2"]);
        expect(out.at(-1)).toEqual({ name: "no id" });
    });

    it("emits nothing for a key whose last trace has aged out", () => {
        // Element tombstones past the 60-day TTL and no value on either side.
        // An empty element section here would not match what buildSnapshot
        // produces, and every later merge would report a phantom change.
        const ancient = Date.now() - 61 * 24 * 60 * 60 * 1000;
        const side = snap({ elements: { [PROVIDERS]: em({}, { p1: ancient }) } });

        const { merged, localChanged, remoteChanged } = mergeSnapshots(side, side);
        expect(merged.data[PROVIDERS]).toBeUndefined();
        expect(merged.tombstones[PROVIDERS]).toBeUndefined();
        expect(merged.elements![PROVIDERS]).toBeUndefined();
        expect(localChanged).toBe(true); // the aged-out tombstone is collected
        expect(remoteChanged).toBe(true);
        // ...and the collection settles immediately.
        expect(mergeSnapshots(merged, merged).localChanged).toBe(false);
    });

    it("still resolves non-collection keys by whole-key LWW", () => {
        const local = snap({ data: { [TARGET_LANG]: "ja" }, meta: { [TARGET_LANG]: T0 + 5 } });
        const remote = snap({ data: { [TARGET_LANG]: "de" }, meta: { [TARGET_LANG]: T0 } });
        expect(mergeSnapshots(local, remote).merged.data[TARGET_LANG]).toBe("ja");
    });
});

describe("configStore element bookkeeping", () => {
    it("clocks only the elements that actually changed", async () => {
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1"), p("p2")]);
        const first = (await getSyncMeta()).elements[PROVIDERS];
        expect(Object.keys(first.clocks).sort()).toEqual(["p1", "p2"]);

        await new Promise((r) => setTimeout(r, 2));
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1"), p("p2", "renamed"), p("p3")]);
        const second = (await getSyncMeta()).elements[PROVIDERS];

        expect(second.clocks.p1).toBe(first.clocks.p1); // untouched
        expect(second.clocks.p2).toBeGreaterThan(first.clocks.p2); // edited
        expect(second.clocks.p3).toBeGreaterThan(first.clocks.p1); // added
    });

    it("tombstones a removed element and clears it on re-add", async () => {
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1"), p("p2")]);
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p2")]);
        let meta = (await getSyncMeta()).elements[PROVIDERS];
        expect(meta.tombstones.p1).toBeGreaterThan(0);
        expect(meta.clocks.p1).toBeUndefined();

        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1"), p("p2")]);
        meta = (await getSyncMeta()).elements[PROVIDERS];
        expect(meta.tombstones.p1).toBeUndefined();
        expect(meta.clocks.p1).toBeGreaterThan(0);
    });

    it("seeds pre-existing elements with the key clock instead of leaving them clockless", async () => {
        // Simulates the upgrade: a value written before element tracking, with
        // only a key-level clock. Without the seed, the next unrelated edit
        // would make every old element look brand new.
        store[PROVIDERS] = [p("p1"), p("p2")];
        store["__sync_meta"] = { clocks: { [PROVIDERS]: T0 }, tombstones: {}, elements: {} };

        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1"), p("p2"), p("p3")]);
        const meta = (await getSyncMeta()).elements[PROVIDERS];
        expect(meta.clocks.p1).toBe(T0);
        expect(meta.clocks.p2).toBe(T0);
        expect(meta.clocks.p3).toBeGreaterThan(T0);
    });

    it("tombstones every selector when a rule host is emptied", async () => {
        await ruleRepo.add("example.com", ".a");
        await ruleRepo.add("example.com", ".b");
        await ruleRepo.deleteList("example.com", [".a", ".b"]);

        const meta = await getSyncMeta();
        expect(store[RULE_HOST]).toBeUndefined();
        expect(meta.tombstones[RULE_HOST]).toBeGreaterThan(0);
        expect(Object.keys(meta.elements[RULE_HOST].tombstones).sort()).toEqual([".a", ".b"]);
    });
});

describe("buildSnapshot / applyMergedToLocal round trip", () => {
    it("emits an element section for every collection key it carries", async () => {
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1")]);
        await configRepo.set(CONFIG_KEY.TARGET_LANGUAGE, "ja");
        await ruleRepo.add("example.com", ".ads");

        const built = await buildSnapshot({ includeSecrets: true });
        expect(Object.keys(built.elements!).sort()).toEqual([RULE_HOST, PROVIDERS].sort());
        expect(built.elements![PROVIDERS].clocks.p1).toBeGreaterThan(0);
        expect(built.elements![TARGET_LANG]).toBeUndefined();
    });

    it("applies a remote-only element and persists its clock", async () => {
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1")]);
        const local = await buildSnapshot({ includeSecrets: true });
        const remote = snap({
            data: { [PROVIDERS]: [p("p9")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ p9: T0 }) },
        });

        const { merged, localChanged } = mergeSnapshots(local, remote);
        expect(localChanged).toBe(true);
        await applyMergedToLocal(merged);

        expect(ids(store[PROVIDERS])).toEqual(["p1", "p9"]);
        const meta = await getSyncMeta();
        expect(meta.elements[PROVIDERS].clocks.p9).toBe(T0);
        expect(meta.elements[PROVIDERS].clocks.p1).toBeGreaterThan(0);
    });

    it("settles: re-merging the applied result changes nothing", async () => {
        await configRepo.set(CONFIG_KEY.AI_PROVIDERS, [p("p1")]);
        const remote = snap({
            data: { [PROVIDERS]: [p("p9")] },
            meta: { [PROVIDERS]: T0 },
            elements: { [PROVIDERS]: em({ p9: T0 }) },
        });
        const first = mergeSnapshots(await buildSnapshot({ includeSecrets: true }), remote).merged;
        await applyMergedToLocal(first);

        const again = mergeSnapshots(await buildSnapshot({ includeSecrets: true }), first);
        expect(again.localChanged).toBe(false);
        expect(again.remoteChanged).toBe(false);
    });
});

describe("applyImportedSnapshot — collections are unioned, never replaced", () => {
    it("keeps local providers a backup does not mention", async () => {
        store[PROVIDERS] = [
            { ...p("p1"), apiKey: "sk-local" },
            { ...p("p2"), apiKey: "sk-local-2" },
        ];
        await applyImportedSnapshot(snap({ data: { [PROVIDERS]: [p("p9")] } }));

        const out = store[PROVIDERS] as any[];
        expect(ids(out).sort()).toEqual(["p1", "p2", "p9"]);
        expect(out.find((e) => e.id === "p1").apiKey).toBe("sk-local");
    });

    it("lets the file's version of a shared element win", async () => {
        store[PROVIDERS] = [{ ...p("p1", "old name"), apiKey: "sk-local" }];
        await applyImportedSnapshot(snap({ data: { [PROVIDERS]: [p("p1", "new name")] } }));

        const out = store[PROVIDERS] as any[];
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe("new name");
        expect(out[0].apiKey).toBe("sk-local");
    });

    it("unions string collections and per-host rules without duplicating", async () => {
        store[DISABLED] = ["deepl", "google"];
        store[RULE_HOST] = [".local-only"];
        await applyImportedSnapshot(
            snap({ data: { [DISABLED]: ["deepl"], [RULE_HOST]: [".from-file"] } }),
        );

        expect(store[DISABLED]).toEqual(["deepl", "google"]);
        expect(store[RULE_HOST]).toEqual([".from-file", ".local-only"]);
    });

    it("clocks every imported element so it propagates on the next sync", async () => {
        store[PROVIDERS] = [p("p1")];
        await applyImportedSnapshot(snap({ data: { [PROVIDERS]: [p("p9")] } }));

        const meta = await getSyncMeta();
        expect(Object.keys(meta.elements[PROVIDERS].clocks).sort()).toEqual(["p1", "p9"]);
    });
});
