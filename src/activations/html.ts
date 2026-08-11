import { Control, ControlValues } from '../results/controls';
import { ENTRY_CSS, htmlDocument } from '../webview/shell';
import { ActivationRow } from './rows';

export interface ActivationsPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: Control[];
    controlValues: ControlValues;
    controlError?: string;
    active: ActivationRow[];
    inactive: ActivationRow[];
    rawJson: string;
    error?: string;
}

export interface ActivationDetailMessage {
    type: 'detail';
    externalId: string;
    heading: string;
    connections: Array<{ id: string; name: string; systemId: string; templateId: string; baseUrl: string }>;
    variableNames: string[];
    rawJson: string;
    error?: string;
}

/**
 * Users / activations browser.
 *
 * Active and inactive end-users are listed in separate groups. Mutations
 * (create user, activate, deactivate, set variable) are posted as messages;
 * confirmation for destructive actions lives on the host side.
 */
export function renderActivationsHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori activations',
        styles: ENTRY_CSS + ACTIVATIONS_CSS,
        body: ACTIVATIONS_BODY,
        script: ACTIVATIONS_SCRIPT,
    });
}

const ACTIVATIONS_CSS = `
  .actions { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  .actions button { font-size: 0.88em; padding: 3px 10px; }
  .group { margin-top: 18px; }
  .group h2 { font-size: 1.02em; margin: 0 0 8px; }
  .toolbar .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .detail {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 3px;
    background: var(--vscode-textBlockQuote-background);
  }
  .detail h3 { margin: 0 0 6px; font-size: 0.95em; }
  .detail .empty { margin: 4px 0; }
`;

const ACTIVATIONS_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter users...">
    <span class="count" id="count"></span>
    <button id="createUser" class="primary">Create user</button>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div id="body"></div>
  <pre id="raw"></pre>
`;

/**
 * Exported so html tests can execute it against a stubbed DOM.
 * Nothing outside tests should import this — `renderActivationsHtml` embeds it.
 */
export const ACTIVATIONS_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  if (typeof wireNav === 'function') { wireNav(vscode); }

  let payload = null;
  let controlValues = {};
  const openDetails = new Set();

  function apply() {
    el('heading').textContent = 'Loading...';
    vscode.postMessage({ type: 'refresh', controls: controlValues });
  }

  function controls() {
    renderControls(
      el('controls'),
      payload ? payload.controls : [],
      controlValues,
      (id, value) => { controlValues[id] = value; },
      apply,
      payload && payload.controlError,
    );
  }

  function matches(row, needle) {
    if (!needle) return true;
    return (row.displayName + ' ' + row.externalId + ' ' + row.status + ' ' + row.activationId)
      .toLowerCase().includes(needle);
  }

  function actionRow(row) {
    const host = document.createElement('div');
    host.className = 'actions';

    const details = document.createElement('button');
    details.textContent = 'Details';
    details.addEventListener('click', (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: 'detail', externalId: row.externalId });
    });
    host.appendChild(details);

    if (row.status === 'active') {
      const setVar = document.createElement('button');
      setVar.textContent = 'Set variable';
      setVar.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'setVariable', externalId: row.externalId, label: row.displayName });
      });
      host.appendChild(setVar);

      const deactivate = document.createElement('button');
      deactivate.textContent = 'Deactivate';
      deactivate.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'deactivate', externalId: row.externalId, label: row.displayName });
      });
      host.appendChild(deactivate);
    } else {
      const activate = document.createElement('button');
      activate.textContent = 'Activate';
      activate.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'activate', externalId: row.externalId, label: row.displayName });
      });
      host.appendChild(activate);
    }

    return host;
  }

  function renderGroup(title, rows, needle) {
    const section = document.createElement('div');
    section.className = 'group';

    const heading = document.createElement('h2');
    heading.textContent = title + ' (' + rows.length + ')';
    section.appendChild(heading);

    const shown = rows.filter((row) => matches(row, needle));
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'None.';
      section.appendChild(empty);
      return section;
    }
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No matches in this group.';
      section.appendChild(empty);
      return section;
    }

    for (const row of shown) {
      const entry = document.createElement('div');
      entry.className = 'entry';
      entry.dataset.id = row.externalId;

      const head = document.createElement('div');
      head.className = 'head';

      const twist = document.createElement('span');
      twist.className = 'twist';
      twist.textContent = openDetails.has(row.externalId) ? '\\u25be' : '\\u25b8';
      head.appendChild(twist);

      const status = document.createElement('span');
      status.className = 'st chip ' + (row.status === 'active' ? 'info' : 'muted');
      status.textContent = row.status;
      head.appendChild(status);

      const titleEl = document.createElement('span');
      titleEl.className = 'msg';
      titleEl.textContent = row.displayName || row.externalId;
      head.appendChild(titleEl);

      const meta = document.createElement('span');
      meta.className = 'count';
      meta.textContent = row.externalId;
      head.appendChild(meta);

      head.addEventListener('click', () => {
        if (openDetails.has(row.externalId)) {
          openDetails.delete(row.externalId);
          render();
          return;
        }
        openDetails.add(row.externalId);
        render();
        vscode.postMessage({ type: 'detail', externalId: row.externalId });
      });

      entry.appendChild(head);
      entry.appendChild(actionRow(row));

      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.hidden = !openDetails.has(row.externalId);
      detail.dataset.detailFor = row.externalId;
      if (openDetails.has(row.externalId)) {
        const pending = document.createElement('div');
        pending.className = 'empty';
        pending.textContent = 'Loading details...';
        detail.appendChild(pending);
      }
      entry.appendChild(detail);

      section.appendChild(entry);
    }

    return section;
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
    controls();

    if (payload.error) {
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = payload.error;
      body.appendChild(box);
      el('count').textContent = '';
      return;
    }

    const needle = el('filter').value.trim().toLowerCase();
    const total = payload.active.length + payload.inactive.length;
    const shown =
      payload.active.filter((row) => matches(row, needle)).length +
      payload.inactive.filter((row) => matches(row, needle)).length;

    el('count').textContent = needle
      ? shown + ' of ' + total
      : total + (total === 1 ? ' user' : ' users');

    if (total === 0) {
      const box = document.createElement('div');
      box.className = 'empty';
      box.textContent = 'No results.';
      body.appendChild(box);
      return;
    }

    body.appendChild(renderGroup('Active', payload.active, needle));
    body.appendChild(renderGroup('Inactive', payload.inactive, needle));
  }

  function fillDetail(message) {
    const nodes = document.querySelectorAll('[data-detail-for=\"' + message.externalId + '\"]');
    for (const node of nodes) {
      node.textContent = '';
      if (message.error) {
        const err = document.createElement('div');
        err.className = 'error';
        err.textContent = message.error;
        node.appendChild(err);
        continue;
      }

      const heading = document.createElement('h3');
      heading.textContent = message.heading || 'Activation details';
      node.appendChild(heading);

      const connTitle = document.createElement('div');
      connTitle.className = 'count';
      connTitle.textContent = 'Connections (credentials redacted)';
      node.appendChild(connTitle);

      if (!message.connections || message.connections.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No connections on this activation.';
        node.appendChild(empty);
      } else {
        for (const conn of message.connections) {
          const line = document.createElement('div');
          line.textContent =
            (conn.name || conn.id) +
            (conn.baseUrl ? ' · ' + conn.baseUrl : '') +
            (conn.id ? ' · ' + conn.id : '');
          node.appendChild(line);
        }
      }

      const varTitle = document.createElement('div');
      varTitle.className = 'count';
      varTitle.style.marginTop = '8px';
      varTitle.textContent = 'Declared variable keys';
      node.appendChild(varTitle);

      if (!message.variableNames || message.variableNames.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No activation variables set.';
        node.appendChild(empty);
      } else {
        const keys = document.createElement('div');
        keys.textContent = message.variableNames.join(', ');
        node.appendChild(keys);
      }
    }
  }

  el('refresh').addEventListener('click', apply);
  el('filter').addEventListener('input', render);
  el('createUser').addEventListener('click', () => {
    vscode.postMessage({ type: 'createUser' });
  });
  wireRawPane();

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'activations' && message.payload) {
      payload = message.payload;
      controlValues = { ...(payload.controlValues || {}) };
      render();
      return;
    }
    if (message.type === 'detail') {
      openDetails.add(message.externalId);
      render();
      fillDetail(message);
    }
  });
})();
`;
