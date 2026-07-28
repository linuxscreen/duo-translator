/**
 * postMessage protocol shared by the MAIN-world YouTube bridge
 * (entrypoints/youtube-bridge.content.ts) and the isolated-world adapter
 * (youtube.ts). Keep this file free of extension imports — the bridge runs in
 * the page context.
 */

export const YT_BRIDGE_REQUEST = "DUO_YT_GET_PLAYER_DATA";
export const YT_BRIDGE_RESPONSE = "DUO_YT_PLAYER_DATA";
/** Ask the bridge to make the player fetch a caption track (json3 body). */
export const YT_BRIDGE_TRACK_REQUEST = "DUO_YT_REQUEST_TRACK";
export const YT_BRIDGE_TRACK_RESPONSE = "DUO_YT_TRACK_DATA";

export interface YtBridgeCaptionTrack {
    baseUrl: string;
    languageCode: string;
    /** "asr" for auto-generated tracks, "" otherwise. */
    kind: string;
    label: string;
}

export interface YtBridgePlayerData {
    videoId: string;
    isLive: boolean;
    captionTracks: YtBridgeCaptionTrack[];
}

export interface YtBridgeTrackRequest {
    type: typeof YT_BRIDGE_TRACK_REQUEST;
    id: string;
    videoId: string;
    languageCode: string;
    /** "asr" | "" — must match the track kind. */
    kind: string;
}

export interface YtBridgeTrackResponse {
    type: typeof YT_BRIDGE_TRACK_RESPONSE;
    id: string;
    /** Raw json3 body, or null when the player produced nothing in time. */
    body: string | null;
}
