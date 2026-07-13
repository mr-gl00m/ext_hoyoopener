/**
 * Shared constants and reset-time logic for background + popup.
 */

export const STORAGE_KEYS = {
  LAST_RUN: "lastRunTimestamp",
  ENABLED_GAMES: "enabledGames",
  REGION: "serverRegion",
  TRIGGER_TIME: "triggerTime",
};

export const TARGETS = [
  {
    game: "Zenless Zone Zero",
    url: "https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html?act_id=e202406031448091",
  },
  {
    game: "Honkai: Star Rail",
    url: "https://act.hoyolab.com/bbs/event/signin/hkrpg/index.html?act_id=e202303301540311",
  },
  {
    game: "Genshin Impact",
    url: "https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481",
  },
  {
    game: "Honkai Impact 3rd",
    url: "https://act.hoyolab.com/bbs/event/signin-bh3/index.html?act_id=e202110291205111",
  },
];

// HoYoverse server daily reset is 00:00 server-local. Offsets are fixed
// (no DST) because the game servers themselves don't shift.
export const REGIONS = {
  asia:    { label: "Asia (UTC+8)",    offsetMin:  8 * 60 },
  europe:  { label: "Europe (UTC+1)",  offsetMin:  1 * 60 },
  america: { label: "America (UTC-5)", offsetMin: -5 * 60 },
};

export const DEFAULT_REGION = "asia";
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

// HH:MM local time when the extension auto-opens check-in tabs. The user
// claims between 6 to 7pm, so default just before that window.
export const DEFAULT_TRIGGER_TIME = "18:00";

/** Epoch ms of the most recent 00:00-server-time boundary. */
export function lastResetTimestamp(region) {
  const config = Object.hasOwn(REGIONS, region) ? REGIONS[region] : REGIONS[DEFAULT_REGION];
  const { offsetMin } = config;
  const shifted = new Date(Date.now() + offsetMin * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - offsetMin * 60_000;
}

/** Epoch ms of the next 00:00-server-time boundary. */
export function nextResetTimestamp(region) {
  return lastResetTimestamp(region) + 24 * 3600_000;
}

/** True if the user hasn't checked in since the last server reset. */
export function needsCheckIn(lastRunTs, region) {
  if (!Number.isFinite(lastRunTs)) return true;
  if (lastRunTs > Date.now() + FUTURE_TIMESTAMP_TOLERANCE_MS) return true;
  return lastRunTs < lastResetTimestamp(region);
}

export function parseTriggerTime(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi };
}

/** Next local-time occurrence of HH:MM as epoch ms. */
export function nextTriggerTimestamp(triggerTime) {
  const t = parseTriggerTime(triggerTime) ?? parseTriggerTime(DEFAULT_TRIGGER_TIME);
  const now = Date.now();
  const d = new Date(now);
  d.setHours(t.h, t.mi, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Most recent local-time occurrence of HH:MM as epoch ms. */
export function lastTriggerTimestamp(triggerTime) {
  const t = parseTriggerTime(triggerTime) ?? parseTriggerTime(DEFAULT_TRIGGER_TIME);
  const now = Date.now();
  const d = new Date(now);
  d.setHours(t.h, t.mi, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/**
 * True once the current server cycle's trigger time has passed. Recovery
 * paths (watchdog, window-open catch-up) gate on this so a lost alarm is
 * made up after the scheduled time, never before it: a claim pending at
 * 09:00 with an 18:00 trigger still waits for 18:00.
 */
export function triggerDueThisCycle(triggerTime, region) {
  return lastTriggerTimestamp(triggerTime) >= lastResetTimestamp(region);
}
