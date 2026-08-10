import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_KEY, TRANSLATE_SERVICE } from "@/main/constants";

// Built-in AI's default is the one service default that CANNOT live in
// DEFAULT_VALUE: the same build ships to browsers that have the on-device model
// and to browsers that don't, so "on when it works" is only expressible as a
// runtime question. Worth pinning, because both failure directions are silent —
// the service is just quietly present, or quietly missing.

/**
 * Load utils/service.ts with the capability answer and the stored disabled list
 * under test, then ask it the same question every picker asks.
 *
 * Deliberately goes through the real `getTranslateService` rather than
 * re-deriving the filter here: a test that re-implements the logic it is
 * checking would pass no matter what the production code did.
 */
async function enabledServices(apiPresent: boolean, disabled: string[]) {
    vi.resetModules();
    vi.doMock("@/main/builtinAi/capability", () => ({
        builtinAiApiAvailable: () => apiPresent,
    }));
    vi.doMock("@/utils/db", () => ({
        getConfig: async (key: string) =>
            key === CONFIG_KEY.DISABLED_TRANSLATE_SERVICES ? disabled : undefined,
        setConfig: async () => { },
    }));
    const mod = await import("@/utils/service");
    return { mod, ...(await mod.getTranslateService(undefined)) };
}

afterEach(() => {
    vi.doUnmock("@/main/builtinAi/capability");
    vi.doUnmock("@/utils/db");
    vi.resetModules();
});

describe("built-in AI availability gating", () => {
    it("is offered by default when the browser has the on-device API", async () => {
        // Empty disabled list = the shipped default, since DEFAULT_VALUE no
        // longer lists 'builtin'.
        const { mod, enabledTranslateServices } = await enabledServices(true, []);
        const values = enabledTranslateServices.map((s) => s.value);

        expect(values).toContain(TRANSLATE_SERVICE.BUILTIN);
        // Listed *and* selectable — a picker entry that resolves away is useless.
        expect(mod.resolveActiveService(TRANSLATE_SERVICE.BUILTIN, enabledTranslateServices, []))
            .toBe(TRANSLATE_SERVICE.BUILTIN);
        expect(mod.buildServiceOptions(enabledTranslateServices, [])
            .some((o) => o.value === TRANSLATE_SERVICE.BUILTIN)).toBe(true);
    });

    it("is withheld when the browser lacks the API, even with an empty disabled list", async () => {
        const { mod, enabledTranslateServices } = await enabledServices(false, []);
        const values = enabledTranslateServices.map((s) => s.value);

        expect(values).not.toContain(TRANSLATE_SERVICE.BUILTIN);
        // A stored selection pointing at it must degrade rather than stick, or
        // the user sits on a service that can never answer.
        expect(mod.resolveActiveService(TRANSLATE_SERVICE.BUILTIN, enabledTranslateServices, []))
            .toBe(enabledTranslateServices[0].value);
    });

    it("still honours an explicit opt-out on a capable browser", async () => {
        const { enabledTranslateServices } = await enabledServices(true, [TRANSLATE_SERVICE.BUILTIN]);
        expect(enabledTranslateServices.map((s) => s.value))
            .not.toContain(TRANSLATE_SERVICE.BUILTIN);
    });

    it("leaves the other services alone in both worlds", async () => {
        for (const apiPresent of [true, false]) {
            const { enabledTranslateServices } = await enabledServices(apiPresent, ["deepl"]);
            const values = enabledTranslateServices.map((s) => s.value);
            expect(values).toContain(TRANSLATE_SERVICE.MICROSOFT);
            expect(values).toContain(TRANSLATE_SERVICE.GOOGLE);
            expect(values).not.toContain(TRANSLATE_SERVICE.DEEPL);
        }
    });
});
