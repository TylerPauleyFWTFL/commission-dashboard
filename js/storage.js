/**
 * Safe localStorage wrapper.
 *
 * Storage throws outright in some contexts (private windows, browsers set to
 * block site data), and a thrown read must never take the dashboard down — so
 * every access is guarded and failures degrade to "nothing remembered".
 */

const PREFIX = 'fwdash:';

let available = null;
function usable() {
  if (available !== null) return available;
  try {
    const probe = `${PREFIX}__probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function read(key, fallback = null) {
  if (!usable()) return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  if (!usable()) return false;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded, or storage disabled mid-session
  }
}

export function remove(key) {
  if (!usable()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to do */
  }
}

/* ------------------------------------------------------ handled findings */

/**
 * Findings are marked handled per report, so "already asked about this" on one
 * file does not silently hide an identical-looking issue in someone else's.
 *
 * Keyed on the data itself — span and size — because the export carries no
 * identifier for whose report it is.
 */
export function reportKey(ds) {
  const from = ds.range.first.toISOString().slice(0, 10);
  const to = ds.range.asOf.toISOString().slice(0, 10);
  return `${from}|${to}|${ds.records.length}`;
}

/* ------------------------------------------------------------ owner name */

/**
 * Who the report belongs to.
 *
 * Never derived from the file: the export has no field for it, and guessing from
 * Referral Source produced confidently wrong names. The reader tells us once and
 * we remember it on their device.
 */
export const getOwnerName = () => read('ownerName', '') || '';
export const setOwnerName = (name) => write('ownerName', String(name || '').trim().slice(0, 80));

const handledKey = (report) => `handled:${report}`;

export function getHandled(report) {
  const list = read(handledKey(report), []);
  return new Set(Array.isArray(list) ? list : []);
}

export function setHandled(report, cardId, isHandled) {
  const set = getHandled(report);
  if (isHandled) set.add(cardId);
  else set.delete(cardId);
  write(handledKey(report), [...set]);
  return set;
}

/* ------------------------------------------------------------- prefs */

export const getPref = (name, fallback) => read(`pref:${name}`, fallback);
export const setPref = (name, value) => write(`pref:${name}`, value);
