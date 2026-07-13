/**
 * HoyoOpener: Background Service Worker
 *
 * Opens HoYoverse daily check-in tabs at a user-set local time each day.
 * The server region still drives the pending/done badge (a new claim only
 * becomes available at 00:00 server-local time).
 */

import {
  STORAGE_KEYS,
  TARGETS,
  DEFAULT_REGION,
  DEFAULT_TRIGGER_TIME,
  needsCheckIn,
  nextResetTimestamp,
  nextTriggerTimestamp,
  triggerDueThisCycle,
} from "./shared.js";

const ALARM_NAME = "dailyTrigger";
const BOUNDARY_ALARM_NAME = "boundaryRefresh";
const WATCHDOG_ALARM_NAME = "watchdog";
const WATCHDOG_PERIOD_MIN = 30;
// A one-shot alarm this far past its scheduledTime while the SW is awake was
// dropped by the browser. A younger alarm may still be pending dispatch.
const ALARM_STALE_MS = 2 * 60_000;
const ALLOWED_DOMAINS = [".hoyolab.com", ".hoyoverse.com"];

const TAG = "[HoyoOpener]";
const log = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);
const err = (...a) => console.error(TAG, ...a);

// Cross-SW-lifetime lock. A module-level boolean wouldn't survive MV3 SW
// eviction, since a second runCheckIn after an unclean teardown would re-open
// the same tabs. chrome.storage.session is per-browser-session, cleared on
// browser close, and survives SW restarts.
const RUN_LOCK_KEY = "runCheckInLock";
const RUN_LOCK_TIMEOUT_MS = 5 * 60_000;
let runLockMutationChain = Promise.resolve();

async function withRunLockMutation(fn) {
  let releaseMutation;
  const previousMutation = runLockMutationChain;
  runLockMutationChain = previousMutation.then(() => new Promise((resolve) => {
    releaseMutation = resolve;
  }));

  await previousMutation;
  try {
    return await fn();
  } finally {
    releaseMutation();
  }
}

function runLockTimestamp(lock) {
  if (typeof lock === "number") return lock;
  return typeof lock?.acquiredAt === "number" ? lock.acquiredAt : null;
}

function isRunLockHeld(lock) {
  const acquiredAt = runLockTimestamp(lock);
  if (acquiredAt === null) return false;
  const age = Date.now() - acquiredAt;
  return age >= 0 && age < RUN_LOCK_TIMEOUT_MS;
}

async function acquireRunLock() {
  return withRunLockMutation(async () => {
    const { [RUN_LOCK_KEY]: current } = await chrome.storage.session.get(RUN_LOCK_KEY);
    if (isRunLockHeld(current)) return null;

    const owner = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    await chrome.storage.session.set({
      [RUN_LOCK_KEY]: { owner, acquiredAt: Date.now() },
    });
    return owner;
  });
}

async function releaseRunLock(owner) {
  await withRunLockMutation(async () => {
    const { [RUN_LOCK_KEY]: current } = await chrome.storage.session.get(RUN_LOCK_KEY);
    if (current?.owner === owner) {
      await chrome.storage.session.remove(RUN_LOCK_KEY);
    }
  });
}

function isValidHoyoUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_DOMAINS.some((d) => u.hostname.endsWith(d));
  } catch {
    return false;
  }
}

async function getEnabledTargets() {
  const { [STORAGE_KEYS.ENABLED_GAMES]: stored } =
    await chrome.storage.local.get(STORAGE_KEYS.ENABLED_GAMES);
  const enabled = stored && typeof stored === "object" ? stored : {};
  return TARGETS.filter((t) => enabled[t.game] !== false);
}

async function refreshBadge() {
  try {
    const { [STORAGE_KEYS.LAST_RUN]: lastRun, [STORAGE_KEYS.REGION]: region = DEFAULT_REGION } =
      await chrome.storage.local.get([STORAGE_KEYS.LAST_RUN, STORAGE_KEYS.REGION]);
    const done = !needsCheckIn(lastRun, region);
    await chrome.action.setBadgeText({ text: done ? "\u2713" : "" });
    if (done) await chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  } catch (e) {
    err("Badge update failed:", e);
  }
}

async function openTab({ url, game }) {
  if (!isValidHoyoUrl(url)) {
    err(`Rejected invalid URL for ${game}: ${url}`);
    return false;
  }
  try {
    await chrome.tabs.create({ url, active: false });
    log(`Opened: ${game}`);
    return true;
  } catch (e) {
    err(`Failed to open ${game}:`, e);
    return false;
  }
}

async function notify(count) {
  try {
    await chrome.notifications.create("dailyCheckin", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "HoyoOpener",
      message: `Daily check-ins opened for ${count} game${count !== 1 ? "s" : ""}.`,
    });
  } catch (e) {
    err("Notification failed:", e);
  }
}

/**
 * Runs the check-in flow. Manual runs bypass the reset-cycle guard so the user
 * can always force-open from the popup or toolbar icon.
 * @param {{manual: boolean}} opts
 */
async function runCheckIn({ manual }) {
  const lockOwner = await acquireRunLock();
  if (!lockOwner) return { success: 0, failed: 0, skipped: "in-progress" };

  try {
    if (!manual) {
      const { [STORAGE_KEYS.LAST_RUN]: lastRun, [STORAGE_KEYS.REGION]: region = DEFAULT_REGION } =
        await chrome.storage.local.get([STORAGE_KEYS.LAST_RUN, STORAGE_KEYS.REGION]);
      if (!needsCheckIn(lastRun, region)) {
        return { success: 0, failed: 0, skipped: "already-done" };
      }
    }

    const targets = await getEnabledTargets();
    if (targets.length === 0) {
      warn("No games enabled");
      return { success: 0, failed: 0, skipped: "none-enabled" };
    }

    log(manual ? "Manual trigger" : "Reset cycle rolled: opening tabs");
    const results = await Promise.all(targets.map(openTab));
    const success = results.filter(Boolean).length;
    const failed = results.length - success;

    if (success > 0) {
      await chrome.storage.local.set({ [STORAGE_KEYS.LAST_RUN]: Date.now() });
      await refreshBadge();
      if (!manual) await notify(success);
      log(`${manual ? "Manual" : "Auto"}: ${success} opened, ${failed} failed`);
    } else {
      warn("All tabs failed. Will retry next alarm cycle");
    }
    return { success, failed };
  } finally {
    await releaseRunLock(lockOwner);
  }
}

// One-shot alarms rescheduled on each fire. Avoids periodInMinutes drift
// across DST boundaries. Every reschedule recomputes the next local-time
// occurrence in current wall-clock time.
async function updateAlarm() {
  try {
    const { [STORAGE_KEYS.TRIGGER_TIME]: triggerTime = DEFAULT_TRIGGER_TIME } =
      await chrome.storage.local.get(STORAGE_KEYS.TRIGGER_TIME);
    const when = nextTriggerTimestamp(triggerTime);
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, { when });
    log(`Alarm scheduled for ${new Date(when).toLocaleString()} (daily @ ${triggerTime})`);
  } catch (e) {
    err("Alarm creation failed:", e);
  }
}

// Separate alarm at the next 00:00-server-time boundary so the badge flips
// from ✓ to pending the moment a new server cycle begins, even if Chrome
// stays open across the boundary.
async function updateBoundaryAlarm() {
  try {
    const { [STORAGE_KEYS.REGION]: region = DEFAULT_REGION } =
      await chrome.storage.local.get(STORAGE_KEYS.REGION);
    const when = nextResetTimestamp(region);
    await chrome.alarms.clear(BOUNDARY_ALARM_NAME);
    await chrome.alarms.create(BOUNDARY_ALARM_NAME, { when });
  } catch (e) {
    err("Boundary alarm creation failed:", e);
  }
}

// Persistent periodic alarm. Even if a firing is missed (system sleep, SW
// eviction at the wrong instant), the next period fires; unlike the one-shot
// chain it has no reschedule step that can be interrupted.
async function ensureWatchdog() {
  try {
    const existing = await chrome.alarms.get(WATCHDOG_ALARM_NAME);
    if (!existing) {
      await chrome.alarms.create(WATCHDOG_ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: WATCHDOG_PERIOD_MIN,
      });
    }
  } catch (e) {
    err("Watchdog creation failed:", e);
  }
}

// Recreate any alarm the browser lost, without touching healthy ones. A
// past-due one-shot younger than ALARM_STALE_MS is left alone so a pending
// dispatch isn't destroyed (the BH-001 failure mode).
async function ensureAlarms() {
  const [daily, boundary] = await Promise.all([
    chrome.alarms.get(ALARM_NAME),
    chrome.alarms.get(BOUNDARY_ALARM_NAME),
  ]);
  const lost = (a) => !a || a.scheduledTime <= Date.now() - ALARM_STALE_MS;
  const jobs = [ensureWatchdog()];
  if (lost(daily)) jobs.push(updateAlarm());
  if (lost(boundary)) jobs.push(updateBoundaryAlarm());
  await Promise.all(jobs);
}

// Opens tabs when a check-in is pending AND the current cycle's trigger time
// has already passed, i.e. exactly the fires the one-shot alarm missed.
// needsCheckIn caps it at one open per server cycle.
async function catchUpIfDue() {
  const {
    [STORAGE_KEYS.LAST_RUN]: lastRun,
    [STORAGE_KEYS.REGION]: region = DEFAULT_REGION,
    [STORAGE_KEYS.TRIGGER_TIME]: triggerTime = DEFAULT_TRIGGER_TIME,
  } = await chrome.storage.local.get([
    STORAGE_KEYS.LAST_RUN,
    STORAGE_KEYS.REGION,
    STORAGE_KEYS.TRIGGER_TIME,
  ]);
  if (needsCheckIn(lastRun, region) && triggerDueThisCycle(triggerTime, region)) {
    log("Missed trigger detected, catching up");
    await runCheckIn({ manual: false });
  }
}

async function bootstrap(reason) {
  log(reason);
  await Promise.all([updateAlarm(), updateBoundaryAlarm(), ensureWatchdog(), refreshBadge()]);
  // Catch-up: if Chrome was closed across the trigger time (so the past-due
  // alarm got destroyed by updateAlarm's clear, or a previous SW session
  // missed the fire entirely), open tabs now. needsCheckIn caps this at one
  // open per server cycle so it can't burst across multiple closed days.
  await catchUpIfDue();
}

chrome.runtime.onStartup.addListener(() => bootstrap("Browser startup"));
chrome.runtime.onInstalled.addListener(({ reason }) => bootstrap(`Extension ${reason}`));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WATCHDOG_ALARM_NAME) {
    try {
      await refreshBadge();
      await catchUpIfDue();
    } finally {
      await ensureAlarms();
    }
    return;
  }
  if (alarm.name === BOUNDARY_ALARM_NAME) {
    try {
      await refreshBadge();
    } finally {
      await updateBoundaryAlarm();
    }
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  try {
    await refreshBadge();
    await runCheckIn({ manual: false });
  } finally {
    // Always reschedule so the alarm chain survives errors. Awaited so the
    // SW can't be torn down before chrome.alarms.create resolves.
    await updateAlarm();
  }
});

// Fallback for if the popup is ever removed from the manifest.
chrome.action.onClicked.addListener(() => runCheckIn({ manual: true }));

// Chrome can keep running with zero windows ("continue running background
// apps" or another extension holding the process). In that state tabs.create
// fails and reopening a window never fires onStartup because the process
// never died. A new window is therefore a recovery point: refresh the badge
// and make up a missed trigger immediately instead of waiting for the
// watchdog tick.
chrome.windows?.onCreated.addListener(() => {
  refreshBadge();
  catchUpIfDue().catch((e) => err("Window-open catch-up failed:", e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Reject anything not from our own extension pages.
  if (sender.id !== chrome.runtime.id) return false;

  switch (msg?.action) {
    case "openAll":
      runCheckIn({ manual: true })
        .then(sendResponse)
        .catch((e) => {
          err("openAll failed:", e);
          sendResponse({ ok: false, error: "operation-failed" });
        });
      return true;

    case "resetToday":
      chrome.storage.local.remove(STORAGE_KEYS.LAST_RUN)
        .then(refreshBadge)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => {
          err("resetToday failed:", e);
          sendResponse({ ok: false, error: "operation-failed" });
        });
      return true;

    case "settingsChanged":
      Promise.all([refreshBadge(), updateAlarm(), updateBoundaryAlarm()])
        .then(() => sendResponse({ ok: true }))
        .catch((e) => {
          err("settingsChanged failed:", e);
          sendResponse({ ok: false });
        });
      return true;

    default:
      return false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (STORAGE_KEYS.LAST_RUN in changes || STORAGE_KEYS.REGION in changes) {
    refreshBadge();
  }
  if (STORAGE_KEYS.TRIGGER_TIME in changes) updateAlarm();
  if (STORAGE_KEYS.REGION in changes) updateBoundaryAlarm();
});

// Self-heal on every service-worker wake, including browser startup. The SW
// wakes for alarms, popup messages, notifications, and window events; each
// wake rebuilds whatever alarms the browser dropped, so a broken chain lasts
// at most until the next wake instead of until the next full restart.
// Listener registrations above stay synchronous per MV3 rules; this runs
// after them, fire-and-forget.
ensureAlarms().catch((e) => err("Wake self-heal failed:", e));
