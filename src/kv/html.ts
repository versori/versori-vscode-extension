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
 * KV browser with confirmed set / delete / wipe actions.
 *
 * One expandable entry per row: the key and its createdAt collapsed, the stored
 * value plus TTL and versionstamp on expand. The value is off-screen by default
 * and revealing it is a deliberate click — that affordance is the only
 * protection here, because a KV entry's field names are literally `key` and
 * `value`, so the branch's key-name redaction has nothing to match on.
 *
 * Mutations never happen in the webview: it only posts intents (key / action).
 * The extension host collects values via InputBox, confirms with a modal, and
 * runs the CLI with `--yes` / `--confirm`.
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
  .paging { display: flex; gap: 8px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
  .row-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .row-actions button { font-size: 0.88em; padding: 3px 10px; }
  .member .trash {
    margin-left: auto;
    flex: none;
    font-size: 0.85em;
    padding: 1px 6px;
    color: var(--vscode-errorForeground, #e03131);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.7;
  }
  .member .trash:hover { opacity: 1; border-color: var(--vscode-errorForeground, #e03131); }
  .member { display: flex; gap: 4px; align-items: baseline; padding: 1px 0 1px 16px; }
  .mkey, .mval {
    cursor: text;
    border-radius: 2px;
    padding: 0 3px;
    white-space: pre-wrap;
  }
  .mkey { font-weight: 600; flex: none; }
  .mkey:hover, .mval:hover { background: var(--vscode-list-hoverBackground); outline: 1px dashed var(--vscode-focusBorder); }
  .inline-input, .json-box {
    box-sizing: border-box;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 3px 6px;
  }
  .inline-input:focus, .json-box:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .json-box { width: 100%; resize: vertical; min-height: 4.5em; }
  .member .json-box { flex: 1; width: auto; min-height: 0; }
  .add-row { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; flex-wrap: wrap; }
  .val-error { color: var(--vscode-errorForeground, #e03131); font-size: 0.88em; margin-top: 4px; }
  .draft-bar {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    margin-top: 8px; padding: 4px 8px; border-radius: 4px;
    background: rgba(128,128,128,0.15);
  }
  .draft-bar .msg { flex: 1; }
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
    <button id="setEntry">Set entry</button>
    <button id="wipePrefix">Wipe prefix</button>
    <button id="refresh">Refresh</button>
  </div>

  <p class="note">
    The filter box searches <strong>only the entries loaded on this page</strong> —
    <code>kv list</code> has no server-side search. Narrow with <strong>Key prefix</strong>,
    or walk the store with <strong>Next</strong>. Entries come back newest first by internal
    id, not by key. Values stay collapsed until you expand a row. Edit shows the value as raw JSON;
    click a key or value of an object to change just that part. Set / Edit / Delete / Wipe
    ask the host to confirm before calling the CLI.
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
  if (typeof wireNav === 'function') { wireNav(vscode); }

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

  function actionButton(label, type, key) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      if (event && event.stopPropagation) { event.stopPropagation(); }
      vscode.postMessage({ type: type, key: key });
    });
    return button;
  }

  function parseJson(text) {
    if (typeof text !== 'string') { return { ok: false, error: 'no JSON available' }; }
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
  }

  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function pretty(v) { return JSON.stringify(v, null, 2); }

  function mk(tag, className, text) {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function plainButton(label, onClick) {
    const button = mk('button', '', label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  // defineProperty, not assignment: a stored key called "__proto__" must stay a
  // plain own key instead of rewriting the object's prototype.
  function setOwn(obj, key, value) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, writable: true, configurable: true });
  }

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function textRows(text) { return Math.min(10, Math.max(2, text.split('\\n').length)); }

  /**
   * Value editor for one entry. Everything here is local until Save: edits stage
   * a draft, and only Save posts, so the host's confirm modal is one decision for
   * the whole change and a cancelled modal loses nothing.
   */
  function buildDetail(entry, detail) {
    const parsed = parseJson(entry.valueJson);
    const base = parsed.ok ? parsed.value : undefined;
    const objectValue = parsed.ok && isPlainObject(base);
    const st = { mode: 'view', draft: null, editing: null, adding: null, rawText: null, error: '' };
    const current = () => (st.draft || base);

    const list = document.createElement('dl');
    const dt = mk('dt', '', 'value');
    const valueHost = mk('dd', 'val');
    list.appendChild(dt);
    list.appendChild(valueHost);
    addField(list, 'expires', entry.expiresAt || 'never');
    addField(list, 'created', entry.rawCreatedAt);
    addField(list, 'versionstamp', entry.versionstamp);
    detail.appendChild(list);

    let focusNode = null;

    function save(text, expiresAt) {
      vscode.postMessage({
        type: 'save',
        key: entry.key,
        value: text,
        expiresAt: expiresAt !== undefined ? expiresAt : (entry.rawExpiresAt || ''),
      });
    }

    function stage(next) {
      st.draft = next;
      st.editing = null;
      st.adding = null;
      st.error = '';
      renderValue();
    }

    function copyWith(replaceKey, newKey, newValue) {
      const out = {};
      for (const k of Object.keys(current())) {
        if (k === replaceKey) { setOwn(out, newKey, newValue); }
        else { setOwn(out, k, current()[k]); }
      }
      return out;
    }

    function keyInput(k) {
      const input = mk('input', 'inline-input');
      input.type = 'text';
      input.value = k;
      focusNode = input;
      let done = false;
      const finish = (commit) => {
        if (done) { return; }
        done = true;
        if (!commit || input.value === k) {
          st.editing = null; st.error = ''; renderValue(); return;
        }
        const next = input.value;
        if (next === '') { st.error = 'A key cannot be empty.'; renderValue(); return; }
        if (hasOwn(current(), next)) { st.error = 'Key "' + next + '" already exists.'; renderValue(); return; }
        stage(copyWith(k, next, current()[k]));
      };
      input.addEventListener('keydown', (e) => {
        if (e && e.key === 'Enter') { finish(true); }
        else if (e && e.key === 'Escape') { finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      return input;
    }

    function valueInput(k) {
      const text = st.editing.text !== undefined ? st.editing.text : pretty(current()[k]);
      const input = mk('textarea', 'json-box');
      input.value = text;
      input.rows = textRows(text);
      focusNode = input;
      let done = false;
      const finish = (commit) => {
        if (done) { return; }
        done = true;
        if (!commit) { st.editing = null; st.error = ''; renderValue(); return; }
        const result = parseJson(input.value);
        if (!result.ok) {
          st.editing = { key: k, part: 'value', text: input.value };
          st.error = 'Value must be valid JSON (strings need quotes): ' + result.error;
          renderValue();
          return;
        }
        if (pretty(result.value) === pretty(current()[k])) {
          st.editing = null; st.error = ''; renderValue(); return;
        }
        stage(copyWith(k, k, result.value));
      };
      input.addEventListener('keydown', (e) => {
        if (e && e.key === 'Escape') { finish(false); }
        else if (e && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { finish(true); }
      });
      input.addEventListener('blur', () => finish(true));
      return input;
    }

    function renderAdd() {
      const row = mk('div', 'add-row');
      const keyBox = mk('input', 'inline-input');
      keyBox.type = 'text';
      keyBox.placeholder = 'key';
      keyBox.value = st.adding.key;
      keyBox.addEventListener('input', () => { st.adding.key = keyBox.value; });
      const valBox = mk('input', 'inline-input');
      valBox.type = 'text';
      valBox.placeholder = 'value (JSON, e.g. "text", 1, true, {})';
      valBox.value = st.adding.text;
      valBox.addEventListener('input', () => { st.adding.text = valBox.value; });
      focusNode = keyBox;
      row.appendChild(keyBox);
      row.appendChild(valBox);
      row.appendChild(plainButton('Add', () => {
        const key = st.adding.key;
        if (key === '') { st.error = 'A key cannot be empty.'; renderValue(); return; }
        if (hasOwn(current(), key)) { st.error = 'Key "' + key + '" already exists.'; renderValue(); return; }
        const result = parseJson(st.adding.text);
        if (!result.ok) {
          st.error = 'Value must be valid JSON (strings need quotes): ' + result.error;
          renderValue();
          return;
        }
        const next = {};
        for (const k of Object.keys(current())) { setOwn(next, k, current()[k]); }
        setOwn(next, key, result.value);
        stage(next);
      }));
      row.appendChild(plainButton('Cancel', () => { st.adding = null; st.error = ''; renderValue(); }));
      valueHost.appendChild(row);
    }

    // The host asks "are you sure" (a webview cannot show a modal), then saves the
    // object without that member. Anything already staged is saved with it.
    function removeMember(k) {
      const next = {};
      for (const other of Object.keys(current())) {
        if (other !== k) { setOwn(next, other, current()[other]); }
      }
      vscode.postMessage({
        type: 'deleteMember',
        key: entry.key,
        member: k,
        memberValue: JSON.stringify(current()[k]),
        value: JSON.stringify(next),
        expiresAt: entry.rawExpiresAt || '',
        includesDraft: Boolean(st.draft),
      });
    }

    function renderMembers() {
      const obj = current();
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        valueHost.appendChild(mk('div', '', '{}'));
      } else {
        valueHost.appendChild(mk('div', '', '{'));
      }
      keys.forEach((k, index) => {
        const row = mk('div', 'member');
        const editingHere = st.editing && st.editing.key === k;
        if (editingHere && st.editing.part === 'key') {
          row.appendChild(keyInput(k));
        } else {
          const label = mk('span', 'mkey', k);
          label.title = 'Click to rename this key';
          label.addEventListener('click', () => { st.editing = { key: k, part: 'key' }; st.error = ''; renderValue(); });
          row.appendChild(label);
        }
        row.appendChild(mk('span', '', ':'));
        if (editingHere && st.editing.part === 'value') {
          row.appendChild(valueInput(k));
        } else {
          const val = mk('span', 'mval', pretty(obj[k]));
          val.title = 'Click to edit this value as JSON';
          val.addEventListener('click', () => { st.editing = { key: k, part: 'value' }; st.error = ''; renderValue(); });
          row.appendChild(val);
        }
        // Trailing commas so the view still reads as the JSON it is.
        if (index < keys.length - 1) { row.appendChild(mk('span', '', ',')); }
        const trash = mk('button', 'trash', '\uD83D\uDDD1');
        trash.type = 'button';
        trash.title = 'Delete "' + k + '" from this entry';
        trash.setAttribute('aria-label', 'Delete ' + k);
        trash.addEventListener('click', () => removeMember(k));
        row.appendChild(trash);
        valueHost.appendChild(row);
      });
      if (keys.length > 0) { valueHost.appendChild(mk('div', '', '}')); }
      if (st.adding) { renderAdd(); }
    }

    // The whole entry as one document. Only value and expiresAt are writable
    // (kv set can change nothing else); the rest is shown for context and
    // checked unchanged, so a typo in a read-only field cannot be silently dropped.
    function fullEntry() {
      return {
        key: entry.key,
        value: parsed.ok ? current() : entry.value,
        createdAt: entry.rawCreatedAt,
        expiresAt: entry.rawExpiresAt || null,
        versionstamp: entry.versionstamp,
      };
    }

    function checkEntryJson(text) {
      const result = parseJson(text);
      if (!result.ok) { return { ok: false, error: 'Not valid JSON: ' + result.error }; }
      const doc = result.value;
      if (!isPlainObject(doc)) { return { ok: false, error: 'Must be a JSON object with a "value" field.' }; }
      if (!hasOwn(doc, 'value')) { return { ok: false, error: 'Missing "value".' }; }
      const original = fullEntry();
      for (const field of ['key', 'createdAt', 'versionstamp']) {
        if (doc[field] !== original[field]) {
          return { ok: false, error: '"' + field + '" is read-only here — change "value" or "expiresAt".' };
        }
      }
      const expires = doc.expiresAt === undefined ? null : doc.expiresAt;
      if (expires !== null && (typeof expires !== 'string' || !Number.isFinite(Date.parse(expires)))) {
        return { ok: false, error: '"expiresAt" must be null or an ISO date string.' };
      }
      return { ok: true, value: doc.value, expiresAt: expires };
    }

    function renderRaw() {
      const area = mk('textarea', 'json-box');
      area.value = st.rawText !== null ? st.rawText : pretty(fullEntry());
      area.rows = textRows(area.value);
      focusNode = area;
      valueHost.appendChild(area);
      const problem = mk('div', 'val-error');
      const saveBtn = plainButton('Save', () => {
        const checked = checkEntryJson(area.value);
        if (checked.ok) { save(JSON.stringify(checked.value), checked.expiresAt || ''); }
      });
      const check = () => {
        st.rawText = area.value;
        const checked = checkEntryJson(area.value);
        problem.textContent = checked.ok ? '' : checked.error;
        saveBtn.disabled = !checked.ok;
      };
      area.addEventListener('input', check);
      check();
      valueHost.appendChild(problem);
      const bar = mk('div', 'row-actions');
      bar.appendChild(saveBtn);
      bar.appendChild(plainButton('Cancel', () => { st.mode = 'view'; st.rawText = null; renderValue(); }));
      valueHost.appendChild(bar);
    }

    function renderValue() {
      focusNode = null;
      valueHost.textContent = '';
      if (st.mode === 'raw') {
        renderRaw();
      } else if (!objectValue) {
        // Strings, numbers, arrays and anything unparsable stay read-only here;
        // Edit opens the whole value as JSON.
        valueHost.textContent = entry.value;
      } else {
        renderMembers();
      }
      if (st.error && st.mode !== 'raw') { valueHost.appendChild(mk('div', 'val-error', st.error)); }
      if (st.draft && st.mode !== 'raw') {
        const bar = mk('div', 'draft-bar');
        bar.appendChild(mk('span', 'msg', 'Unsaved changes'));
        bar.appendChild(plainButton('Save changes', () => save(JSON.stringify(st.draft))));
        bar.appendChild(plainButton('Discard', () => { st.draft = null; st.error = ''; renderValue(); }));
        valueHost.appendChild(bar);
      }
      if (focusNode && focusNode.focus) { focusNode.focus(); }
    }

    const actions = mk('div', 'row-actions');
    actions.appendChild(plainButton('Edit', () => {
      st.mode = 'raw'; st.rawText = null; st.editing = null; st.adding = null; st.error = '';
      renderValue();
    }));
    const add = plainButton('Add key/value', () => {
      st.mode = 'view'; st.editing = null; st.error = '';
      st.adding = { key: '', text: '""' };
      renderValue();
    });
    if (!objectValue) {
      add.disabled = true;
      add.title = 'Only available when the value is a JSON object';
    }
    actions.appendChild(add);
    actions.appendChild(actionButton('Delete', 'delete', entry.key));
    detail.appendChild(actions);

    renderValue();
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
      buildDetail(entry, detail);

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

  el('setEntry').addEventListener('click', () => {
    vscode.postMessage({ type: 'set', controls: controlValues });
  });
  el('wipePrefix').addEventListener('click', () => {
    vscode.postMessage({ type: 'wipe', controls: controlValues });
  });

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
