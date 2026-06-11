// Automatic sync scheduling (background-only).
//
// When CONFIG_KEY.SYNC_AUTO is on, sync runs:
//   1. once on background startup,
//   2. 30s-debounced after any user-data change (via storage.onChanged),
//   3. on a periodic alarm at CONFIG_KEY.SYNC_INTERVAL_MINUTES (default 15).
//
// Debounce + periodic are backed by chrome.alarms so they survive MV3 service-
// worker suspension. The actual merge lives in syncManager.syncAll.

import { browser } from 'wxt/browser';
import { APP_NAME_WITH_SUFFIX, CONFIG_KEY } from '@/main/constants';
import { getConfigItem } from '@/main/storage/configStore';
import { isSnapshotKey } from '@/main/storage/snapshot';
import { syncAll } from './syncManager';

const ALARM_PERIODIC = 'duo-sync-periodic';
const ALARM_DEBOUNCE = 'duo-sync-debounce';
// 30s. Chrome clamps sub-minute alarms in release builds; if so the debounce
// stretches toward ~1min, which is acceptable.
const DEBOUNCE_MINUTES = 0.5;

async function isAutoOn(): Promise<boolean> {
    return !!(await getConfigItem(CONFIG_KEY.SYNC_AUTO));
}

async function getIntervalMinutes(): Promise<number> {
    const v = Number(await getConfigItem(CONFIG_KEY.SYNC_INTERVAL_MINUTES));
    return Number.isFinite(v) && v > 0 ? v : 15;
}

function onStorageChanged(
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
): void {
    if (areaName !== 'local') return;
    // Ignore internal keys + our own sync-meta writes; only real synced data
    // changes should arm the debounce (this also stops the apply→watch loop:
    // applyMergedToLocal writes __sync_meta, which isSnapshotKey rejects).
    if (!Object.keys(changes).some(isSnapshotKey)) return;
    console.log(APP_NAME_WITH_SUFFIX, 'storage change watched', changes, areaName);
    void (async () => {
        if (!(await isAutoOn())) return;
        // Re-creating the one-shot alarm resets the debounce window.
        await browser.alarms.create(ALARM_DEBOUNCE, { delayInMinutes: DEBOUNCE_MINUTES });
    })();
}

function onAlarm(alarm: { name: string }): void {
    if (alarm.name === ALARM_PERIODIC) void syncAll('periodic');
    else if (alarm.name === ALARM_DEBOUNCE) void syncAll('debounce');
}

/** (Re)create the periodic alarm to match the current config. Called at startup
 *  and whenever Options changes the toggle/interval. */
export async function reconfigureAutoSync(): Promise<void> {
    await browser.alarms.clear(ALARM_PERIODIC);
    if (await isAutoOn()) {
        const periodInMinutes = await getIntervalMinutes();
        await browser.alarms.create(ALARM_PERIODIC, { periodInMinutes });
    } else {
        await browser.alarms.clear(ALARM_DEBOUNCE);
    }
}

/**
 * Register the alarm + storage listeners. MUST be called synchronously during
 * service-worker startup (not inside a promise) so an alarm that wakes the SW is
 * caught — `addListener` dedups by function ref, so calling it again is safe.
 */
export function registerAutoSyncListeners(): void {
    browser.storage.onChanged.addListener(onStorageChanged);
    browser.alarms.onAlarm.addListener(onAlarm);
}

/** Schedule the periodic alarm and run the startup sync (if enabled). Async; run
 *  after migration settles. */
export async function startAutoSync(): Promise<void> {
    try {
        await reconfigureAutoSync();
        if (await isAutoOn()) {
            void syncAll('startup');
        }
    } catch (e) {
        console.error(APP_NAME_WITH_SUFFIX, 'startAutoSync failed', e);
    }
}

/** Called from the Options → background message after the toggle/interval
 *  changes: reschedule, and kick an immediate sync when freshly enabled. */
export async function applyAutoSyncConfig(): Promise<void> {
    await reconfigureAutoSync();
    if (await isAutoOn()) {
        void syncAll('config-changed');
    }
}
