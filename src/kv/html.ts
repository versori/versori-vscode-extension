import { Control, ControlValues } from '../results/controls';
import { ENTRY_CSS, htmlDocument } from '../webview/shell';
import { KvEntry } from './entries';

export interface KvPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: Control[];
    controlValues: ControlValues;
    /** Validation problem with the current control selection. */
    controlError?: string;
    /** The loaded page, in the order the CLI returned it (newest first). */
    entries: KvEntry[];
    /** 1-based position in the cursor walk. There is no total to show. */
    page: number;
    /**
     * Whether the last response carried a cursor in each direction.
     *
     * Booleans rather than the cursors themselves: the webview asks to move by
     * *direction* and the host resolves that against its own copy, so nothing
     * the webview sends can steer which page is fetched. (The cursors do reach
     * the webview inside `rawJson`, since that is the verbatim response — but
     * they are inert there: `turnPage` ignores any value a message carries.)
     */
    hasNext: boolean;
    hasPrev: boolean;
    rawJson: string;
    error?: string;
}

/** Result of an on-demand `kv count`, posted only after the user asks for one. */
export interface KvCountMessage {
    type: 'count';
    total?: number;
    error?: string;
}

/**
 * KV browser. Read-only.
 *
 * One expandable entry per row: the key and its createdAt collapsed, the stored
 * value plus TTL and versionstamp on expand. The value is off-screen by default
 * and revealing it is a deliberate click — that affordance is the only
 * protection here, because a KV entry's field names are literally `key` and
 * `value`, so the branch's key-name redaction has nothing to match on.
 *
 * `kv set` / `delete` / `wipe` are deliberately absent: they mutate live
 * workflow state and stay in the terminal with their safety prompts.
 */
export function renderKvHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori KV',
        styles: ENTRY_CSS + KV_CSS,
        body: KV_BODY,
        script: KV_SCRIPT,
    });
}

const KV_CSS = `
  .key {
    flex: 1;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow-wrap: anywhere;
  }
  .detail dd.val { white-space: pre-wrap; }
  .note { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 0 0 12px; }
  .paging { display: flex; gap: 8px; align-items: center; margin-top: 16px; }
  button:disabled { opacity: 0.45; cursor: default; }
  button:disabled:hover { background: var(--vscode-button-secondaryBackground); }
`;

const KV_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter this page by key or value...">
    <span class="count" id="count"></span>
    <button id="expandAll">Expand all</button>
    <button id="toggleRaw">Raw JSON (all values)</button>
    <button id="refresh">Refresh</button>
  </div>

  <p class="note">
    The filter box searches <strong>only the entries loaded on this page</strong> —
    <code>kv list</code> has no server-side search. Narrow with <strong>Key prefix</strong>,
    or walk the store with <strong>Next</strong>. Entries come back newest first by internal
    id, not by key.
  </p>

  <div id="body"></div>
  <pre id="raw"></pre>

  <div class="paging">
    <button id="prevPage">Previous</button>
    <button id="nextPage">Next</button>
    <span class="count" id="pageInfo"></span>
    <button id="runCount">Count all</button>
    <span class="count" id="total"></span>
  </div>
`;

/**
 * Exported so `html.test.ts` can execute it against a stubbed DOM, the same way
 * `LOGS_SCRIPT` and `ISSUES_SCRIPT` are. Nothing outside the tests should
 * reference it — `renderKvHtml` embeds it.
 */
export const KV_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);

  let payload = null;
  let controlValues = {};
  // Whether the single expand/collapse control is currently in the "all open"
  // position. Reset on every list render so a refresh never leaves values shown.
  let allOpen = false;

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

  function addField(list, key, value, className) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    list.appendChild(dt);
    const dd = document.createElement('dd');
    if (className) { dd.className = className; }
    dd.textContent = value;
    list.appendChild(dd);
  }

  function setExpandLabel() {
    el('expandAll').textContent = allOpen ? 'Collapse all' : 'Expand all';
  }

  function setTwist(row, open) {
    row.classList.toggle('open', open);
    row.querySelector('.twist').textContent = open ? '\\u25be' : '\\u25b8';
  }

  function box(host, className, text) {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = text;
    host.appendChild(node);
  }

  function renderEntries() {
    const body = el('body');
    body.textContent = '';

    // Every render starts collapsed: the stored value is only ever on screen
    // because the user asked for it in this render, not a previous one.
    allOpen = false;
    setExpandLabel();

    if (payload.error) {
      box(body, 'error', payload.error);
      el('count').textContent = '';
      return;
    }

    if (payload.entries.length === 0) {
      box(body, 'empty', 'No entries for this scope and prefix.');
      el('count').textContent = '';
      return;
    }

    const needle = el('filter').value.trim().toLowerCase();
    const shown = needle
      ? payload.entries.filter((entry) => entry.searchText.toLowerCase().includes(needle))
      : payload.entries;

    // Always says "on this page", because that is all it ever counted.
    el('count').textContent = needle
      ? shown.length + ' of ' + payload.entries.length + ' on this page'
      : payload.entries.length +
        (payload.entries.length === 1 ? ' entry' : ' entries') + ' on this page';

    if (shown.length === 0) {
      box(body, 'empty',
        'No entries on this page match that filter. Other pages are not searched — ' +
        'use Key prefix, or Next.');
      return;
    }

    for (const entry of shown) {
      const row = document.createElement('div');
      row.className = 'entry';

      const head = document.createElement('div');
      head.className = 'head';

      const twist = document.createElement('span');
      twist.className = 'twist';
      twist.textContent = '\\u25b8';
      head.appendChild(twist);

      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = entry.createdAt;
      head.appendChild(ts);

      // Key only. The value is never in the head — see renderKvHtml's comment.
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = entry.key;
      head.appendChild(key);

      head.addEventListener('click', () => {
        setTwist(row, !row.classList.contains('open'));
      });
      row.appendChild(head);

      const detail = document.createElement('div');
      detail.className = 'detail';
      const list = document.createElement('dl');
      addField(list, 'value', entry.value, 'val');
      // The TTL: when this entry disappears on its own.
      addField(list, 'expires', entry.expiresAt || 'never');
      addField(list, 'created', entry.rawCreatedAt);
      addField(list, 'versionstamp', entry.versionstamp);
      detail.appendChild(list);
      row.appendChild(detail);

      body.appendChild(row);
    }
  }

  function renderPaging() {
    el('nextPage').disabled = !payload.hasNext;
    el('prevPage').disabled = !payload.hasPrev;
    el('pageInfo').textContent = payload.page > 1
      ? 'Page ' + payload.page + ' · Refresh returns to the first page'
      : 'Page ' + payload.page;
  }

  function render() {
    if (payload.controlValues) { controlValues = payload.controlValues; }

    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = '$ ' + payload.command;
    el('raw').textContent = payload.rawJson;
    // A total belongs to the query that produced it. This render may be a
    // different query, so the old number goes rather than sitting there looking
    // current.
    el('total').textContent = '';

    // Shared with the log, issue and results panels — see RAW_PANE_SCRIPT. Runs
    // on every render for the same reason renderEntries resets allOpen.
    hideRawPane();
    controls();
    renderEntries();
    renderPaging();
  }

  // Filtering is local to the loaded page, so it never re-runs the CLI.
  el('filter').addEventListener('input', () => { if (payload) { renderEntries(); } });
  el('refresh').addEventListener('click', apply);

  el('expandAll').addEventListener('click', () => {
    allOpen = !allOpen;
    // Only the rows the filter left on screen; a hidden row is not "visible".
    for (const row of document.querySelectorAll('.entry')) {
      setTwist(row, allOpen);
    }
    setExpandLabel();
  });

  wireRawPane();

  // Direction only. The cursors themselves stay in the extension host, which is
  // what stops a key ever being passed where an opaque cursor belongs.
  el('nextPage').addEventListener('click', () => {
    if (payload && payload.hasNext) { vscode.postMessage({ type: 'page', direction: 'next' }); }
  });
  el('prevPage').addEventListener('click', () => {
    if (payload && payload.hasPrev) { vscode.postMessage({ type: 'page', direction: 'prev' }); }
  });

  // On demand only, and wired to nothing else: a total costs a second CLI spawn,
  // so loading, refreshing and paging deliberately do not ask for one.
  el('runCount').addEventListener('click', () => {
    el('total').textContent = 'Counting...';
    vscode.postMessage({ type: 'count' });
  });

  function showTotal(message) {
    if (message.error) {
      el('total').textContent = 'Could not count: ' + message.error;
      return;
    }

    // Says "separate" out loud: this is a second call against the whole prefix,
    // so it can disagree with the page on screen if the store is being written.
    el('total').textContent =
      message.total + ' under this prefix (separate count — may differ from this page)';
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) { return; }

    if (data.type === 'kv') {
      payload = data.payload;
      render();
    } else if (data.type === 'count') {
      showTotal(data);
    }
  });
}());
`;
