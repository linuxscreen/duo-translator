import { useEffect, useRef, useSyncExternalStore } from "react";

export type SlotId =
    | "result"
    | "mailTranslation"
    | "replyRewrite"
    | "replyTranslation";

export type SlotView = "text" | "diff";

export interface SlotState {
    output: string;
    running: boolean;
    error: string | null;
    /** Snapshot used as the DiffView baseline for rewrite slots. */
    base: string;
    view: SlotView;
}

export interface RunningStream {
    stream: AsyncIterable<string>;
    abort: () => void;
}

export type SlotStarter = () => RunningStream | Promise<RunningStream>;

export interface SlotStore {
    get(id: SlotId): SlotState;
    subscribe(id: SlotId, listener: () => void): () => void;
    /**
     * Start a stream in `id`. `onError` fires only for the error of *this*
     * run (a superseded run never reports), so the caller can forward the
     * failure to its own logging while the store keeps rendering it.
     */
    run(id: SlotId, starter: SlotStarter, onError?: (error: unknown) => void): Promise<void>;
    stop(id: SlotId): void;
    stopAll(): void;
    reset(id: SlotId): void;
    setBase(id: SlotId, text: string): void;
    /** Replace a completed result, e.g. after the user edits its Text view. */
    setOutput(id: SlotId, text: string): void;
    setView(id: SlotId, view: SlotView): void;
    setError(id: SlotId, error: string | null): void;
    destroy(): void;
}

const EMPTY_STATE: SlotState = Object.freeze({
    output: "",
    running: false,
    error: null,
    base: "",
    view: "diff",
});

function freshState(): SlotState {
    return { ...EMPTY_STATE };
}

/**
 * Pure, testable slot state machine. The React hook below is only a thin
 * adapter over this store so concurrency and abort semantics can be verified
 * without a component renderer.
 */
export function createSlotStore(): SlotStore {
    const states = new Map<SlotId, SlotState>();
    const listeners = new Map<SlotId, Set<() => void>>();
    const runTokens = new Map<SlotId, number>();
    const aborts = new Map<SlotId, () => void>();

    const get = (id: SlotId): SlotState => states.get(id) ?? EMPTY_STATE;

    const emit = (id: SlotId) => {
        listeners.get(id)?.forEach((listener) => listener());
    };

    const setState = (id: SlotId, patch: Partial<SlotState>) => {
        const next = { ...get(id), ...patch };
        states.set(id, next);
        emit(id);
    };

    const nextToken = (id: SlotId): number => {
        const token = (runTokens.get(id) ?? 0) + 1;
        runTokens.set(id, token);
        return token;
    };

    const stop = (id: SlotId) => {
        nextToken(id);
        aborts.get(id)?.();
        aborts.delete(id);
        setState(id, { running: false });
    };

    return {
        get,
        subscribe(id, listener) {
            let bucket = listeners.get(id);
            if (!bucket) {
                bucket = new Set();
                listeners.set(id, bucket);
            }
            bucket.add(listener);
            return () => bucket?.delete(listener);
        },
        async run(id, starter, onError) {
            stop(id);
            const token = nextToken(id);
            setState(id, {
                output: "",
                running: true,
                error: null,
            });

            let running: RunningStream;
            try {
                running = await starter();
                if (token !== runTokens.get(id)) {
                    running.abort();
                    return;
                }
                aborts.set(id, running.abort);
                for await (const delta of running.stream) {
                    if (token !== runTokens.get(id)) break;
                    setState(id, { output: get(id).output + delta });
                }
            } catch (error: any) {
                if (token !== runTokens.get(id)) return;
                setState(id, { error: error?.message || String(error) });
                onError?.(error);
            } finally {
                if (token === runTokens.get(id)) {
                    aborts.delete(id);
                    setState(id, { running: false });
                }
            }
        },
        stop,
        stopAll() {
            [...states.keys()].forEach(stop);
        },
        reset(id) {
            stop(id);
            states.set(id, freshState());
            emit(id);
        },
        setBase(id, text) {
            setState(id, { base: text });
        },
        setOutput(id, text) {
            setState(id, { output: text });
        },
        setView(id, view) {
            setState(id, { view });
        },
        setError(id, error) {
            setState(id, { error });
        },
        destroy() {
            [...states.keys()].forEach(stop);
            listeners.clear();
        },
    };
}

export function useSlots(): SlotStore {
    const storeRef = useRef<SlotStore | null>(null);
    if (!storeRef.current) storeRef.current = createSlotStore();
    const store = storeRef.current;

    useEffect(() => () => store.destroy(), [store]);

    return store;
}

export function useSlot(store: SlotStore, id: SlotId): SlotState {
    return useSyncExternalStore(
        (listener) => store.subscribe(id, listener),
        () => store.get(id),
    );
}
