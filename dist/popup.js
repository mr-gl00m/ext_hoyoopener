/**
 * HoyoOpener Popup: status, manual trigger, settings.
 */

import {
  STORAGE_KEYS,
  TARGETS,
  REGIONS,
  DEFAULT_REGION,
  DEFAULT_TRIGGER_TIME,
  needsCheckIn,
  parseTriggerTime,
} from "./shared.js";

const STORAGE_AREA = "local";
const ALL_KEYS = [
  STORAGE_KEYS.LAST_RUN,
  STORAGE_KEYS.ENABLED_GAMES,
  STORAGE_KEYS.REGION,
  STORAGE_KEYS.TRIGGER_TIME,
];

document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get(ALL_KEYS);
  document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
  renderStatus(data);
  renderGameToggles(data);
  renderRegionPicker(data);
  renderTriggerTime(data);
  bindOpenButton();
  bindResetButton();
  bindStorageWatcher();
});

// ─── Status ──────────────────────────────────────────────────────────────────

async function renderStatus(data) {
  const d = data ?? await chrome.storage.local.get([STORAGE_KEYS.LAST_RUN, STORAGE_KEYS.REGION]);
  const lastRun = d[STORAGE_KEYS.LAST_RUN];
  const region = d[STORAGE_KEYS.REGION] ?? DEFAULT_REGION;
  const done = !needsCheckIn(lastRun, region);

  const statusEl = document.getElementById("status");
  const textEl = document.getElementById("statusText");
  const footerEl = document.getElementById("lastRun");
  const resetBtn = document.getElementById("resetBtn");

  statusEl.className = `status ${done ? "done" : "pending"}`;
  textEl.textContent = done ? "Checked in this cycle" : "Pending this cycle";
  footerEl.textContent = typeof lastRun === "number"
    ? `Last opened: ${new Date(lastRun).toLocaleString()}`
    : "No check-ins yet";
  resetBtn.hidden = !done;
}

// ─── Game Toggles ────────────────────────────────────────────────────────────

function readEnabledMap(raw) {
  return raw && typeof raw === "object" ? raw : {};
}

function renderGameToggles(data) {
  const enabled = readEnabledMap(data[STORAGE_KEYS.ENABLED_GAMES]);
  const container = document.getElementById("gameList");

  for (const { game } of TARGETS) {
    const isOn = enabled[game] !== false;

    const row = document.createElement("div");
    row.className = "game-row";

    const name = document.createElement("span");
    name.className = "game-name";
    name.textContent = game;

    const label = document.createElement("label");
    label.className = "toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = isOn;
    input.dataset.game = game;
    input.setAttribute("aria-label", `Toggle ${game}`);

    const slider = document.createElement("span");
    slider.className = "slider";

    input.addEventListener("change", async () => {
      const requested = input.checked;
      input.disabled = true;
      try {
        await saveGameToggle(game, requested);
      } catch {
        input.checked = !requested;
      } finally {
        input.disabled = false;
      }
    });

    label.append(input, slider);
    row.append(name, label);
    container.appendChild(row);
  }
}

// Serialize toggle writes because concurrent read-modify-write on enabledGames
// would lose updates if the user clicks two toggles before the first write
// finishes.
let toggleWriteQueue = Promise.resolve();
function saveGameToggle(game, isEnabled) {
  toggleWriteQueue = toggleWriteQueue
    .catch(() => {})
    .then(async () => {
      const { [STORAGE_KEYS.ENABLED_GAMES]: stored } =
        await chrome.storage.local.get(STORAGE_KEYS.ENABLED_GAMES);
      const cur = readEnabledMap(stored);
      cur[game] = isEnabled;
      await chrome.storage.local.set({ [STORAGE_KEYS.ENABLED_GAMES]: cur });
    });
  return toggleWriteQueue;
}

function syncToggleDom(enabled) {
  const map = readEnabledMap(enabled);
  const inputs = document.querySelectorAll('#gameList input[type="checkbox"]');
  for (const input of inputs) {
    const want = map[input.dataset.game] !== false;
    if (input.checked !== want) input.checked = want;
  }
}

// ─── Region Picker ───────────────────────────────────────────────────────────

function renderRegionPicker(data) {
  const stored = data[STORAGE_KEYS.REGION];
  const current = Object.hasOwn(REGIONS, stored) ? stored : DEFAULT_REGION;
  const select = document.getElementById("region");
  select.dataset.savedValue = current;

  for (const [key, { label }] of Object.entries(REGIONS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    if (key === current) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", async () => {
    const requested = select.value;
    select.disabled = true;
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.REGION]: requested });
      select.dataset.savedValue = requested;
      renderStatus();
    } catch {
      select.value = select.dataset.savedValue;
    } finally {
      select.disabled = false;
    }
  });
}

// ─── Trigger Time ────────────────────────────────────────────────────────────

function renderTriggerTime(data) {
  const stored = data[STORAGE_KEYS.TRIGGER_TIME];
  const current = parseTriggerTime(stored) ? stored : DEFAULT_TRIGGER_TIME;
  const input = document.getElementById("triggerTime");
  input.value = current;
  input.dataset.savedValue = current;

  input.addEventListener("change", async () => {
    if (!parseTriggerTime(input.value)) {
      input.value = input.dataset.savedValue;
      return;
    }
    const requested = input.value;
    input.disabled = true;
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.TRIGGER_TIME]: requested });
      input.dataset.savedValue = requested;
    } catch {
      input.value = input.dataset.savedValue;
    } finally {
      input.disabled = false;
    }
  });
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

function bindOpenButton() {
  const btn = document.getElementById("openAll");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Opening...";

    try {
      const res = await chrome.runtime.sendMessage({ action: "openAll" });
      if (res?.error) {
        btn.textContent = "Error";
      } else if (res?.success > 0) {
        btn.textContent = `Opened ${res.success}!`;
      } else if (res?.skipped === "none-enabled") {
        btn.textContent = "No games enabled";
      } else if (res?.skipped === "in-progress") {
        btn.textContent = "Already running...";
      } else if (res?.failed > 0) {
        btn.textContent = "Failed. See console";
      } else {
        btn.textContent = "Nothing to do";
      }
    } catch {
      btn.textContent = "Error";
    }

    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Open All Check-ins";
      renderStatus();
    }, 1200);
  });
}

function bindResetButton() {
  const btn = document.getElementById("resetBtn");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Resetting...";

    let succeeded = false;
    try {
      const response = await chrome.runtime.sendMessage({ action: "resetToday" });
      if (response?.error) throw new Error(response.error);
      succeeded = true;
    } catch {
      try {
        await chrome.storage.local.remove(STORAGE_KEYS.LAST_RUN);
        succeeded = true;
      } catch {
        succeeded = false;
      }
    }

    if (succeeded) renderStatus();
    btn.disabled = false;
    btn.textContent = succeeded ? "Reset today" : "Reset failed";
  });
}

// ─── Storage Watcher ─────────────────────────────────────────────────────────

// Keep the popup DOM in sync if storage is modified elsewhere (a second popup
// instance, a settings reset from background, etc.). DOM diffing avoids
// flicker when the change came from this same popup.
function bindStorageWatcher() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== STORAGE_AREA) return;

    if (STORAGE_KEYS.LAST_RUN in changes || STORAGE_KEYS.REGION in changes) {
      renderStatus();
    }

    if (STORAGE_KEYS.ENABLED_GAMES in changes) {
      syncToggleDom(changes[STORAGE_KEYS.ENABLED_GAMES].newValue);
    }

    if (STORAGE_KEYS.REGION in changes) {
      const sel = document.getElementById("region");
      const stored = changes[STORAGE_KEYS.REGION].newValue;
      const v = Object.hasOwn(REGIONS, stored) ? stored : DEFAULT_REGION;
      if (sel.value !== v) sel.value = v;
      sel.dataset.savedValue = v;
    }

    if (STORAGE_KEYS.TRIGGER_TIME in changes) {
      const inp = document.getElementById("triggerTime");
      const stored = changes[STORAGE_KEYS.TRIGGER_TIME].newValue;
      const v = parseTriggerTime(stored) ? stored : DEFAULT_TRIGGER_TIME;
      if (inp.value !== v) inp.value = v;
      inp.dataset.savedValue = v;
    }
  });
}
