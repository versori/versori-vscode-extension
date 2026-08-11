import { ENTRY_CSS, htmlDocument } from '../webview/shell';
import { VariableRow } from './rows';

export interface VariablesPayload {
    heading: string;
    subtitle: string;
    command: string;
    variables: VariableRow[];
    rawJson: string;
    error?: string;
}

/**
 * Project DynamicVariablesSchema browser.
 *
 * Declares the keys activations may set. Add / update / remove are posted as
 * messages; removal confirmation lives on the host side.
 */
export function renderVariablesHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori variables',
        styles: ENTRY_CSS + VARIABLES_CSS,
        body: VARIABLES_BODY,
        script: VARIABLES_SCRIPT,
    });
}

const VARIABLES_CSS = `
  .actions { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  .actions button { font-size: 0.88em; padding: 3px 10px; }
  .toolbar .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
`;

const VARIABLES_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter variables...">
    <span class="count" id="count"></span>
    <button id="add" class="primary">Add variable</button>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div id="body"></div>
  <pre id="raw"></pre>
`;

/** Exported for html tests only — embedded by `renderVariablesHtml`. */
export const VARIABLES_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  if (typeof wireNav === 'function') { wireNav(vscode); }

  let payload = null;

  function apply() {
    el('heading').textContent = 'Loading...';
    vscode.postMessage({ type: 'refresh' });
  }

  function matches(row, needle) {
    if (!needle) return true;
    return (row.name + ' ' + row.type + ' ' + row.description + ' ' + row.shape)
      .toLowerCase().includes(needle);
  }

  function actionRow(row) {
    const host = document.createElement('div');
    host.className = 'actions';

    const update = document.createElement('button');
    update.textContent = 'Update';
    update.addEventListener('click', () => {
      vscode.postMessage({ type: 'update', name: row.name });
    });
    host.appendChild(update);

    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      vscode.postMessage({ type: 'remove', name: row.name });
    });
    host.appendChild(remove);

    return host;
  }

  function render() {
    const body = el('body');
    body.textContent = '';

    if (!payload) {
      return;
    }

    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = payload.command;
    el('raw').textContent = payload.rawJson || '';
    hideRawPane();

    if (payload.error) {
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = payload.error;
      body.appendChild(box);
      el('count').textContent = '';
      return;
    }

    const needle = el('filter').value.trim().toLowerCase();
    const shown = payload.variables.filter((row) => matches(row, needle));

    el('count').textContent = needle
      ? shown.length + ' of ' + payload.variables.length
      : payload.variables.length + (payload.variables.length === 1 ? ' variable' : ' variables');

    if (payload.variables.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty';
      box.textContent = 'No results.';
      body.appendChild(box);
      return;
    }

    for (const row of shown) {
      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.dataset.id = row.name;

      const head = document.createElement('div');
      head.className = 'head';

      const req = document.createElement('span');
      req.className = 'st chip ' + (row.required ? 'warn' : 'muted');
      req.textContent = row.required ? 'required' : 'optional';
      head.appendChild(req);

      const type = document.createElement('span');
      type.className = 'sev chip info';
      type.textContent = row.type;
      head.appendChild(type);

      const title = document.createElement('span');
      title.className = 'msg';
      title.textContent = row.name;
      head.appendChild(title);

      if (row.description) {
        const desc = document.createElement('span');
        desc.className = 'count';
        desc.textContent = row.description;
        head.appendChild(desc);
      }

      entry.appendChild(head);
      entry.appendChild(actionRow(row));
      body.appendChild(entry);
    }
  }

  el('refresh').addEventListener('click', apply);
  el('filter').addEventListener('input', render);
  el('add').addEventListener('click', () => {
    vscode.postMessage({ type: 'add' });
  });
  wireRawPane();

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'variables' && message.payload) {
      payload = message.payload;
      render();
    }
  });
})();
`;
