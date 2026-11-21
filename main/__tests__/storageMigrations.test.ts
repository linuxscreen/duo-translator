// Storage migrations (main/storage/migrations + migrationWriter in configStore).
//
// Two properties are under test, and a version number only buys the first:
//
//  1. each migration runs ONCE per device, in order, and a run that is cut
//     short can be repeated without changing the outcome;
//  2. a migration running on several devices at different times never
//     overrules what the user did in between. That is what the fixed `epoch`
//     clock is for, and it is asserted through mergeSnapshots in both arrival
//     orders — the merge is where a wrong clock would do its damage.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let store: Record<string, unknown> = {};
const stripArea = (key: string) => key.replace(/^local:/, "");

// Cloned in and out, like the real chrome.storage.
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

// syncManager talks to these two; neither can load outside a browser.
const remoteState: { snapshot: unknown; pushed: unknown; duringPull: (() => Promise<void>) | null } = {
    snapshot: null,
    pushed: null,
    duringPull: null,
};
vi.mock("@/main/storage/sync/webdavProvider", () => ({
    webdavProvider: {
        id: "webdav",
        isAuthenticated: async () => true,
        pull: async () => {
            await remoteState.duringPull?.();
            return clone(remoteState.snapshot);
        },
        push: async (snapshot: unknown) => {
            remoteState.pushed = clone(snapshot);
        },
    },
}));
vi.mock("@/main/storage/sync/googleDriveProvider", () => ({ googleDriveProvider: {} }));

import { storage } from "wxt/utils/storage";
import { applyMergedToLocal, buildSnapshot, mergeSnapshots, type Snapshot } from "@/main/storage/snapshot";
import { STORAGE_PREFIX, configRepo, getSyncMeta, type SyncMeta } from "@/main/storage/configStore";
import { runMigrationList } from "@/main/storage/migrations/runner";
import { MIGRATIONS, runMigrations } from "@/main/storage/migrations";
import type { Migration, MigrationContext } from "@/main/storage/migrations/types";
import { syncNow } from "@/main/storage/sync/syncManager";
import { APP_NAME_KEBAB_CASE, CONFIG_KEY, SYNC_PROVIDER_ID, TRANSLATE_SERVICE } from "@/main/constants";

const DISABLED = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.DISABLED_TRANSLATE_SERVICES}`;
const TARGET_LANG = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.TARGET_LANGUAGE}`;
const VERSION = "__storage_schema_version";
const META = "__sync_meta";

// Relative to now, not fixed: tombstones are garbage-collected after 60 days,
// and the user's edits in these tests are stamped with the real clock — which
// has to land AFTER the epoch, as it does for a real release.
const EPOCH = Date.now() - 5 * 60 * 1000;
const OLD = EPOCH - 5 * 60 * 1000;

const meta = (parts: Partial<SyncMeta>): SyncMeta => ({
    clocks: {},
    tombstones: {},
    elements: {},
    ...parts,
});

/** A migration at EPOCH whose body is the given function. */
const migration = (version: number, run: (ctx: MigrationContext) => Promise<void>, epoch = EPOCH): Migration => ({
    version,
    name: `test-${version}`,
    epoch,
    run,
});

const addBaidu = (version = 1) => migration(version, async (ctx) => {
    await ctx.addElement(DISABLED, "baidu");
});

/** A device whose stored list predates the migration, clocked at OLD. */
const legacyDevice = (list: string[] = ["deepl"]): Record<string, unknown> => ({
    [DISABLED]: list,
    [META]: meta({ clocks: { [DISABLED]: OLD } }),
});

beforeEach(() => {
    store = {};
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("runner", () => {
    it("applies every migration in order on a device with no version, advancing it one by one", async () => {
        const seen: [number, unknown][] = [];
        const record = (v: number) => migration(v, async () => {
            seen.push([v, store[VERSION]]);
        });
        await runMigrationList([record(1), record(2), record(3)]);
        // Each one saw the version its predecessor left behind.
        expect(seen).toEqual([[1, undefined], [2, 1], [3, 2]]);
        expect(store[VERSION]).toBe(3);
    });

    it("skips what this device already applied", async () => {
        store[VERSION] = 2;
        const ran: number[] = [];
        const record = (v: number) => migration(v, async () => {
            ran.push(v);
        });
        await runMigrationList([record(1), record(2), record(3)]);
        expect(ran).toEqual([3]);
        expect(store[VERSION]).toBe(3);
    });

    it("does nothing, and keeps the stored version, when it is ahead of the code", async () => {
        store[VERSION] = 9;
        const run = vi.fn(async () => {});
        await runMigrationList([migration(1, run), migration(2, run)]);
        expect(run).not.toHaveBeenCalled();
        expect(store[VERSION]).toBe(9);
    });

    it("stops the chain at a failure and resumes from it on the next call", async () => {
        const ran: number[] = [];
        let broken = true;
        const list = [
            migration(1, async () => {
                ran.push(1);
            }),
            migration(2, async () => {
                ran.push(2);
                if (broken) throw new Error("boom");
            }),
            migration(3, async () => {
                ran.push(3);
            }),
        ];
        await expect(runMigrationList(list)).resolves.toBeUndefined();
        expect(ran).toEqual([1, 2]);
        expect(store[VERSION]).toBe(1);

        broken = false;
        await runMigrationList(list);
        expect(ran).toEqual([1, 2, 2, 3]);
        expect(store[VERSION]).toBe(3);
    });

    it("keeps the clock of what a migration wrote before it failed", async () => {
        store = legacyDevice();
        await runMigrationList([
            migration(1, async (ctx) => {
                await ctx.addElement(DISABLED, "baidu");
                throw new Error("boom");
            }),
        ]);
        expect(store[VERSION]).toBeUndefined();
        expect(store[DISABLED]).toEqual(["deepl", "baidu"]);
        // A value without its clock would be dated OLD at the next sync.
        expect((await getSyncMeta()).elements[DISABLED].clocks.baidu).toBe(EPOCH);
    });

    it("is byte-for-byte repeatable when the version was never recorded", async () => {
        store = legacyDevice();
        const list = [
            migration(1, async (ctx) => {
                await ctx.addElement(DISABLED, "baidu");
                await ctx.removeElement(DISABLED, "deepl");
                await ctx.setIfOlder(TARGET_LANG, "ja");
            }),
        ];
        await runMigrationList(list);
        const first = clone(store);

        // The process died after the sync-meta landed, before the version did.
        delete store[VERSION];
        await runMigrationList(list);
        expect(store).toEqual(first);
    });

    it("runs once when asked twice at the same time", async () => {
        const run = vi.fn(async () => {});
        const list = [migration(1, run)];
        await Promise.all([runMigrationList(list), runMigrationList(list)]);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("never rejects, even when storage itself fails", async () => {
        vi.mocked(storage.getItem).mockRejectedValueOnce(new Error("storage down"));
        const run = vi.fn(async () => {});
        await expect(runMigrationList([migration(1, run)])).resolves.toBeUndefined();
        expect(run).not.toHaveBeenCalled();
        expect(store[VERSION]).toBeUndefined();
    });

    it("does not record the version when the sync-meta could not be saved", async () => {
        store = legacyDevice();
        const setItem = vi.mocked(storage.setItem);
        const real = setItem.getMockImplementation()!;
        setItem.mockImplementation(async (key, value) => {
            if (key === `local:${META}`) throw new Error("quota");
            return real(key, value);
        });
        try {
            await runMigrationList([addBaidu()]);
        } finally {
            setItem.mockImplementation(real);
        }
        // "Applied" with the clocks missing could never be put right: the
        // migration would not run again to stamp them.
        expect(store[VERSION]).toBeUndefined();

        await runMigrationList([addBaidu()]);
        expect(store[VERSION]).toBe(1);
        expect((await getSyncMeta()).elements[DISABLED].clocks.baidu).toBe(EPOCH);
    });

    it("does not touch the sync-meta for a migration that wrote nothing synced", async () => {
        await runMigrationList([
            migration(1, async (ctx) => {
                await ctx.local.set("__some_cache", { v: 2 });
            }),
        ]);
        expect(store[META]).toBeUndefined();
        expect(store.__some_cache).toEqual({ v: 2 });
        expect(store[VERSION]).toBe(1);
    });
});

describe("what a migration may touch", () => {
    /** Runs `body` as a migration and returns what it threw, if anything. */
    async function failureOf(body: (ctx: MigrationContext) => Promise<unknown>): Promise<string | null> {
        let message: string | null = null;
        await runMigrationList([
            migration(1, async (ctx) => {
                try {
                    await body(ctx);
                } catch (e) {
                    message = (e as Error).message;
                    throw e;
                }
            }),
        ]);
        return message;
    }

    it("refuses a synced key through ctx.local — that write would carry no clock", async () => {
        expect(await failureOf((ctx) => ctx.local.set(DISABLED, []))).toMatch(/synced key/);
        expect(store[DISABLED]).toBeUndefined();
        expect(store[VERSION]).toBeUndefined();
    });

    it("refuses a device-local key through the clocked writers", async () => {
        expect(await failureOf((ctx) => ctx.setIfOlder("__sync_active_provider", "webdav"))).toMatch(/not a synced key/);
        expect(await failureOf((ctx) => ctx.get("__sync_meta"))).toMatch(/not a synced key/);
    });

    it("refuses a whole-key write to a collection key — it would resolve the array as one value", async () => {
        expect(await failureOf((ctx) => ctx.setIfOlder(DISABLED, ["baidu"]))).toMatch(/collection key/);
        expect(await failureOf((ctx) => ctx.removeIfOlder(DISABLED))).toMatch(/collection key/);
    });

    it("refuses an element write to a key that is not a collection", async () => {
        expect(await failureOf((ctx) => ctx.addElement(TARGET_LANG, "ja"))).toMatch(/not a collection key/);
        expect(await failureOf((ctx) => ctx.removeElement(TARGET_LANG, "ja"))).toMatch(/not a collection key/);
    });

    it("refuses an epoch that is not a timestamp", async () => {
        await runMigrationList([migration(1, async () => {}, Number.NaN)]);
        expect(store[VERSION]).toBeUndefined();
    });
});

describe("clock rules: collection elements", () => {
    it("stamps the element and the key with the epoch, not with the current time", async () => {
        store = legacyDevice(["deepl", "azure"]);
        await runMigrationList([addBaidu()]);

        expect(store[DISABLED]).toEqual(["deepl", "azure", "baidu"]);
        const m = await getSyncMeta();
        expect(m.clocks[DISABLED]).toBe(EPOCH);
        // The elements that were already there keep the key's old clock: a
        // peer's deletion of one of them must still be newer than they are.
        expect(m.elements[DISABLED].clocks).toEqual({ deepl: OLD, azure: OLD, baidu: EPOCH });
    });

    it("never moves the key clock backwards", async () => {
        const recent = EPOCH + 60_000;
        store = { [DISABLED]: ["deepl"], [META]: meta({ clocks: { [DISABLED]: recent } }) };
        await runMigrationList([addBaidu()]);

        // The user touched ANOTHER element after the epoch. That says nothing
        // about this one, so it is added — but dated at the epoch.
        expect(store[DISABLED]).toEqual(["deepl", "baidu"]);
        const m = await getSyncMeta();
        expect(m.clocks[DISABLED]).toBe(recent);
        expect(m.elements[DISABLED].clocks).toEqual({ deepl: recent, baidu: EPOCH });
    });

    it("leaves alone an element the user removed after the epoch", async () => {
        const removedAt = EPOCH + 60_000;
        store = {
            [DISABLED]: ["deepl"],
            [META]: meta({
                clocks: { [DISABLED]: removedAt },
                elements: { [DISABLED]: { clocks: { deepl: OLD }, tombstones: { baidu: removedAt } } },
            }),
        };
        const before = clone(store);
        let wrote: boolean | undefined;
        await runMigrationList([
            migration(1, async (ctx) => {
                wrote = await ctx.addElement(DISABLED, "baidu");
            }),
        ]);
        expect(wrote).toBe(false);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });

    it("adds back an element whose removal predates the epoch", async () => {
        store = {
            [DISABLED]: ["deepl"],
            [META]: meta({
                clocks: { [DISABLED]: OLD },
                elements: { [DISABLED]: { clocks: { deepl: OLD }, tombstones: { baidu: OLD } } },
            }),
        };
        await runMigrationList([addBaidu()]);
        expect(store[DISABLED]).toEqual(["deepl", "baidu"]);
        expect((await getSyncMeta()).elements[DISABLED]).toEqual({
            clocks: { deepl: OLD, baidu: EPOCH },
            tombstones: {},
        });
    });

    it("treats a key deleted after the epoch as a deletion of every element", async () => {
        store = { [META]: meta({ tombstones: { [DISABLED]: EPOCH + 60_000 } }) };
        const before = clone(store);
        await runMigrationList([addBaidu()]);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });

    it("removes an element that is older than the epoch, leaving a tombstone at the epoch", async () => {
        store = legacyDevice(["deepl", "azure"]);
        let wrote: boolean | undefined;
        await runMigrationList([
            migration(1, async (ctx) => {
                wrote = await ctx.removeElement(DISABLED, "azure");
            }),
        ]);
        expect(wrote).toBe(true);
        expect(store[DISABLED]).toEqual(["deepl"]);
        const m = await getSyncMeta();
        expect(m.elements[DISABLED]).toEqual({ clocks: { deepl: OLD }, tombstones: { azure: EPOCH } });
        expect(m.clocks[DISABLED]).toBe(EPOCH);
    });

    it("keeps an element the user added after the epoch", async () => {
        const addedAt = EPOCH + 60_000;
        store = {
            [DISABLED]: ["deepl", "azure"],
            [META]: meta({
                clocks: { [DISABLED]: addedAt },
                elements: { [DISABLED]: { clocks: { deepl: OLD, azure: addedAt }, tombstones: {} } },
            }),
        };
        const before = clone(store);
        await runMigrationList([
            migration(1, async (ctx) => {
                await ctx.removeElement(DISABLED, "azure");
            }),
        ]);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });

    it("dates an element that has no clock of its own by the key's, as the merge does", async () => {
        // No element bucket yet: all that is known is that the list was written
        // after the epoch, and this element may be what that write added.
        store = { [DISABLED]: ["deepl", "azure"], [META]: meta({ clocks: { [DISABLED]: EPOCH + 60_000 } }) };
        const before = clone(store);
        let wrote: boolean | undefined;
        await runMigrationList([
            migration(1, async (ctx) => {
                wrote = await ctx.removeElement(DISABLED, "azure");
            }),
        ]);
        expect(wrote).toBe(false);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });

    it("claims an element that already is as the migration wants it", async () => {
        store = legacyDevice(["deepl", "baidu"]);
        const results: boolean[] = [];
        await runMigrationList([
            migration(1, async (ctx) => {
                results.push(await ctx.addElement(DISABLED, "baidu"));
                results.push(await ctx.removeElement(DISABLED, "azure"));
            }),
        ]);
        // The value did not need changing; the decision is recorded all the same.
        expect(results).toEqual([true, true]);
        expect(store[DISABLED]).toEqual(["deepl", "baidu"]);
        expect((await getSyncMeta()).elements[DISABLED]).toEqual({
            clocks: { deepl: OLD, baidu: EPOCH },
            tombstones: { azure: EPOCH },
        });
    });

    it("records nothing for a removal from a list that is not stored", async () => {
        let wrote: boolean | undefined;
        await runMigrationList([
            migration(1, async (ctx) => {
                wrote = await ctx.removeElement(DISABLED, "azure");
            }),
        ]);
        expect(wrote).toBe(false);
        expect(store).toEqual({ [VERSION]: 1 });
    });

    it("leaves a corrupt (non-array) value alone", async () => {
        store = { [DISABLED]: "deepl", [META]: meta({ clocks: { [DISABLED]: OLD } }) };
        const before = clone(store);
        await runMigrationList([addBaidu()]);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });
});

describe("clock rules: whole keys", () => {
    const setLang = (value: string) => migration(1, async (ctx) => {
        await ctx.setIfOlder(TARGET_LANG, value);
    });

    it("writes a key with no history, stamped with the epoch", async () => {
        await runMigrationList([setLang("ja")]);
        expect(store[TARGET_LANG]).toBe("ja");
        expect((await getSyncMeta()).clocks[TARGET_LANG]).toBe(EPOCH);
    });

    it("overwrites a value older than the epoch", async () => {
        store = { [TARGET_LANG]: "fr", [META]: meta({ clocks: { [TARGET_LANG]: OLD } }) };
        await runMigrationList([setLang("ja")]);
        expect(store[TARGET_LANG]).toBe("ja");
        expect((await getSyncMeta()).clocks[TARGET_LANG]).toBe(EPOCH);
    });

    it("claims a value that already equals the target", async () => {
        store = { [TARGET_LANG]: "ja", [META]: meta({ clocks: { [TARGET_LANG]: OLD } }) };
        await runMigrationList([setLang("ja")]);
        expect(store[TARGET_LANG]).toBe("ja");
        expect((await getSyncMeta()).clocks[TARGET_LANG]).toBe(EPOCH);
    });

    it("keeps a value the user set after the epoch", async () => {
        store = { [TARGET_LANG]: "fr", [META]: meta({ clocks: { [TARGET_LANG]: EPOCH + 1 } }) };
        const before = clone(store);
        await runMigrationList([setLang("ja")]);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });

    it("does not bring back a key the user deleted after the epoch", async () => {
        store = { [META]: meta({ tombstones: { [TARGET_LANG]: EPOCH + 1 } }) };
        const before = clone(store);
        await runMigrationList([setLang("ja")]);
        expect(store).toEqual({ ...before, [VERSION]: 1 });
    });

    it("deletes a key older than the epoch, leaving a tombstone at the epoch", async () => {
        store = { [TARGET_LANG]: "fr", [META]: meta({ clocks: { [TARGET_LANG]: OLD } }) };
        await runMigrationList([
            migration(1, async (ctx) => {
                await ctx.removeIfOlder(TARGET_LANG);
            }),
        ]);
        expect(store[TARGET_LANG]).toBeUndefined();
        expect(await getSyncMeta()).toEqual(meta({ tombstones: { [TARGET_LANG]: EPOCH } }));
    });

    it("records the deletion of a key that is not stored, so a peer's stale copy stays out", async () => {
        await runMigrationList([
            migration(1, async (ctx) => {
                await ctx.removeIfOlder(TARGET_LANG);
            }),
        ]);
        expect(await getSyncMeta()).toEqual(meta({ tombstones: { [TARGET_LANG]: EPOCH } }));
    });

    it("does not delete a value the user set after the epoch", async () => {
        store = { [TARGET_LANG]: "fr", [META]: meta({ clocks: { [TARGET_LANG]: EPOCH + 1 } }) };
        await runMigrationList([
            migration(1, async (ctx) => {
                await ctx.removeIfOlder(TARGET_LANG);
            }),
        ]);
        expect(store[TARGET_LANG]).toBe("fr");
    });
});

// The acceptance test of the whole design. Two devices, one synced list; the
// migration runs on each at a different moment, and the user acts in between.
describe("across devices", () => {
    let deviceA: Record<string, unknown>;
    let deviceB: Record<string, unknown>;

    /** Run `fn` against one device's storage. */
    async function on<T>(device: "A" | "B", fn: () => Promise<T>): Promise<T> {
        store = device === "A" ? deviceA : deviceB;
        try {
            return await fn();
        } finally {
            if (device === "A") deviceA = store;
            else deviceB = store;
        }
    }

    beforeEach(() => {
        deviceA = legacyDevice(["deepl"]);
        deviceB = legacyDevice(["deepl"]);
    });

    it("a later device's migration does not undo what the user did after the first one", async () => {
        // A upgrades; the user then enables Baidu there.
        await on("A", () => runMigrationList([addBaidu()]));
        await on("A", () => configRepo.set(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES, ["deepl"]));
        // B upgrades later, never having heard from A.
        await on("B", () => runMigrationList([addBaidu()]));
        expect(deviceB[DISABLED]).toEqual(["deepl", "baidu"]);

        const a = await on("A", () => buildSnapshot());
        const b = await on("B", () => buildSnapshot());

        // Whichever device syncs first, the user's choice stands.
        for (const [local, remote] of [[a, b], [b, a]]) {
            const { merged } = mergeSnapshots(local, remote);
            expect(merged.data[DISABLED]).toEqual(["deepl"]);
        }
    });

    it("is not undone by a user edit made BEFORE this device upgraded either", async () => {
        // B upgrades first. On A — still to upgrade — the user disables Azure.
        await on("B", () => runMigrationList([addBaidu()]));
        await on("A", () => configRepo.set(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES, ["deepl", "azure"]));
        await on("A", () => runMigrationList([addBaidu()]));

        const a = await on("A", () => buildSnapshot());
        const b = await on("B", () => buildSnapshot());
        for (const [local, remote] of [[a, b], [b, a]]) {
            const { merged } = mergeSnapshots(local, remote);
            expect(merged.data[DISABLED]).toEqual(["azure", "baidu", "deepl"]);
        }
    });

    it("holds against a peer's edit from before the release, without waiting for that peer to upgrade", async () => {
        // The element was already on A. On B the user removed it — before the
        // release, so the migration is entitled to put it back.
        const removedAt = EPOCH - 60_000;
        deviceA = legacyDevice(["deepl", "azure"]);
        deviceB = {
            [DISABLED]: ["deepl"],
            [META]: meta({
                clocks: { [DISABLED]: removedAt },
                elements: { [DISABLED]: { clocks: { deepl: OLD }, tombstones: { azure: removedAt } } },
            }),
        };
        await on("A", () => runMigrationList([migration(1, async (ctx) => {
            await ctx.addElement(DISABLED, "azure");
        })]));

        const a = await on("A", () => buildSnapshot());
        const b = await on("B", () => buildSnapshot());
        for (const [local, remote] of [[a, b], [b, a]]) {
            expect(mergeSnapshots(local, remote).merged.data[DISABLED]).toEqual(["azure", "deepl"]);
        }
    });

    it("settles on two untouched devices — once merged, neither has anything left to push", async () => {
        await on("A", () => runMigrationList([addBaidu()]));
        await on("B", () => runMigrationList([addBaidu()]));
        const a = await on("A", () => buildSnapshot());
        const b = await on("B", () => buildSnapshot());

        // Both wrote the same value with the same clock, so the merge has no
        // winner to pick — and it comes out the same from either side.
        const fromA = mergeSnapshots(a, b).merged;
        expect(mergeSnapshots(b, a).merged).toEqual(fromA);
        expect(fromA.data[DISABLED]).toEqual(["baidu", "deepl"]);

        // The merge orders elements by id, so the first one may still rewrite
        // the local order. After that there must be nothing left to exchange.
        await on("A", () => applyMergedToLocal(fromA));
        await on("B", () => applyMergedToLocal(fromA));
        const a2 = await on("A", () => buildSnapshot());
        const b2 = await on("B", () => buildSnapshot());
        expect(mergeSnapshots(a2, b2)).toMatchObject({ localChanged: false, remoteChanged: false });
        expect(mergeSnapshots(b2, a2)).toMatchObject({ localChanged: false, remoteChanged: false });
    });

    it("survives a merge with a device that has not upgraded yet", async () => {
        await on("A", () => runMigrationList([addBaidu()]));
        const a = await on("A", () => buildSnapshot());
        const b = await on("B", () => buildSnapshot());

        for (const [local, remote] of [[a, b], [b, a]]) {
            const { merged } = mergeSnapshots(local, remote);
            expect(merged.data[DISABLED]).toEqual(["baidu", "deepl"]);
        }
    });

    it("a whole-key write loses to a later user edit, whichever device syncs first", async () => {
        const setLang = migration(1, async (ctx) => {
            await ctx.setIfOlder(TARGET_LANG, "ja");
        });
        deviceA = { [TARGET_LANG]: "fr", [META]: meta({ clocks: { [TARGET_LANG]: OLD } }) };
        deviceB = clone(deviceA);

        await on("A", () => runMigrationList([setLang]));
        await on("A", () => configRepo.set(CONFIG_KEY.TARGET_LANGUAGE, "de"));
        await on("B", () => runMigrationList([setLang]));

        const a = await on("A", () => buildSnapshot());
        const b = await on("B", () => buildSnapshot());
        for (const [local, remote] of [[a, b], [b, a]]) {
            expect(mergeSnapshots(local, remote).merged.data[TARGET_LANG]).toBe("de");
        }
    });

    // A deletion is dated at the epoch, which is in the past by design — on a
    // device that upgrades late, further in the past than the 60-day tombstone
    // TTL. The merge must keep carrying such a tombstone, or the first device
    // that has not upgraded brings the deleted value straight back, while the
    // device that migrated never runs the migration again.
    describe("a migration's deletion outlives the tombstone GC", () => {
        const DAY = 24 * 60 * 60 * 1000;
        // Only a registered epoch is exempt from the GC.
        const E = MIGRATIONS[0].epoch;
        const BEFORE = E - DAY;
        const dropAzure = migration(1, async (ctx) => {
            await ctx.removeElement(DISABLED, "azure");
        }, E);
        const dropTargetLang = migration(1, async (ctx) => {
            await ctx.removeIfOlder(TARGET_LANG);
        }, E);

        /** The shared remote file; null until a device first pushes. */
        let remote: Snapshot | null;

        /** What runSync does, minus the provider. */
        async function sync(device: "A" | "B"): Promise<void> {
            await on(device, async () => {
                const local = await buildSnapshot();
                if (!remote) {
                    remote = local;
                    return;
                }
                const { merged, localChanged, remoteChanged } = mergeSnapshots(local, remote);
                if (localChanged) await applyMergedToLocal(merged);
                if (remoteChanged) remote = merged;
            });
        }

        /** A device on any build since element tracking, list last touched before the epoch. */
        const device = (): Record<string, unknown> => ({
            [DISABLED]: ["azure", "deepl"],
            [TARGET_LANG]: "fr",
            [META]: meta({
                clocks: { [DISABLED]: BEFORE, [TARGET_LANG]: BEFORE },
                elements: { [DISABLED]: { clocks: { azure: BEFORE, deepl: BEFORE }, tombstones: {} } },
            }),
        });

        beforeEach(() => {
            // Only Date: the storage mock and the write lock run on promises.
            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(E + 90 * DAY);
            deviceA = device();
            deviceB = device();
            remote = null;
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("a peer that has not upgraded cannot bring a removed element back", async () => {
            await sync("B"); // B, never to upgrade, has synced before
            await on("A", () => runMigrationList([dropAzure]));
            await sync("A");
            await sync("B");
            await sync("A");

            expect(deviceA[DISABLED]).toEqual(["deepl"]);
            expect(deviceB[DISABLED]).toEqual(["deepl"]);
            expect(remote!.data[DISABLED]).toEqual(["deepl"]);
            expect(remote!.elements?.[DISABLED]?.tombstones.azure).toBe(E);
        });

        it("a peer that has not upgraded cannot bring a deleted key back", async () => {
            await sync("B");
            await on("A", () => runMigrationList([dropTargetLang]));
            await sync("A");
            await sync("B");
            await sync("A");

            expect(TARGET_LANG in deviceA).toBe(false);
            expect(TARGET_LANG in deviceB).toBe(false);
            expect(remote!.data[TARGET_LANG]).toBeUndefined();
            expect(remote!.tombstones[TARGET_LANG]).toBe(E);
        });

        it("is restored by the upgraded device when an older client strips it from the remote", async () => {
            await sync("B");
            await on("A", () => runMigrationList([dropAzure]));
            await sync("A");
            // An older client merged after A: it applied the deletion, but its
            // own GC dropped the tombstone from what it pushed back.
            delete remote!.elements![DISABLED].tombstones.azure;
            // B, still holding the element, now meets a remote that no longer
            // says it was deleted.
            await sync("B");
            expect(remote!.data[DISABLED]).toEqual(["azure", "deepl"]);

            await sync("A"); // A still has the tombstone in its own sync-meta
            await sync("B");

            expect(deviceA[DISABLED]).toEqual(["deepl"]);
            expect(deviceB[DISABLED]).toEqual(["deepl"]);
            expect(remote!.elements?.[DISABLED]?.tombstones.azure).toBe(E);
        });

        it("still collects an expired tombstone that no migration wrote", () => {
            const snapshot = (tombstones: Record<string, number>): Snapshot => ({
                app: APP_NAME_KEBAB_CASE,
                schemaVersion: 2,
                data: {},
                meta: {},
                tombstones,
            });
            const { merged } = mergeSnapshots(snapshot({ [TARGET_LANG]: E - 1 }), snapshot({}));
            expect(merged.tombstones).toEqual({});
            const kept = mergeSnapshots(snapshot({ [TARGET_LANG]: E }), snapshot({})).merged;
            expect(kept.tombstones).toEqual({ [TARGET_LANG]: E });
        });
    });
});

describe("registry", () => {
    it("lists versions as strictly increasing positive integers", () => {
        let previous = 0;
        for (const m of MIGRATIONS) {
            expect(Number.isInteger(m.version)).toBe(true);
            expect(m.version).toBeGreaterThan(previous);
            previous = m.version;
        }
    });

    it("gives every migration an epoch in the past and a name of its own", () => {
        for (const m of MIGRATIONS) {
            expect(Number.isFinite(m.epoch)).toBe(true);
            expect(m.epoch).toBeGreaterThan(Date.UTC(2026, 0, 1));
            // An epoch in the future would overrule real edits until it passes.
            expect(m.epoch).toBeLessThan(Date.now());
        }
        expect(new Set(MIGRATIONS.map((m) => m.name)).size).toBe(MIGRATIONS.length);
    });

    it("is a no-op on empty storage (a fresh install runs the whole chain)", async () => {
        await runMigrations();
        expect(store).toEqual({ [VERSION]: MIGRATIONS[MIGRATIONS.length - 1].version });
    });
});

describe("001 disable-baidu-by-default", () => {
    const baidu = MIGRATIONS.find((m) => m.version === 1)!;
    const BAIDU = TRANSLATE_SERVICE.BAIDU;

    it("adds Baidu to a stored list that predates it", async () => {
        store = {
            [DISABLED]: ["deepl", "azure", "googleCloud"],
            [META]: meta({ clocks: { [DISABLED]: baidu.epoch - 1000 } }),
        };
        await runMigrationList([baidu]);
        expect(store[DISABLED]).toEqual(["deepl", "azure", "googleCloud", BAIDU]);
        expect((await getSyncMeta()).elements[DISABLED].clocks[BAIDU]).toBe(baidu.epoch);
    });

    it("adds Baidu to a stored empty list too — the user enabled the others, not Baidu", async () => {
        store = { [DISABLED]: [], [META]: meta({ clocks: { [DISABLED]: baidu.epoch - 1000 } }) };
        await runMigrationList([baidu]);
        expect(store[DISABLED]).toEqual([BAIDU]);
    });

    it("writes nothing when no list is stored — the default already disables Baidu", async () => {
        await runMigrationList([baidu]);
        expect(store).toEqual({ [VERSION]: 1 });
        expect(await configRepo.get(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES)).toContain(BAIDU);
    });

    it("keeps Baidu enabled for someone who enabled it after the release", async () => {
        const enabledAt = Date.now() - 1000;
        store = {
            [DISABLED]: ["deepl"],
            [META]: meta({
                clocks: { [DISABLED]: enabledAt },
                elements: { [DISABLED]: { clocks: { deepl: baidu.epoch - 1000 }, tombstones: { [BAIDU]: enabledAt } } },
            }),
        };
        await runMigrationList([baidu]);
        expect(store[DISABLED]).toEqual(["deepl"]);
    });
});

describe("sync", () => {
    const baidu = MIGRATIONS.find((m) => m.version === 1)!;
    const BAIDU = TRANSLATE_SERVICE.BAIDU;

    beforeEach(() => {
        remoteState.snapshot = null;
        remoteState.pushed = null;
        remoteState.duringPull = null;
    });

    // The window this closes: a snapshot built BEFORE a migration and applied
    // AFTER it. The migration's write is clocked in the past, so the apply step
    // cannot tell it from a value that never changed, and rolls it back — with
    // the version already recorded, for good.
    it("runs pending migrations before it builds the snapshot", async () => {
        const old = baidu.epoch - 1000;
        const recent = Date.now() - 1000;
        store = { [DISABLED]: ["deepl"], [META]: meta({ clocks: { [DISABLED]: old } }) };
        // Another device disabled Azure a moment ago; it has not upgraded.
        remoteState.snapshot = {
            app: APP_NAME_KEBAB_CASE,
            schemaVersion: 2,
            data: { [DISABLED]: ["deepl", "azure"] },
            meta: { [DISABLED]: recent },
            tombstones: {},
            elements: { [DISABLED]: { clocks: { deepl: old, azure: recent }, tombstones: {} } },
        };
        // The background start gets to the migrations while the pull is out.
        remoteState.duringPull = () => runMigrations();

        const result = await syncNow(SYNC_PROVIDER_ID.WEBDAV);
        expect(result.ok).toBe(true);
        expect(store[VERSION]).toBe(baidu.version);
        expect(store[DISABLED]).toEqual(["azure", BAIDU, "deepl"]);
        expect((remoteState.pushed as { data: Record<string, unknown> }).data[DISABLED]).toEqual(["azure", BAIDU, "deepl"]);
    });
});
