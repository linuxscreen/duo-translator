/**
 * Video bilingual subtitles — shared types.
 *
 * The pipeline is site-agnostic: a {@link VideoSiteAdapter} produces a timed
 * word stream for the current video, the segmenter groups it into sentence
 * cues, and the overlay renders original + translation. YouTube is the only
 * adapter today; Netflix / Jellyfin / Emby can plug in later by implementing
 * the same interface.
 */

/** One timed word (or caption fragment) from the source captions. */
export interface SubtitleWord {
    /** Absolute start time in ms. */
    startMs: number;
    /** Absolute end time in ms (best-effort — ASR words may only have starts). */
    endMs: number;
    text: string;
    /**
     * True when the source marked a hard cue boundary AFTER this word (end of
     * a manual caption cue). Sentence segmentation prefers these positions.
     */
    cueEnd?: boolean;
}

/** A sentence-level cue — the unit of display and translation. */
export interface SubtitleCue {
    startMs: number;
    endMs: number;
    text: string;
    /** Filled in by the pre-translation scheduler. */
    translated?: string;
}

/** Caption track descriptor, normalized across sites. */
export interface CaptionTrackInfo {
    /** Opaque site-specific handle used to fetch the track. */
    id: string;
    languageCode: string;
    /** Human-readable name ("English (auto-generated)"). */
    label: string;
    /** Auto-generated (ASR) captions. */
    auto: boolean;
}

/**
 * Site adapter contract. All methods run in the isolated content-script world;
 * page-context access (player APIs) goes through a site-specific bridge.
 */
export interface VideoSiteAdapter {
    /** List caption tracks for the currently loaded video ([] = none). */
    listTracks(): Promise<CaptionTrackInfo[]>;
    /** Fetch + parse one track into a timed word stream. */
    fetchTrack(track: CaptionTrackInfo): Promise<SubtitleWord[]>;
    /**
     * The track the player is showing right now because the USER selected it
     * (null when the site's captions are off, or the site has no such notion).
     * Polled at a low rate so switching subtitle language mid-video re-loads
     * ours too. Deliberately not "the track that would be picked now": that
     * would flip back and forth as the user toggles captions off and on.
     */
    selectedTrack?(): Promise<CaptionTrackInfo | null>;
}

/** User-configurable overlay style (CONFIG_KEY.VIDEO_SUBTITLE_STYLE). */
export interface VideoSubtitleStyle {
    originalColor: string;
    /** Font size in px. */
    originalSize: number;
    /** CSS font-weight. */
    originalWeight: number;
    translationColor: string;
    translationSize: number;
    translationWeight: number;
    /** Background of the whole subtitle box. */
    bgColor: string;
    /** 0..1 opacity applied to bgColor. */
    bgOpacity: number;
}

/**
 * Default style. Tuned for readability over arbitrary video: the translation
 * is the primary line (bright, larger), the original is secondary (dimmer,
 * smaller) so the two are distinguishable at a glance.
 */
export const DEFAULT_VIDEO_SUBTITLE_STYLE: VideoSubtitleStyle = {
    originalColor: '#d8d8d8',
    originalSize: 20,
    originalWeight: 400,
    translationColor: '#ffffff',
    translationSize: 23,
    translationWeight: 500,
    bgColor: '#000000',
    bgOpacity: 0.55,
};

/** Merge a possibly-partial persisted style over the defaults. */
export function normalizeVideoSubtitleStyle(raw: unknown): VideoSubtitleStyle {
    const base = { ...DEFAULT_VIDEO_SUBTITLE_STYLE };
    if (!raw || typeof raw !== 'object') return base;
    const r = raw as Partial<VideoSubtitleStyle>;
    for (const key of Object.keys(base) as (keyof VideoSubtitleStyle)[]) {
        const v = r[key];
        if (typeof v === typeof base[key]) (base as any)[key] = v;
    }
    return base;
}
