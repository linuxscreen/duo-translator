/**
 * Shared AI request limits.
 *
 * This module must stay free of background-only imports: content scripts need
 * the same limit for pre-flight validation before opening a provider stream.
 */
export const AI_MAX_INPUT_CHARS = 20_000;
