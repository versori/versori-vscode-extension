import { Control, ControlValues } from './controls';
import { htmlDocument } from '../webview/shell';

export interface ResultsPayload {
    heading: string;
    subtitle: string;
    command: string;
    columns: string[];
    rows: Array<Record<string, string>>;
    /** Column whose value drives row colour coding, if any. */
    levelColumn?: string;
    /** Per-row level class, parallel to `rows`. */
    levels: Array<string | undefined>;
    rawJson: string;
    /** Every column the data has. `columns` is the same list; the webview chooses. */
    allColumns: string[];
    error?: string;
    /** Query controls (e.g. the log time range). Rendered above the results. */
    controls?: Control[];
    controlValues?: ControlValues;
    /** Validation problem with the current control selection. */
    controlError?: string;
}

/**
 * Columns shown before the user picks.
 *
 * Beyond about a dozen the table stops being readable, and `deriveColumns` has
 * already put the preferred and most-populated ones first — so the default is
 * the useful prefix rather than an arbitrary truncation.
 */
export const DEFAULT_COLUMNS = 12;

/**
 * Results viewer.
 *
 * Chrome, CSP and control rendering come from `src/webview/shell.ts`, shared
 * with the log panel. All cell text is set via `.textContent`, so CLI output can
 * never be interpreted as markup.
 */
export function renderResultsHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori',
        styles: RESULTS_CSS,
        body: RESULTS_BODY,
        script: RESULTS_SCRIPT,
    });
}

const RESULTS_CSS = `
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92em; }
  th, td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
    vertical-align: top;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
    font-weight: 600;
    white-space: nowrap;
  }
  tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  td { max-width: 620px; overflow-wrap: anywhere; }
`;

const RESULTS_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter rows...">
    <span class="count" id="count"></span>
    <span id="columnPicker"></span>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div id="body"></div>
  <pre id="raw"></pre>
`;

/**
 * Exported so `html.test.ts` can execute it against a stubbed DOM, the same way
 * `LOGS_SCRIPT` and `FIELD_PICKER_SCRIPT` are executed in their own test files.
 * Nothing outside the tests should reference it — `renderResultsHtml` embeds it.
 */
export const RESULTS_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  if (typeof wireNav === 'function') { wireNav(vscode); }
  let payload = null;
  let controlValues = {};
  let shownColumns = null;

  function apply() {
    el('heading').textContent = 'Loading...';
    vscode.postMessage({ type: 'refresh', controls: controlValues });
  }

  function controls() {
    renderControls(
      el('controls'),
      (payload && payload.controls) || [],
      controlValues,
      (id, value) => { controlValues[id] = value; },
      apply,
      payload && payload.controlError,
    );
  }

  function pickColumns() {
    // Reset whenever the shape changes — a new command's columns are unrelated
    // to the previous one's.
    const all = payload.allColumns || [];
    if (shownColumns === null || shownColumns.some((c) => !all.includes(c))) {
      shownColumns = all.slice(0, ${DEFAULT_COLUMNS});
    }

    renderFieldPicker(el('columnPicker'), 'Columns', all, shownColumns, (next) => {
      // Keep the data's own order, so ticking a column does not reshuffle the table.
      shownColumns = all.filter((c) => next.includes(c));
      pickColumns();
      render();
    });
  }

  function render() {
    if (!payload) { return; }

    if (payload.controlValues) { controlValues = payload.controlValues; }
    controls();
    pickColumns();

    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = '$ ' + payload.command;
    el('raw').textContent = payload.rawJson;

    const body = el('body');
    body.textContent = '';

    if (payload.error) {
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = payload.error;
      body.appendChild(box);
      el('count').textContent = '';
      return;
    }

    const needle = el('filter').value.trim().toLowerCase();
    const rows = needle
      ? payload.rows.filter((row, i) =>
          shownColumns.some((c) => String(row[c] || '').toLowerCase().includes(needle)))
      : payload.rows;

    el('count').textContent = needle
      ? rows.length + ' of ' + payload.rows.length
      : payload.rows.length + (payload.rows.length === 1 ? ' row' : ' rows');

    if (payload.rows.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty';
      // An empty result is a normal outcome, not a failure — say so plainly.
      box.textContent = (payload.controls && payload.controls.length > 0)
        ? 'No results in this window. Try a wider time range.'
        : 'No results.';
      body.appendChild(box);
      return;
    }

    const scroll = document.createElement('div');
    scroll.className = 'scroll';
    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const column of shownColumns) {
      const th = document.createElement('th');
      th.textContent = column;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < payload.rows.length; i++) {
      const row = payload.rows[i];
      if (needle && !rows.includes(row)) { continue; }

      const tr = document.createElement('tr');
      for (const column of shownColumns) {
        const td = document.createElement('td');
        const value = row[column] || '';

        if (column === payload.levelColumn && payload.levels[i]) {
          const chip = document.createElement('span');
          chip.className = 'chip ' + payload.levels[i];
          chip.textContent = value;
          td.appendChild(chip);
        } else {
          td.textContent = value;
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    body.appendChild(scroll);
  }

  el('filter').addEventListener('input', render);
  el('refresh').addEventListener('click', apply);
  wireRawPane();

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'results') {
      payload = event.data.payload;
      // Shared with the KV, log and issue panels — see RAW_PANE_SCRIPT. Here the
      // reset sits on the payload path rather than inside render(), because
      // render() is also the filter and column-picker handler: a keystroke is
      // not new data and must not slam the pane shut mid-read.
      hideRawPane();
      render();
    }
  });
}());
`;
