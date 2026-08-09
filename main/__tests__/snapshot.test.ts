// Backup import (main/storage/snapshot.ts — applyImportedSnapshot).
//
// The load-bearing property here is that importing a backup must never destroy
// API keys this device still holds. A redacted export — which is what the
// "Export JSON" button produces by DEFAULT, the include-secrets toggle starts
// off — carries `apiKey: ''` on every AI provider record and an empty string
// for the pure-secret keys. Writing that verbatim wipes the user's keys.
//
// applyMergedToLocal (the sync path) has always guarded this via
// reattachApiKeys; import is the same hazard reached through a different door.
import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for chrome.storage.local. Keys are stored WITHOUT the
// `local:` area prefix, matching what `storage.snapshot('local')` returns.
let store: Record<string, unknown> = {};

const stripArea = (key: string) => key.replace(/^local:/, "");

vi.mock("wxt/utils/storage", () => ({
    storage: {
        snapshot: vi.fn(async () => ({ ...store })),
        setItems: vi.fn(async (items: { key: string; value: unknown }[]) => {
            for (const { key, value } of items) store[stripArea(key)] = value;
        }),
        removeItems: vi.fn(async (keys: string[]) => {
            for (const k of keys) delete store[stripArea(k)];
        }),
        getItem: vi.fn(async (key: string) => store[stripArea(key)] ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => {
            store[stripArea(key)] = value;
        }),
    },
}));

// Keep the real constants (STORAGE_PREFIX / INTERNAL_STORAGE_KEYS) so the key
// names under test stay in sync with production; only the clock bookkeeping is
// stubbed. `vi.hoisted` because vi.mock factories are lifted above this file's
// own initialization.
const { touchKeys } = vi.hoisted(() => ({ touchKeys: vi.fn(async (_keys: string[]) => {}) }));
vi.mock("@/main/storage/configStore", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/main/storage/configStore")>();
    return {
        ...actual,
        getSyncMeta: vi.fn(async () => ({ clocks: {}, tombstones: {} })),
        setSyncMeta: vi.fn(async () => {}),
        touchKeys,
    };
});

import { applyImportedSnapshot, redactSecrets, type Snapshot } from "@/main/storage/snapshot";
import { STORAGE_PREFIX } from "@/main/storage/configStore";
import { APP_NAME_KEBAB_CASE, CONFIG_KEY } from "@/main/constants";

const AI_PROVIDERS_KEY = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.AI_PROVIDERS}`;
const DEEPL_KEY = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.DEEPL_API_KEY}`;
const TARGET_LANG_KEY = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.TARGET_LANGUAGE}`;

function snapshot(data: Record<string, unknown>): Snapshot {
    return {
        app: APP_NAME_KEBAB_CASE,
        schemaVersion: 2,
        data,
        meta: Object.fromEntries(Object.keys(data).map((k) => [k, 1])),
        tombstones: {},
    };
}

/** The device already has two providers with live keys plus a DeepL key. */
function seedLocalKeys() {
    store[AI_PROVIDERS_KEY] = [
        { id: "p1", name: "OpenAI", baseURL: "https://api.openai.com", apiKey: "sk-local-1" },
        { id: "p2", name: "Claude", baseURL: "https://api.anthropic.com", apiKey: "sk-local-2" },
    ];
    store[DEEPL_KEY] = "deepl-local-key";
}

beforeEach(() => {
    store = {};
    touchKeys.mockClear();
});

describe("applyImportedSnapshot — secrets", () => {
    it("keeps local API keys when importing a redacted backup", async () => {
        seedLocalKeys();
        // Exactly what the default "Export JSON" path produces: a full snapshot
        // run through redactSecrets.
        const exported = redactSecrets(
            snapshot({
                [AI_PROVIDERS_KEY]: [
                    { id: "p1", name: "OpenAI", baseURL: "https://api.openai.com", apiKey: "sk-local-1" },
                    { id: "p2", name: "Claude", baseURL: "https://api.anthropic.com", apiKey: "sk-local-2" },
                ],
                [DEEPL_KEY]: "deepl-local-key",
            }),
        );
        // Sanity: the file really is redacted.
        expect((exported.data[AI_PROVIDERS_KEY] as any[]).every((p) => p.apiKey === "")).toBe(true);
        expect(exported.data[DEEPL_KEY]).toBe("");

        await applyImportedSnapshot(exported);

        const providers = store[AI_PROVIDERS_KEY] as any[];
        expect(providers.find((p) => p.id === "p1").apiKey).toBe("sk-local-1");
        expect(providers.find((p) => p.id === "p2").apiKey).toBe("sk-local-2");
        expect(store[DEEPL_KEY]).toBe("deepl-local-key");
    });

    it("still restores non-secret fields from a redacted backup", async () => {
        seedLocalKeys();
        await applyImportedSnapshot(
            snapshot({
                [AI_PROVIDERS_KEY]: [
                    { id: "p1", name: "OpenAI renamed", baseURL: "https://proxy.example.com", apiKey: "" },
                ],
                [TARGET_LANG_KEY]: "ja",
            }),
        );

        const providers = store[AI_PROVIDERS_KEY] as any[];
        expect(providers[0].name).toBe("OpenAI renamed");
        expect(providers[0].baseURL).toBe("https://proxy.example.com");
        expect(providers[0].apiKey).toBe("sk-local-1");
        expect(store[TARGET_LANG_KEY]).toBe("ja");
    });

    it("lets a backup exported WITH secrets overwrite the local keys", async () => {
        seedLocalKeys();
        await applyImportedSnapshot(
            snapshot({
                [AI_PROVIDERS_KEY]: [{ id: "p1", name: "OpenAI", apiKey: "sk-from-file" }],
                [DEEPL_KEY]: "deepl-from-file",
            }),
        );

        expect((store[AI_PROVIDERS_KEY] as any[])[0].apiKey).toBe("sk-from-file");
        expect(store[DEEPL_KEY]).toBe("deepl-from-file");
    });

    it("leaves a provider that has no local counterpart untouched", async () => {
        seedLocalKeys();
        await applyImportedSnapshot(
            snapshot({
                [AI_PROVIDERS_KEY]: [{ id: "p9", name: "New provider", apiKey: "" }],
            }),
        );

        const providers = store[AI_PROVIDERS_KEY] as any[];
        expect(providers).toHaveLength(1);
        expect(providers[0].apiKey).toBe("");
    });

    it("writes the DeepL key when the device has none and the file carries one", async () => {
        await applyImportedSnapshot(snapshot({ [DEEPL_KEY]: "deepl-from-file" }));
        expect(store[DEEPL_KEY]).toBe("deepl-from-file");
    });

    it("does not bump the clock for a secret key it deliberately skipped", async () => {
        seedLocalKeys();
        await applyImportedSnapshot(snapshot({ [DEEPL_KEY]: "", [TARGET_LANG_KEY]: "ja" }));

        expect(store[DEEPL_KEY]).toBe("deepl-local-key");
        const touched = touchKeys.mock.calls[0][0];
        expect(touched).toContain(TARGET_LANG_KEY);
        expect(touched).not.toContain(DEEPL_KEY);
    });
});

describe("applyImportedSnapshot — envelope", () => {
    it("rejects a snapshot with a bad envelope", async () => {
        await expect(applyImportedSnapshot({ app: "nope" } as any)).rejects.toThrow(
            "Invalid snapshot envelope",
        );
    });
});
