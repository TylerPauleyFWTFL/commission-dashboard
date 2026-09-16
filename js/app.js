/**
 * Entry point: file in → dashboard out. Everything runs locally in the browser;
 * no network request is ever made with the affiliate's data.
 */

import { parseCsv } from './csv.js';
import { detectSchema, missingRequired, capabilities } from './schema.js';
import { buildDataset, exportTimestampFromFilename } from './model.js';
import { resolveRange, availableRanges } from './period.js';
import { renderDashboard } from './ui.js';
import { escapeHtml } from './format.js';
import { getPref, setPref, getOwnerName as ownerName } from './storage.js';
import { onboardingPanel } from './onboarding.js';

const intro = document.getElementById('intro');
const dashboard = document.getElementById('dashboard');
const errorBox = document.getElementById('error');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');

/** Everything needed to re-render at a different date range. */
let state = null;

const SAMPLES = {
  // The default affiliate view: Created, Commission, Status, Client Name,
  // Client Email, Product, Referral Source. This is what most people will load.
  default: { path: 'sample/sample-default-view.csv', name: 'grid_2026-09-13_18-12-57_1079948831.csv' },
  // Exports with extra view columns switched on, which unlock further sections.
  extended: { path: 'sample/sample-extended.csv', name: 'grid_2026-09-13_17-16-01_115948374.csv' },
  semicolon: { path: 'sample/sample-semicolon.csv', name: 'grid_2026-09-13_17-09-00_330595319.csv' },
};

/* ------------------------------------------------------------------ errors */

function showError(message, hint) {
  errorBox.innerHTML = `
    <p class="error-title">${escapeHtml(message)}</p>
    ${hint ? `<p class="muted">${escapeHtml(hint)}</p>` : ''}`;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

/* ------------------------------------------------------------- processing */

function process(text, filename) {
  clearError();

  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) {
    throw new Error('That file has headings but no payments in it.');
  }

  const schema = detectSchema(parsed.headers);
  const lacking = missingRequired(schema);
  if (lacking.length) {
    const names = lacking.map((f) => f.label).join(' and ');
    throw new Error(
      `This file does not have ${lacking.length > 1 ? 'columns' : 'a column'} called ${names}.`,
      { cause: 'required' }
    );
  }

  const meta = {
    filename,
    exportedAt: exportTimestampFromFilename(filename),
    delimiter: parsed.delimiter,
  };

  state = {
    parsed, schema, meta,
    caps: capabilities(schema),
    range: getPref('range', 'all'),
    custom: getPref('customDates', {}),
    full: null,
  };
  render();

  // Once she has loaded a file successfully, the how-to panel collapses.
  setPref('hasLoadedFile', true);
  window.scrollTo({ top: 0 });
}

/** Build (or rebuild) the dataset for the active period and draw it. */
function render() {
  if (!state) return;
  const { parsed, schema, meta, caps } = state;

  // The unfiltered dataset defines the bounds every range is measured against,
  // and supplies the previous-period comparison, which by definition lies
  // outside the current window.
  const full = state.full || (state.full = buildDataset(parsed, schema, meta));
  const bounds = full.range;

  const resolved = resolveRange(state.range, bounds.asOf, bounds, state.custom);

  const at = schema.index.created;
  const rows = parsed.rows.filter((r) => {
    const d = parseRowDate(r[at]);
    return d && d >= resolved.from && d <= resolved.to;
  });

  if (rows.length === 0) {
    showError(
      'No payments in that time period.',
      'Try a longer period, or pick different dates.'
    );
    return; // keep the previous view on screen rather than blanking it
  }
  clearError();

  const ds = buildDataset({ ...parsed, rows }, schema, meta);
  document.title = ownerName() ? `${ownerName()} — Commission Report` : 'Your Commission Report';

  intro.hidden = true;
  dashboard.hidden = false;
  renderDashboard(ds, caps, dashboard, {
    range: state.range,
    rangeLabel: resolved.label,
    custom: state.custom,
    ranges: availableRanges(bounds),
    bounds,
    fullDataset: full,
    resolvedRange: resolved,
  });
}

/** Dates in the raw grid are "YYYY-MM-DD HH:MM:SS"; parse without timezone drift. */
function parseRowDate(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function handleText(text, filename) {
  try {
    process(text, filename);
  } catch (err) {
    console.error(err);
    reset();
    showError(
      err.message || 'That file could not be read.',
      'This should be the commission report you download from your affiliate portal. It needs at least a "Created" column and a "Commission" column.'
    );
  }
}

function readFile(file) {
  if (!file) return;
  const looksTabular = /\.(csv|tsv|txt)$/i.test(file.name) || /text|csv/i.test(file.type);
  if (!looksTabular) {
    showError(
      `"${file.name}" does not look like a spreadsheet file.`,
      'It needs to be the CSV file you download from your affiliate portal.'
    );
    return;
  }

  const reader = new FileReader();
  reader.onload = () => handleText(String(reader.result), file.name);
  reader.onerror = () => showError('That file could not be opened.');
  reader.readAsText(file);
}

function reset() {
  state = null;
  dashboard.hidden = true;
  dashboard.innerHTML = '';
  intro.hidden = false;
  fileInput.value = '';
  document.title = 'Your Commission Report';
}

/* --------------------------------------------------------------- wiring */

fileInput.addEventListener('change', (e) => readFile(e.target.files[0]));

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragging');
  })
);
['dragleave', 'drop'].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'dragleave' && dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove('is-dragging');
  })
);
dropzone.addEventListener('drop', (e) => readFile(e.dataTransfer?.files?.[0]));

document.querySelectorAll('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const sample = SAMPLES[btn.dataset.sample];
    if (!sample) return;
    btn.disabled = true;
    try {
      const res = await fetch(sample.path);
      if (!res.ok) throw new Error(`Sample data could not be loaded (${res.status}).`);
      handleText(await res.text(), sample.name);
    } catch (err) {
      showError(
        'The example could not be loaded.',
        'Examples only work when this page is opened from a web address, not from a file on your computer.'
      );
    } finally {
      btn.disabled = false;
    }
  });
});

// The dashboard asks for these via bubbling events rather than importing app state.
document.addEventListener('dashboard:reset', reset);
document.addEventListener('dashboard:rerender', () => render());
document.addEventListener('dashboard:range', (e) => {
  if (!state) return;
  state.range = e.detail.range;
  render();
});
document.addEventListener('dashboard:custom', (e) => {
  if (!state) return;
  state.custom = { ...state.custom, ...e.detail };
  setPref('customDates', state.custom);
  render();
});
document.addEventListener('dashboard:owner', () => render());

// The "how do I get my file?" steps live in one editable module.
const howto = document.getElementById('howto-slot');
if (howto) {
  howto.innerHTML = onboardingPanel({ expanded: !getPref('hasLoadedFile', false) });
}
