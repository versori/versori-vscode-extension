import { Control, ControlValues } from './controls';

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
    /** Columns omitted from the table to keep it readable. */
    hiddenColumns?: number;
    error?: string;
    /** Query controls (e.g. the log time range). Rendered above the results. */
    controls?: Control[];
    controlValues?: ControlValues;
    /** Validation problem with the current control selection. */
    controlError?: string;
}

/**
 * Results viewer.
 *
 * Same CSP posture as the form panel: `default-src 'none'`, a per-render nonce,
 * no external resources. All cell text is set via `.textContent`, so CLI output
 * can never be interpreted as markup.
 */
export function renderResultsHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Versori</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 20px 24px;
  }
  h1 { font-size: 1.25em; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0 0 4px; }
  code.cmd {
    display: inline-block;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 16px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
    padding: 12px 14px;
    margin-bottom: 14px;
    border-radius: 3px;
    background: var(--vscode-textBlockQuote-background);
  }
  .controls .ctl { display: flex; flex-direction: column; gap: 4px; }
  .controls label {
    font-size: 0.82em;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .controls select, .controls input {
    padding: 4px 6px;
    font: inherit;
    font-size: 0.92em;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .controls input[type="number"] { width: 90px; }
  .controls select:focus, .controls input:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .controls button.apply {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .ctlError {
    flex-basis: 100%;
    color: var(--vscode-errorForeground, #e03131);
    font-size: 0.88em;
  }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; }
  input[type="search"] {
    flex: 1;
    padding: 5px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  input[type="search"]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button {
    font: inherit;
    padding: 5px 12px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .count { color: var(--vscode-descriptionForeground); font-size: 0.88em; white-space: nowrap; }
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
  .chip {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 0.85em;
    font-weight: 600;
  }
  .chip.error { background: rgba(224,49,49,0.18); color: var(--vscode-errorForeground, #e03131); }
  .chip.warn  { background: rgba(200,150,0,0.20); color: #c89600; }
  .chip.info  { background: rgba(60,140,220,0.18); color: #3c8cdc; }
  .chip.muted { background: rgba(128,128,128,0.18); color: var(--vscode-descriptionForeground); }
  pre#raw {
    display: none;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    padding: 12px;
    border-radius: 3px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
  }
  pre#raw.show { display: block; }
  .empty, .error {
    padding: 20px;
    border-radius: 3px;
    background: var(--vscode-textBlockQuote-background);
    color: var(--vscode-descriptionForeground);
  }
  .error { color: var(--vscode-errorForeground, #e03131); white-space: pre-wrap; }
</style>
</head>
<body>
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter rows...">
    <span class="count" id="count"></span>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div id="body"></div>
  <pre id="raw"></pre>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  let payload = null;
  let controlValues = {};

  function apply() {
    el('heading').textContent = 'Loading...';
    vscode.postMessage({ type: 'refresh', controls: controlValues });
  }

  function renderControls() {
    const host = el('controls');
    host.textContent = '';

    const controls = (payload && payload.controls) || [];
    if (controls.length === 0) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'flex';

    for (const control of controls) {
      if (control.showWhen &&
          String(controlValues[control.showWhen.field]) !== control.showWhen.equals) {
        continue;
      }

      const wrap = document.createElement('div');
      wrap.className = 'ctl';

      const label = document.createElement('label');
      label.textContent = control.label;
      label.htmlFor = 'c_' + control.id;
      wrap.appendChild(label);

      let input;
      if (control.kind === 'select') {
        input = document.createElement('select');
        for (const option of control.options) {
          const node = document.createElement('option');
          node.value = option.value;
          node.textContent = option.label;
          node.selected = option.value === String(controlValues[control.id]);
          input.appendChild(node);
        }
        input.addEventListener('change', () => {
          controlValues[control.id] = input.value;
          // Re-render so conditional fields appear or disappear immediately.
          renderControls();
        });
      } else {
        input = document.createElement('input');
        input.type = control.kind === 'number' ? 'number' : 'datetime-local';
        if (control.min !== undefined) { input.min = String(control.min); }
        input.value = controlValues[control.id] === undefined
          ? ''
          : String(controlValues[control.id]);
        input.addEventListener('change', () => {
          controlValues[control.id] =
            control.kind === 'number' ? Number(input.value) : input.value;
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); } });
      }

      input.id = 'c_' + control.id;
      wrap.appendChild(input);
      host.appendChild(wrap);
    }

    const go = document.createElement('button');
    go.className = 'apply';
    go.textContent = 'Apply';
    go.addEventListener('click', apply);
    host.appendChild(go);

    if (payload && payload.controlError) {
      const err = document.createElement('div');
      err.className = 'ctlError';
      err.textContent = payload.controlError;
      host.appendChild(err);
    }
  }

  function render() {
    if (!payload) { return; }

    if (payload.controlValues) { controlValues = payload.controlValues; }
    renderControls();

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
          payload.columns.some((c) => String(row[c] || '').toLowerCase().includes(needle)))
      : payload.rows;

    const hidden = payload.hiddenColumns
      ? ' · ' + payload.hiddenColumns + ' more columns in Raw JSON'
      : '';
    el('count').textContent = (needle
      ? rows.length + ' of ' + payload.rows.length
      : payload.rows.length + (payload.rows.length === 1 ? ' row' : ' rows')) + hidden;

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
    for (const column of payload.columns) {
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
      for (const column of payload.columns) {
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
  el('toggleRaw').addEventListener('click', () => {
    const raw = el('raw');
    const showing = raw.classList.toggle('show');
    el('toggleRaw').classList.toggle('active', showing);
    el('body').style.display = showing ? 'none' : '';
  });

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'results') {
      payload = event.data.payload;
      render();
    }
  });
}());
</script>
</body>
</html>`;
}
