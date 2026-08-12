import { Control, ControlValues } from '../results/controls';
import { ENTRY_CSS, htmlDocument } from '../webview/shell';
import { LogEntry } from './entries';
import { LogGroup } from './groups';
import { LiveStatus } from './live';

export interface LogsPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: Control[];
    controlValues: ControlValues;
    /** Validation problem with the current control selection. */
    controlError?: string;
    entries: LogEntry[];
    /** Distinct severities present, worst first. Drives the severity chips. */
    severities: string[];
    rawJson: string;
    error?: string;
    live: LiveStatus;
    /**
     * True when this payload is a live merge rather than a replacement load. The
     * webview keeps its scroll position and pending count across a merge, and
     * resets them on a replacement.
     */
    merged?: boolean;
    /** How many entries the merge prepended. Feeds the pending-new count. */
    added?: number;
}

/** Host → webview: which rows survive the current filter (and optional groups). */
export interface VisibleMessage {
    type: 'visible';
    indices: number[];
    total: number;
    groups?: LogGroup[];
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
  .filters textarea {
    padding: 5px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .filters textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .filters textarea { resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
  .sevs { display: flex; gap: 5px; flex-wrap: wrap; }
  .sevs button { padding: 2px 9px; border-radius: 9px; font-size: 0.85em; font-weight: 600; }
  .caseBox { display: flex; gap: 5px; align-items: center; font-size: 0.85em; }
  .liveStatus { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .liveStatus.err { color: var(--vscode-errorForeground, #e03131); }
  .status { min-height: 1.2em; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .backTop {
    position: sticky;
    bottom: 12px;
    display: block;
    margin: 10px auto 0;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .backTop.hidden { display: none; }
  .head, .detail dt, .detail dd { position: relative; }
  .pop { display: none; }
  .pop.open {
    position: absolute;
    z-index: 20;
    left: 0;
    top: 2px;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    padding: 4px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    border-radius: 4px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  }
  .popItem {
    text-align: left;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 0.9em;
  }
  .popItem:hover { background: var(--vscode-list-hoverBackground); }
  button.msg, button.fieldName, button.fieldValue {
    padding: 0;
    text-align: left;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  button.msg:hover, button.fieldName:hover, button.fieldValue:hover {
    text-decoration: underline;
  }
  button.twist {
    padding: 0;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    font-size: 0.8em;
  }
  button.twist:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .entry.group > .detail { padding-left: 18px; }
  .groupCount { font-variant-numeric: tabular-nums; }
`;

const LOGS_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="filters">
    <div class="fld">
      <label for="include">Include (any of, one per line)</label>
      <textarea id="include" rows="2"
        placeholder='get-pricing &#10;message="Error fetching workflows"'></textarea>
    </div>
    <div class="fld">
      <label for="exclude">Exclude (any of, one per line)</label>
      <textarea id="exclude" rows="2"
        placeholder='heartbeat &#10;fields.name="default"'></textarea>
    </div>
  </div>

  <div class="toolbar">
    <div class="sevs" id="sevs"></div>
    <label class="caseBox"><input type="checkbox" id="caseSensitive"> Match case</label>
    <label class="caseBox"><input type="checkbox" id="live"> Live logs</label>
    <label class="caseBox"><input type="checkbox" id="group"> Group by title</label>
    <span class="count" id="count"></span>
    <span class="liveStatus" id="liveStatus"></span>
    <button id="expandAll">Expand all</button>
    <button id="collapseAll">Collapse all</button>
    <button id="toggleRaw">Raw JSON</button>
    <button id="refresh">Refresh</button>
  </div>

  <div class="status" id="status" role="status" aria-live="polite"></div>

  <div id="body"></div>
  <button type="button" id="backTop" class="backTop hidden"></button>
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
  let severities = [];
  let liveOn = false;
  let groupOn = false;
  let debounce = null;
  /** 'flat' or 'group' — what the body currently holds, so a switch rebuilds it. */
  let mode = 'flat';

  /**
   * Auto-follow is a function of position, not a mode the user sets: the viewer
   * follows new entries only while parked at the newest one. Anything else means
   * the user is reading, and moving the viewport under them is the one thing a
   * live log view must not do.
   */
  const FOLLOW_TOLERANCE = 24;
  let follow = true;
  let pending = 0;

  // Which rows and groups the user has expanded, by identity rather than
  // position. A merge prepends entries, so an index-based memory would reopen
  // whichever row slid into the remembered slot.
  let openIds = new Set();
  let openGroups = new Set();

  // Exactly one popover is open at a time, tracked here so opening another or
  // pressing Escape closes it. It is appended next to its trigger rather than to
  // the body so it inherits the row's position without any coordinate maths.
  let openPop = null;

  function atTop() {
    return (window.scrollY || 0) <= FOLLOW_TOLERANCE;
  }

  function smooth() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function toTop() {
    window.scrollTo({ top: 0, behavior: smooth() ? 'smooth' : 'auto' });
    pending = 0;
    follow = true;
    updateBackTop();
  }

  function updateBackTop() {
    const button = el('backTop');
    const show = pending > 0 && !follow;
    button.classList.toggle('hidden', !show);
    button.textContent = show
      ? pending + (pending === 1 ? ' new log · Back to top' : ' new logs · Back to top')
      : '';
  }

  window.addEventListener('scroll', () => {
    follow = atTop();
    if (follow) { pending = 0; }
    updateBackTop();
  });

  el('backTop').addEventListener('click', toTop);

  function closePop() {
    if (openPop) {
      openPop.textContent = '';
      openPop.classList.remove('open');
      openPop = null;
    }
  }

  /**
   * Attach an action menu to a trigger button.
   *
   * Items are buttons, not clickable spans, so they are keyboard-reachable and
   * announce as controls. Every label is set with textContent — log content
   * reaches these menus, and this document's CSP allows no markup either way.
   */
  function attachPop(trigger, host, build) {
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.addEventListener('click', (event) => {
      if (event && event.stopPropagation) { event.stopPropagation(); }

      const reopening = openPop === host;
      closePop();
      if (reopening) { return; }

      for (const item of build()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'popItem';
        button.textContent = item.label;
        button.addEventListener('click', (inner) => {
          if (inner && inner.stopPropagation) { inner.stopPropagation(); }
          item.run();
          closePop();
        });
        host.appendChild(button);
      }

      host.classList.add('open');
      openPop = host;
    });
  }

  /** Mirrors src/logs/filter.ts — quoted so commas, quotes and spaces round-trip. */
  function messageExpr(message, prefix) {
    return 'message' + (prefix ? '^' : '') + '=' + JSON.stringify(message);
  }

  function fieldExpr(path, value, prefix) {
    return path + (prefix ? '^' : '') + '=' + JSON.stringify(value);
  }

  /**
   * Append to a filter box without disturbing what is already there.
   *
   * Duplicate check mirrors the host's splitExpressions rule: a comma inside a
   * double-quoted value does NOT separate; a newline always does. A naive
   * .split(/[\\n,]/) would cut inside message="a,b" and stack the same Include
   * twice — the brief's own "stop stacking on double-click" goal.
   */
  function addExpression(id, expression) {
    const input = el(id);
    const source = input.value;
    const existing = source.replace(/\\s+$/, '');
    // Quote-aware scan — cannot import filter.ts from this template-literal script.
    const parts = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"' && source[i - 1] !== '\\\\') {
        quoted = !quoted;
        current += ch;
        continue;
      }
      if (ch === '\\n' || (ch === ',' && !quoted)) {
        const token = current.trim();
        current = '';
        if (token) { parts.push(token); }
        continue;
      }
      current += ch;
    }
    const last = current.trim();
    if (last) { parts.push(last); }
    const already = parts.indexOf(expression) !== -1;

    if (!already) {
      input.value = existing ? existing + '\\n' + expression : expression;
    }

    requestFilter();
    setStatus(already ? 'Filter already present' : 'Filter added');
  }

  function copy(text, label) {
    // The host owns the clipboard: vscode.env.clipboard.writeText works whether
    // or not the webview has focus, which navigator.clipboard does not.
    vscode.postMessage({ type: 'copy', text: text, label: label });
  }

  let statusTimer = null;
  function setStatus(text) {
    el('status').textContent = text;
    if (statusTimer) { clearTimeout(statusTimer); }
    statusTimer = setTimeout(() => { el('status').textContent = ''; }, 2500);
  }

  /**
   * The message-title menu, shared by a row head and a group head.
   *
   * \`entry\` is null for a group: "Copy JSON" means *this* redacted record, and a
   * group has many. Everything else is a function of the title alone, which is
   * exactly why grouping needs no second menu.
   */
  function titleActions(message, entry) {
    const items = [{ label: 'Copy', run: () => copy(message, 'Message') }];

    if (entry) {
      items.push({
        label: 'Copy JSON',
        run: () => copy(JSON.stringify(entry.raw, null, 2), 'Entry JSON'),
      });
    }

    return items.concat([
      { label: 'Include', run: () => addExpression('include', messageExpr(message, false)) },
      { label: 'Exclude', run: () => addExpression('exclude', messageExpr(message, false)) },
      { label: 'Include prefix', run: () => addExpression('include', messageExpr(message, true)) },
      { label: 'Exclude prefix', run: () => addExpression('exclude', messageExpr(message, true)) },
    ]);
  }

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
    vscode.postMessage({ type: 'filter', filter: currentFilter(), group: groupOn });
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

  function liveStatus() {
    const live = payload.live || { enabled: false };
    liveOn = Boolean(live.enabled);
    el('live').checked = liveOn;

    const text = live.error
      ? 'Live · ' + live.error
      : live.disabledReason
        ? live.disabledReason
        : liveOn
          ? 'Live · updated ' + (live.updatedAt || 'now') + (live.warning ? ' · ' + live.warning : '')
          : '';

    el('liveStatus').textContent = text;
    el('liveStatus').classList.toggle('err', Boolean(live.error));
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

  function makeRow(entry, index) {
    const row = document.createElement('div');
    row.className = 'entry';
    row.dataset.id = entry.id;
    row.dataset.index = String(index);

    const head = document.createElement('div');
    head.className = 'head';

    const twist = document.createElement('button');
    twist.type = 'button';
    twist.className = 'twist';
    twist.setAttribute('aria-label', 'Expand entry');
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

    // The message is the title, and the one thing worth acting on directly.
    const msg = document.createElement('button');
    msg.type = 'button';
    msg.className = 'msg';
    msg.textContent = entry.message;
    msg.setAttribute('aria-label', 'Actions for ' + entry.message);
    head.appendChild(msg);

    const msgPop = document.createElement('div');
    msgPop.className = 'pop';
    head.appendChild(msgPop);

    attachPop(msg, msgPop, () => titleActions(entry.message, entry));

    function setOpen(isOpen) {
      row.classList.toggle('open', isOpen);
      twist.textContent = isOpen ? '\\u25be' : '\\u25b8';
      twist.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) { openIds.add(entry.id); } else { openIds.delete(entry.id); }
    }

    setOpen(openIds.has(entry.id));

    twist.addEventListener('click', (event) => {
      // The head's own handler would immediately toggle it back.
      if (event && event.stopPropagation) { event.stopPropagation(); }
      setOpen(!row.classList.contains('open'));
    });
    head.addEventListener('click', () => setOpen(!row.classList.contains('open')));
    row.appendChild(head);

    const detail = document.createElement('div');
    detail.className = 'detail';
    const list = document.createElement('dl');

    if (entry.rawTimestamp) {
      addField(list, 'timestamp', entry.rawTimestamp, false);
    }
    for (const field of entry.fields) {
      addField(list, field.key, field.value, true);
    }
    if (entry.fields.length === 0) {
      addField(list, '(no fields)', '', false);
    }

    detail.appendChild(list);
    row.appendChild(detail);
    return row;
  }

  function renderFlat() {
    const body = el('body');
    body.textContent = '';
    payload.entries.forEach((entry, index) => body.appendChild(makeRow(entry, index)));
    mode = 'flat';
  }

  /**
   * Grouped view.
   *
   * Rebuilt from the host's group list on each filter response rather than by
   * moving existing nodes: the open-id restore in makeRow already makes a
   * rebuild lossless, and node-moving would need its own correctness argument
   * for a view that is off by default.
   */
  function renderGroups(groups) {
    const body = el('body');
    body.textContent = '';

    // Same unbounded-growth concern as openIds: only keep groups still present.
    const liveGroups = new Set(groups.map((group) => group.message));
    openGroups = new Set([...openGroups].filter((key) => liveGroups.has(key)));

    for (const group of groups) {
      const node = document.createElement('div');
      node.className = 'entry group';
      node.dataset.key = group.message;

      const head = document.createElement('div');
      head.className = 'head';

      // Plan/acceptance require keyboard-operable group expansion separate from
      // the title action button — brief Step 5's span is deliberately overridden.
      const twist = document.createElement('button');
      twist.type = 'button';
      twist.className = 'twist';
      twist.setAttribute('aria-label', 'Expand group');
      head.appendChild(twist);

      const sev = document.createElement('span');
      sev.className = 'sev chip ' + (group.level || 'muted');
      sev.textContent = group.severity;
      head.appendChild(sev);

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'msg';
      title.textContent = group.message;
      title.setAttribute('aria-label', 'Actions for ' + group.message);
      head.appendChild(title);

      const pop = document.createElement('div');
      pop.className = 'pop';
      head.appendChild(pop);
      attachPop(title, pop, () => titleActions(group.message, null));

      const count = document.createElement('span');
      count.className = 'kv groupCount';
      count.textContent = String(group.indices.length);
      head.appendChild(count);

      const latest = document.createElement('span');
      latest.className = 'ts';
      latest.textContent = group.latest;
      head.appendChild(latest);

      function setGroupOpen(isOpen) {
        node.classList.toggle('open', isOpen);
        twist.textContent = isOpen ? '\\u25be' : '\\u25b8';
        twist.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) { openGroups.add(group.message); } else { openGroups.delete(group.message); }
      }

      setGroupOpen(openGroups.has(group.message));

      twist.addEventListener('click', (event) => {
        // The head's own handler would immediately toggle it back.
        if (event && event.stopPropagation) { event.stopPropagation(); }
        setGroupOpen(!node.classList.contains('open'));
      });
      head.addEventListener('click', () => setGroupOpen(!node.classList.contains('open')));
      node.appendChild(head);

      const detail = document.createElement('div');
      detail.className = 'detail';
      for (const index of group.indices) {
        detail.appendChild(makeRow(payload.entries[index], index));
      }
      node.appendChild(detail);
      body.appendChild(node);
    }

    mode = 'group';
  }

  function renderEntries() {
    // Wipe detaches any open .pop; clear the pointer first so openPop cannot go stale.
    closePop();
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

    renderFlat();
    requestFilter();
  }

  function addField(list, key, value, actionable) {
    const dt = document.createElement('dt');
    if (actionable) {
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'fieldName';
      name.textContent = key;
      dt.appendChild(name);
      const namePop = document.createElement('div');
      namePop.className = 'pop';
      dt.appendChild(namePop);
      attachPop(name, namePop, () => [
        { label: 'Copy field path', run: () => copy(key, 'Field path') },
        {
          label: 'Include field prefix',
          run: () => addExpression('include', key + '.*'),
        },
        {
          label: 'Exclude field prefix',
          run: () => addExpression('exclude', key + '.*'),
        },
      ]);
    } else {
      dt.textContent = key;
    }
    list.appendChild(dt);

    const dd = document.createElement('dd');
    if (actionable) {
      const shown = document.createElement('button');
      shown.type = 'button';
      shown.className = 'fieldValue';
      shown.textContent = value;
      dd.appendChild(shown);
      const valuePop = document.createElement('div');
      valuePop.className = 'pop';
      dd.appendChild(valuePop);
      attachPop(shown, valuePop, () => [
        { label: 'Copy', run: () => copy(value, 'Value') },
        { label: 'Include', run: () => addExpression('include', fieldExpr(key, value, false)) },
        { label: 'Exclude', run: () => addExpression('exclude', fieldExpr(key, value, false)) },
        {
          label: 'Include value prefix',
          run: () => addExpression('include', fieldExpr(key, value, true)),
        },
        {
          label: 'Exclude value prefix',
          run: () => addExpression('exclude', fieldExpr(key, value, true)),
        },
      ]);
    } else {
      dd.textContent = value;
    }
    list.appendChild(dd);
  }

  function applyVisible(indices, total, groups) {
    if (groups) {
      renderGroups(groups);
      el('count').textContent =
        groups.length + (groups.length === 1 ? ' group · ' : ' groups · ') +
        indices.length + (indices.length === 1 ? ' entry' : ' entries');
      return;
    }

    // Leaving grouped mode: the body holds group nodes, so rebuild it before
    // the show/hide pass, which only toggles classes.
    if (mode === 'group') { renderFlat(); }

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
    liveStatus();
    sevChips();

    // Drop ids that left the payload so a long live session cannot retain every
    // historically expanded key until the panel is disposed.
    const liveIds = new Set((payload.entries || []).map((entry) => entry.id));
    openIds = new Set([...openIds].filter((id) => liveIds.has(id)));

    renderEntries();

    if (payload.merged) {
      // A merge, not a new page: keep the reader where they were, or follow if
      // they are already at the newest entry.
      if (follow) {
        toTop();
      } else {
        pending += payload.added || 0;
        updateBackTop();
      }
    } else {
      pending = 0;
      follow = true;
      updateBackTop();
    }
  }

  function setAll(isOpen) {
    for (const row of document.querySelectorAll('.entry')) {
      row.classList.toggle('open', isOpen);
      const twist = row.querySelector('.twist');
      if (twist) {
        twist.textContent = isOpen ? '\\u25be' : '\\u25b8';
        twist.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
      if (!row.dataset.id) { continue; }
      if (isOpen) { openIds.add(row.dataset.id); } else { openIds.delete(row.dataset.id); }
    }
  }

  el('include').addEventListener('input', requestFilterSoon);
  el('exclude').addEventListener('input', requestFilterSoon);
  el('caseSensitive').addEventListener('change', requestFilter);
  el('refresh').addEventListener('click', apply);
  el('expandAll').addEventListener('click', () => setAll(true));
  el('collapseAll').addEventListener('click', () => setAll(false));
  el('live').addEventListener('change', () => {
    liveOn = el('live').checked;
    // The host owns the timer: it has the panel's visibility, the in-flight flag
    // and the last successful poll time, and it is the only side that can cancel
    // a scheduled fetch when the panel closes.
    vscode.postMessage({ type: 'live', enabled: liveOn });
  });

  el('group').addEventListener('change', () => {
    groupOn = el('group').checked;
    requestFilter();
  });
  wireRawPane();

  document.addEventListener('click', closePop);
  document.addEventListener('keydown', (event) => {
    if (event && event.key === 'Escape') { closePop(); }
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) { return; }

    if (data.type === 'logs') {
      payload = data.payload;
      render();
    } else if (data.type === 'visible') {
      applyVisible(data.indices, data.total, data.groups);
    } else if (data.type === 'copied') {
      setStatus(data.error ? 'Copy failed: ' + data.error : data.label + ' copied');
    }
  });
}());
`;
