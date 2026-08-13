// Shared shapes for the translating indicator. Kept apart from index.ts so the
// React corner surface (lazily imported BY index.ts) can type its props without
// importing back into the controller.
import type { ErrorToastPayload } from "@/main/errorToast";

/**
 * Why a batch failed, in exactly the shape the error bubble takes: the
 * indicator's "details" button opens that bubble, so anything else here would
 * only be a second description of the same failure that could drift from it.
 */
export type IndicatorFailure = ErrorToastPayload;

/** What the corner surface draws — the whole tab's state, all frames folded in. */
export interface CornerIndicatorState {
    /** Batches currently in flight. */
    pending: number;
    /** Batches that failed and have not been retried. */
    failed: number;
    /** The most recent failure, which is the one the corner surface reports. */
    failure: IndicatorFailure | null;
}

/** One frame's contribution, as sent to the top frame in corner mode. */
export interface FrameIndicatorState {
    pending: number;
    failed: number;
    failure: IndicatorFailure | null;
}
