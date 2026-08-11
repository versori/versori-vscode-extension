import { Control, ControlValues } from '../results/controls';
import { ENTRY_CSS, htmlDocument } from '../webview/shell';
import { LogEntry } from './entries';

export interface LogsPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: Control[];
    controlValues: ControlValues;
    /** Validation problem with the current control selection. */
    controlError?: string;
    entries: LogEntry[];
    /** Every field key present, most-populated first. Drives the field picker. */
    fieldKeys: string[];
    /** Distinct severities present, worst first. Drives the severity chips. */
    severities: string[];
    rawJson: string;
    error?: string;
}

/**
 * Log viewer.
 *
 * One entry per row: `timestamp · severity · message`, expandable to every
 * field. Filtering happens in the extension host (src/logs/filter.ts) and comes
 * back as surviving indices, so no filter logic is duplicated in this untested
 * inline script.
 */
export function renderLogsHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori logs',
        styles: ENTRY_CSS + LOGS_CSS,
        body: LOGS_BODY,
        script: LOGS_SCRIPT,
    });
}

const LOGS_CSS = `
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
  }
  .filters .fld { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 200px; }
  .filters label { font-size: 0.8em; font-weight: 600; color: var(--vscode-descriptionForeground); }
  .filters input[type="text"] {
    padding: 5px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .filters input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .sevs { display: flex; gap: 5px; flex-wrap: wrap; }
  .sevs button { padding: 2px 9px; border-radius: 9px; font-size: 0.85em; font-weight: 600; }
  .caseBox { display: flex; gap: 5px; align-items: center; font-size: 0.85em; }
`;

const LOGS_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="filters">
    <div class="fld">
      <label for="include">Include (any of, comma-separated)</label>
      <input type="text" id="include" placeholder="e.g. get-pricing, sync-orders">
    </div>
    <div class="fld">
      <label for="exclude">Exclude (any of, comma-separated)</label>
      <input type="text" id="exclude" placeholder="e.g. heartbeat, DurableInterpreter">
    </div>
  </div>

  <div class="toolbar">
    <div class="sevs" id="sevs"></div>
    <label class="caseBox"><input type="checkbox" id="caseSensitive"> Match case</label>
    <span class="count" id="count"></span>
    <span id="fieldPicker"></span>
    <button id="expandAll">Expand all</button>
    <button id="collapseAll">Collapse all</button>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div id="body"></div>
  <pre id="raw"></pre>
`;

/**
 * Exported so `html.test.ts` can execute it against a stubbed DOM, the same way
 * `CONTROLS_SCRIPT` and `FIELD_PICKER_SCRIPT` are executed in `shell.test.ts`.
 * Nothing outside the tests should reference it — `renderLogsHtml` embeds it.
 */
export const LOGS_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  if (typeof wireNav === 'function') { wireNav(vscode); }

  let payload = null;
  let controlValues = {};
  let inlineFields = [];
  let severities = [];
  let debounce = null;

  function currentFilter() {
    return {
      include: el('include').value,
      exclude: el('exclude').value,
      severities: severities.slice(),
      caseSensitive: el('caseSensitive').checked,
    };
  }

  function apply() {
    el('heading').textContent = 'Loading...';
    vscode.postMessage({ type: 'refresh', controls: controlValues });
  }

  function requestFilter() {
    vscode.postMessage({ type: 'filter', filter: currentFilter() });
  }

  function requestFilterSoon() {
    if (debounce) { clearTimeout(debounce); }
    debounce = setTimeout(requestFilter, 120);
  }

  function controls() {
    renderControls(
      el('controls'),
      payload ? payload.controls : [],
      controlValues,
      // Store only: renderControls owns its own re-render, and re-rendering here
      // too would destroy the focused input mid-edit.
      (id, value) => { controlValues[id] = value; },
      apply,
      payload && payload.controlError,
    );
  }

  function fields() {
    renderFieldPicker(el('fieldPicker'), 'Fields', payload ? payload.fieldKeys : [],
      inlineFields, (next) => { inlineFields = next; fields(); renderEntries(); });
  }

  // What this page contains, plus anything still selected that it does not.
  // Refreshing into a window with no errors must not strand a user who had
  // selected 'error': the filter would hide every row while no chip rendered
  // active, and toggling another chip would not clear it. Keeping the selection
  // rather than dropping it means an "errors only" view survives a quiet
  // window, and the appended chip is the one click that undoes it.
  function chipSeverities() {
    const present = payload ? payload.severities : [];
    return present.concat(severities.filter((s) => !present.includes(s)));
  }

  function sevChips() {
    const host = el('sevs');
    host.textContent = '';

    for (const severity of chipSeverities()) {
      const chip = document.createElement('button');
      chip.textContent = severity;
      chip.classList.toggle('active', severities.includes(severity));
      chip.addEventListener('click', () => {
        severities = severities.includes(severity)
          ? severities.filter((s) => s !== severity)
          : severities.concat([severity]);
        sevChips();
        requestFilter();
      });
      host.appendChild(chip);
    }
  }

  function renderEntries() {
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

    if (payload.entries.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty';
      box.textContent = 'No log entries in this window. Try a wider time range.';
      body.appendChild(box);
      el('count').textContent = '';
      return;
    }

    payload.entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'entry';
      row.dataset.index = String(index);

      const head = document.createElement('div');
      head.className = 'head';

      const twist = document.createElement('span');
      twist.className = 'twist';
      twist.textContent = '\\u25b8';
      head.appendChild(twist);

      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = entry.timestamp;
      head.appendChild(ts);

      if (entry.severity) {
        const sev = document.createElement('span');
        sev.className = 'sev chip ' + (entry.level || 'muted');
        sev.textContent = entry.severity;
        head.appendChild(sev);
      }

      // The message is the title — the one thing every entry has and the one
      // thing worth reading at a glance.
      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.textContent = entry.message;
      head.appendChild(msg);

      if (inlineFields.length > 0) {
        const inline = document.createElement('span');
        inline.className = 'inline';
        for (const key of inlineFields) {
          const field = entry.fields.find((f) => f.key === key);
          if (!field) { continue; }
          const kv = document.createElement('span');
          kv.className = 'kv';
          kv.textContent = key.split('.').pop() + '=' + field.value;
          inline.appendChild(kv);
        }
        head.appendChild(inline);
      }

      head.addEventListener('click', () => {
        const open = row.classList.toggle('open');
        twist.textContent = open ? '\\u25be' : '\\u25b8';
      });
      row.appendChild(head);

      const detail = document.createElement('div');
      detail.className = 'detail';
      const list = document.createElement('dl');

      if (entry.rawTimestamp) {
        addField(list, 'timestamp', entry.rawTimestamp);
      }
      for (const field of entry.fields) {
        addField(list, field.key, field.value);
      }
      if (entry.fields.length === 0) {
        addField(list, '(no fields)', '');
      }

      detail.appendChild(list);
      row.appendChild(detail);
      body.appendChild(row);
    });

    requestFilter();
  }

  function addField(list, key, value) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    list.appendChild(dt);
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.appendChild(dd);
  }

  function applyVisible(indices, total) {
    const keep = new Set(indices);
    for (const row of document.querySelectorAll('.entry')) {
      row.classList.toggle('hidden', !keep.has(Number(row.dataset.index)));
    }
    el('count').textContent = indices.length === total
      ? total + (total === 1 ? ' entry' : ' entries')
      : indices.length + ' of ' + total;
  }

  function render() {
    if (payload.controlValues) { controlValues = payload.controlValues; }

    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = '$ ' + payload.command;
    el('raw').textContent = payload.rawJson;

    // Shared with the KV, issue and results panels — see RAW_PANE_SCRIPT. This
    // panel needs it most: log fields are workflow-authored, so the per-field
    // expand is the real protection and a persistent raw pane would bypass it.
    hideRawPane();

    controls();
    fields();
    sevChips();
    renderEntries();
  }

  el('include').addEventListener('input', requestFilterSoon);
  el('exclude').addEventListener('input', requestFilterSoon);
  el('caseSensitive').addEventListener('change', requestFilter);
  el('refresh').addEventListener('click', apply);
  el('expandAll').addEventListener('click', () => {
    for (const row of document.querySelectorAll('.entry')) {
      row.classList.add('open');
      row.querySelector('.twist').textContent = '\\u25be';
    }
  });
  el('collapseAll').addEventListener('click', () => {
    for (const row of document.querySelectorAll('.entry')) {
      row.classList.remove('open');
      row.querySelector('.twist').textContent = '\\u25b8';
    }
  });
  wireRawPane();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) { return; }

    if (data.type === 'logs') {
      payload = data.payload;
      render();
    } else if (data.type === 'visible') {
      applyVisible(data.indices, data.total);
    }
  });
}());
`;
