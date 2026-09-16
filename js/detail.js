/**
 * Summary → detail.
 *
 * Every table on the page now renders twice over: a *summary* (a few essential
 * columns, a few rows) on the page itself, and the *full* table — every column,
 * every row — in a modal.
 *
 * The modal MOVES the live table node instead of cloning it. That matters:
 * sort order, the search filter, lazily-built client detail rows and the
 * "show the rest" rows all carry straight over, and the browser never holds two
 * copies of a 941-client table. The node is put back exactly where it was when
 * the modal closes.
 *
 * The <dialog> lives inside the dashboard root, so the delegated click/input
 * handlers in ui.js keep working on the moved table. showModal() promotes it to
 * the browser's top layer, so nesting it in the page does not affect stacking.
 */

const DIALOG_ID = 'detail-modal';

/** Create the modal once per render. Returns the <dialog>. */
export function mountDetail(root) {
  let dlg = root.querySelector(`#${DIALOG_ID}`);
  if (dlg) return dlg;

  dlg = document.createElement('dialog');
  dlg.id = DIALOG_ID;
  dlg.className = 'detail-modal';
  dlg.innerHTML = `
    <div class="detail-head">
      <div>
        <h2 data-detail-heading></h2>
        <p class="muted fine" data-detail-sub></p>
      </div>
      <button type="button" class="btn btn-quiet btn-sm" data-action="close-detail" aria-label="Close">Close</button>
    </div>
    <div class="detail-body" data-detail-slot></div>`;
  root.appendChild(dlg);

  // Clicking the backdrop closes. The dialog element itself covers the whole
  // viewport, so a click that lands on it (not on a child) is a backdrop click.
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) hide(dlg);
  });
  // Esc. Handled explicitly rather than relying on the dialog's own `close`
  // event, which some engines do not dispatch reliably — and if it never fires,
  // the table never finds its way home.
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    hide(dlg);
  });
  dlg.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      hide(dlg);
    }
  });
  // Belt and braces: anything that closes the dialog some other way still puts
  // the table back. This event is dispatched asynchronously and can land after
  // the modal has already been reopened, which is why restore() refuses to run
  // on an open dialog — otherwise it would yank the table out from under it.
  dlg.addEventListener('close', () => restore(dlg));

  return dlg;
}

/**
 * Open the full table belonging to `container` (an element carrying
 * data-detail-title and holding a [data-detail-body] node).
 */
export function openDetail(root, container) {
  if (!container) return;
  const body = container.querySelector('[data-detail-body]');
  const dlg = mountDetail(root);
  if (!body || dlg.open) return;
  restore(dlg); // rescue anything a previous open left parked (dialog is closed here)

  dlg.querySelector('[data-detail-heading]').textContent =
    container.dataset.detailTitle || 'All details';
  const sub = dlg.querySelector('[data-detail-sub]');
  sub.textContent = container.dataset.detailSub || '';
  sub.hidden = !container.dataset.detailSub;

  // Leave a marker so the table goes back to the same spot, even if the
  // surrounding card has other children.
  const placeholder = document.createElement('div');
  placeholder.hidden = true;
  placeholder.dataset.detailHome = '1';
  body.before(placeholder);

  const slot = dlg.querySelector('[data-detail-slot]');
  slot.replaceChildren(body);
  body.classList.add('is-detail'); // reveals the columns hidden in summary mode

  dlg.showModal();
  slot.scrollTop = 0;
}

/** Close the modal and put the table back. The only way this module closes. */
function hide(dlg) {
  if (dlg.open) dlg.close();
  restore(dlg);
}

/**
 * Put the table back where it came from. Safe to call when nothing is parked,
 * and a no-op while the dialog is open — a late `close` event from a previous
 * open would otherwise empty a modal that has just been reopened.
 */
function restore(dlg) {
  if (dlg.open) return;
  const body = dlg.querySelector('[data-detail-slot] > [data-detail-body]');
  if (!body) return;
  body.classList.remove('is-detail');
  const home = document.querySelector('[data-detail-home]');
  if (home) {
    home.replaceWith(body);
  } else {
    body.remove(); // its card is gone (a re-render happened) — drop it
  }
}

/**
 * Called before a re-render replaces the dashboard's HTML. Without this the
 * moved table would be destroyed mid-flight and never find its way home.
 */
export function closeDetail(root) {
  const dlg = root.querySelector(`#${DIALOG_ID}`);
  if (dlg) hide(dlg);
}
