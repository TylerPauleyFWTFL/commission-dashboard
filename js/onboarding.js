/**
 * "How do I get my file?" — the step the dashboard previously skipped entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO: the steps below are placeholders. Replace the strings
 * in EXPORT_STEPS and PORTAL_NAME with your real click-path. Everything the
 * coach reads about exporting lives in this one file — nothing else needs
 * editing, and the wording flows through to the landing page automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** TODO: the name coaches actually see for the portal. */
export const PORTAL_NAME = 'your affiliate portal';

/** TODO: replace with the real navigation path. Keep them short and literal. */
export const EXPORT_STEPS = [
  'Sign in to <strong>your affiliate portal</strong>.',
  'Open <strong>Reports</strong> from the menu.',
  'Choose the date range you want — the last 12 months is a good place to start.',
  'Click <strong>Export</strong> and choose <strong>CSV</strong>.',
  'Save the file somewhere you can find it, like your Downloads folder.',
];

/**
 * Columns worth switching on before exporting. These names must match the
 * header text in the export, because that is what the dashboard looks for.
 */
export const EXTRA_COLUMNS = [
  { name: 'Order ID', why: 'lets the report match refunds to the original charge' },
  { name: 'Paid', why: 'shows what you are still owed' },
  { name: 'Campaign Name', why: 'groups your earnings by type' },
  { name: 'Note', why: 'explains why anything was adjusted' },
];

const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The panel is open by default and collapses once she has successfully loaded a
 * file, so it helps the first time and stays out of the way afterwards.
 */
export function onboardingPanel({ expanded = true } = {}) {
  return `
  <details class="howto" id="howto" ${expanded ? 'open' : ''}>
    <summary>
      <span class="howto-title">How do I get my file?</span>
      <span class="howto-hint">Step-by-step</span>
    </summary>
    <div class="howto-body">
      <ol class="howto-steps">
        ${EXPORT_STEPS.map((s) => `<li>${s}</li>`).join('')}
      </ol>

      <div class="howto-callout">
        <p><strong>Before you export, switch these on if you can.</strong>
        Your report still works without them — you will just see more with them.</p>
        <ul>
          ${EXTRA_COLUMNS.map(
            (c) => `<li><strong>${esc(c.name)}</strong> — ${esc(c.why)}</li>`
          ).join('')}
        </ul>
        <p class="muted fine">Not sure how? Export what you have and load it anyway —
        the report will tell you exactly what is missing.</p>
      </div>
    </div>
  </details>`;
}
