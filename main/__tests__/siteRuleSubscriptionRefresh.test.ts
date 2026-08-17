// refreshSubscriptions is a read-modify-write over a user-editable list with a
// network round trip in the middle (main/siteRules/siteRuleService.ts).
//
// The bug this pins: "add a subscription" dispatches the config write and the
// refresh as two concurrent background messages, so the refresh routinely reads
// the list from BEFORE the add — and then wrote that stale list back over it.
// The row appeared in Options and vanished on the next reload.
//
// The trigger was a one-line ordering change elsewhere (configRepo.set gained a
// read-before-write for cloud-sync element bookkeeping), which is exactly why
// the guarantee is asserted here rather than left to call-site discipline: the
// 24h refresh alarm can land mid-edit too, and nothing about that is visible
// from this file's callers.
import { describe, it, expect, beforeEach, vi } from "vitest";

let store: Record<string, unknown> = {};
const stripArea = (key: string) => key.replace(/^local:/, "");
const clone = <T,>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

vi.mock("wxt/utils/storage", () => ({
    storage: {
        getItem: vi.fn(async (key: string) => clone(store[stripArea(key)] ?? null)),
        setItem: vi.fn(async (key: string, value: unknown) => {
            store[stripArea(key)] = clone(value);
        }),
        removeItem: vi.fn(async (key: string) => {
            delete store[stripArea(key)];
        }),
        snapshot: vi.fn(async () => clone(store)),
        setItems: vi.fn(async (items: { key: string; value: unknown }[]) => {
            for (const { key, value } of items) store[stripArea(key)] = clone(value);
        }),
        removeItems: vi.fn(async (keys: string[]) => {
            for (const k of keys) delete store[stripArea(k)];
        }),
    },
}));

import { refreshSubscriptions } from "@/main/siteRules/siteRuleService";
import { configRepo, STORAGE_PREFIX } from "@/main/storage/configStore";
import { CONFIG_KEY } from "@/main/constants";
import type { SiteRuleSubscription } from "@/main/siteRules/types";

const SUBS = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS}`;
const A = "https://example.com/a.jsonc";
const B = "https://example.com/b.jsonc";

const sub = (url: string, extra: Partial<SiteRuleSubscription> = {}): SiteRuleSubscription => ({
    url,
    enabled: true,
    addedAt: 1,
    ...extra,
});

const packageText = (name: string) =>
    JSON.stringify({ schemaVersion: 1, name, updatedAt: "2026-01-01T00:00:00Z", rules: [] });

/** A fetch whose response is held until the returned `release` is called. */
function gatedFetch(name: string) {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    const fetchMock = vi.fn(async () => {
        await gate;
        return { ok: true, status: 200, text: async () => packageText(name) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return { release, fetchMock };
}

/** Let the function under test run up to its outstanding fetch. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const urls = () => (store[SUBS] as SiteRuleSubscription[]).map((s) => s.url);

beforeEach(() => {
    store = {};
    vi.unstubAllGlobals();
});

describe("refreshSubscriptions — concurrent edits", () => {
    it("keeps a subscription added while the fetch was in flight", async () => {
        store[SUBS] = [sub(A)];
        const { release } = gatedFetch("A");

        const running = refreshSubscriptions(A);
        await settle(); // refresh has read the list and is now awaiting the network

        // What the Options page does on "Add": one config write, dispatched
        // while the refresh above is still outstanding.
        await configRepo.set(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS, [sub(A), sub(B)]);

        release();
        await running;

        expect(urls()).toEqual([A, B]);
    });

    it("does not revert a toggle the user made during the fetch", async () => {
        // The refresh owns lastFetchAt/name/ruleCount/lastError and nothing
        // else — `enabled` is the user's.
        store[SUBS] = [sub(A)];
        const { release } = gatedFetch("A");

        const running = refreshSubscriptions(A);
        await settle();
        await configRepo.set(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS, [sub(A, { enabled: false })]);

        release();
        await running;

        const [only] = store[SUBS] as SiteRuleSubscription[];
        expect(only.enabled).toBe(false);
        expect(only.name).toBe("A"); // ...while the fetch result still landed
        expect(only.ruleCount).toBe(0);
    });

    it("keeps a deletion made during the fetch deleted", async () => {
        store[SUBS] = [sub(A), sub(B)];
        const { release } = gatedFetch("A");

        const running = refreshSubscriptions(A);
        await settle();
        await configRepo.set(CONFIG_KEY.SITE_RULE_SUBSCRIPTIONS, [sub(B)]);

        release();
        await running;

        expect(urls()).toEqual([B]);
    });

    it("records a failed fetch on the subscription without dropping it", async () => {
        store[SUBS] = [sub(A)];
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })));

        await refreshSubscriptions(A);

        const [only] = store[SUBS] as SiteRuleSubscription[];
        expect(only.url).toBe(A);
        expect(only.lastError).toBe("HTTP 404");
    });
});
