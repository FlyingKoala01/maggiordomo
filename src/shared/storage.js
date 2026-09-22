// Thin wrapper over chrome.storage.local. All data stays on this machine.
export const storage = {
  async get(key, fallback = null) {
    const result = await chrome.storage.local.get(key);
    return result[key] === undefined ? fallback : result[key];
  },
  async set(key, value) {
    return chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    return chrome.storage.local.remove(key);
  },
  async all() {
    return chrome.storage.local.get(null);
  },
  onChange(key, callback) {
    const handler = (changes, area) => {
      if (area === 'local' && changes[key]) callback(changes[key].newValue, changes[key].oldValue);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};

// Per-tool scratch state (last inputs, options) so a tool reopens where you left it.
const TOOL_STATE_KEY = 'toolState';
const MAX_PERSISTED_STRING = 200 * 1024;

export async function loadToolState(toolId, defaults = {}) {
  const all = await storage.get(TOOL_STATE_KEY, {});
  return { ...defaults, ...(all[toolId] || {}) };
}

export async function saveToolState(toolId, patch) {
  const all = await storage.get(TOOL_STATE_KEY, {});
  const safe = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string' && v.length > MAX_PERSISTED_STRING) continue;
    safe[k] = v;
  }
  all[toolId] = { ...(all[toolId] || {}), ...safe };
  return storage.set(TOOL_STATE_KEY, all);
}
