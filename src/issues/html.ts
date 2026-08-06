import { LogField } from '../logs/entries';
import { Control, ControlValues } from '../results/controls';
import { ENTRY_CSS, htmlDocument } from '../webview/shell';
import { ISSUE_SEVERITIES } from './args';
import { IssueRow } from './rows';

export interface IssuesPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: Control[];
    controlValues: ControlValues;
    controlError?: string;
    issues: IssueRow[];
    rawJson: string;
    error?: string;
}

/** Detail posted back when a row is expanded. */
export interface IssueDetailMessage {
    type: 'detail';
    id: string;
    fields: LogField[];
    error?: string;
}

/**
 * Issues viewer.
 *
 * Title as the headline with severity and status chips; expanding a row fetches
 * `issues get` for its full detail. Status and severity are editable in place —
 * every one of those transitions is reversible with another `issues update`,
 * so they are not behind a modal confirmation.
 */
export function renderIssuesHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori issues',
        styles: ENTRY_CSS + ISSUES_CSS,
        body: ISSUES_BODY,
        script: ISSUES_SCRIPT,
    });
}

const ISSUES_CSS = `
  .actions { display: flex; gap: 6px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .actions button { font-size: 0.88em; padding: 3px 10px; }
  .actions select {
    font: inherit;
    font-size: 0.88em;
    padding: 3px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .st { flex: none; }
  #notifications { margin-top: 26px; }
  #notifications h2 { font-size: 1.02em; margin: 0 0 8px; }
`;

const ISSUES_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter issues...">
    <span class="count" id="count"></span>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div id="body"></div>
  <pre id="raw"></pre>

  <div id="notifications"></div>
`;

/**
 * Exported so `html.test.ts` can execute it against a stubbed DOM, the same way
 * `LOGS_SCRIPT` is. Nothing outside the tests should reference it —
 * `renderIssuesHtml` embeds it.
 */
export const ISSUES_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);

  let payload = null;
  let controlValues = {};

  function apply() {
    el('heading').textContent = 'Loading...';
    vscode.postMessage({ type: 'refresh', controls: controlValues });
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

  function severityOptions(current) {
    const select = document.createElement('select');
    // Interpolated from ISSUE_SEVERITIES so the accepted values live in one
    // place — an inline script cannot import them.
    for (const value of ${JSON.stringify(ISSUE_SEVERITIES)}) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === current;
      select.appendChild(option);
    }
    return select;
  }

  function actionRow(issue) {
    const host = document.createElement('div');
    host.className = 'actions';

    // Only the transitions that make sense from the current status, so the row
    // does not offer to acknowledge something already resolved.
    const targets = issue.status === 'open'
      ? [['Acknowledge', 'acked'], ['Resolve', 'resolved'], ['Close', 'closed']]
      : (issue.status === 'closed' || issue.status === 'resolved'
          ? [['Reopen', 'open']]
          : [['Resolve', 'resolved'], ['Close', 'closed'], ['Reopen', 'open']]);

    for (const [label, status] of targets) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'update', id: issue.id, change: { status: status } });
      });
      host.appendChild(button);
    }

    const label = document.createElement('span');
    label.className = 'count';
    label.textContent = 'Severity';
    host.appendChild(label);

    const select = severityOptions(issue.severity);
    select.addEventListener('change', () => {
      vscode.postMessage({ type: 'update', id: issue.id, change: { severity: select.value } });
    });
    host.appendChild(select);

    return host;
  }

  function addField(list, key, value) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    list.appendChild(dt);
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.appendChild(dd);
  }

  function renderIssues() {
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
    const shown = payload.issues.filter((issue) =>
      !needle ||
      (issue.title + ' ' + issue.message + ' ' + issue.status + ' ' + issue.severity)
        .toLowerCase().includes(needle));

    el('count').textContent = needle
      ? shown.length + ' of ' + payload.issues.length
      : payload.issues.length + (payload.issues.length === 1 ? ' issue' : ' issues');

    if (payload.issues.length === 0) {
      const box = document.createElement('div');
      box.className = 'empty';
      box.textContent = 'No issues for this environment and filter.';
      body.appendChild(box);
      return;
    }

    for (const issue of shown) {
      const row = document.createElement('div');
      row.className = 'entry';
      row.dataset.id = issue.id;

      const head = document.createElement('div');
      head.className = 'head';

      const twist = document.createElement('span');
      twist.className = 'twist';
      twist.textContent = '\\u25b8';
      head.appendChild(twist);

      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = issue.lastSeen;
      head.appendChild(ts);

      if (issue.severity) {
        const sev = document.createElement('span');
        sev.className = 'sev chip ' + (issue.severityLevel || 'muted');
        sev.textContent = issue.severity;
        head.appendChild(sev);
      }

      const status = document.createElement('span');
      status.className = 'st chip muted';
      status.textContent = issue.status;
      head.appendChild(status);

      const title = document.createElement('span');
      title.className = 'msg';
      title.textContent = issue.title;
      head.appendChild(title);

      if (issue.seenCount) {
        // ENTRY_CSS styles .kv only inside .inline, the same wrapper the log
        // rows use for their trailing chips.
        const inline = document.createElement('span');
        inline.className = 'inline';
        const seen = document.createElement('span');
        seen.className = 'kv';
        seen.textContent = 'seen=' + issue.seenCount;
        inline.appendChild(seen);
        head.appendChild(inline);
      }

      const detail = document.createElement('div');
      detail.className = 'detail';

      const list = document.createElement('dl');
      list.dataset.for = issue.id;
      if (issue.message) { addField(list, 'message', issue.message); }
      for (const field of issue.fields) { addField(list, field.key, field.value); }
      detail.appendChild(list);
      detail.appendChild(actionRow(issue));

      head.addEventListener('click', () => {
        const open = row.classList.toggle('open');
        twist.textContent = open ? '\\u25be' : '\\u25b8';
        // Fetch the authoritative detail once, on first expand.
        if (open && !row.dataset.loaded) {
          row.dataset.loaded = '1';
          vscode.postMessage({ type: 'detail', id: issue.id });
        }
      });

      row.appendChild(head);
      row.appendChild(detail);
      body.appendChild(row);
    }
  }

  function applyDetail(message) {
    const list = document.querySelector('dl[data-for="' + message.id + '"]');
    if (!list) { return; }

    list.textContent = '';
    if (message.error) {
      addField(list, 'could not load detail', message.error);
      return;
    }
    for (const field of message.fields) { addField(list, field.key, field.value); }
  }

  function render() {
    if (payload.controlValues) { controlValues = payload.controlValues; }

    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = '$ ' + payload.command;
    el('raw').textContent = payload.rawJson;

    controls();
    renderIssues();
  }

  el('filter').addEventListener('input', () => { if (payload) { renderIssues(); } });
  el('refresh').addEventListener('click', apply);
  el('toggleRaw').addEventListener('click', () => {
    const raw = el('raw');
    const showing = raw.classList.toggle('show');
    el('toggleRaw').classList.toggle('active', showing);
    el('body').style.display = showing ? 'none' : '';
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) { return; }

    if (data.type === 'issues') {
      payload = data.payload;
      render();
    } else if (data.type === 'detail') {
      applyDetail(data);
    }
  });
}());
`;
