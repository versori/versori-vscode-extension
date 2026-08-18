import { Control, ControlValues } from '../results/controls';
import { htmlDocument } from '../webview/shell';
import { ActivationRow, SchemaVariable } from './rows';

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

export interface ConnectionChoice {
    id: string;
    name: string;
    baseUrl: string;
}

export interface SystemChoice {
    name: string;
    systemId: string;
    templateId: string;
    dynamic: boolean;
    options: ConnectionChoice[];
    boundId?: string;
    boundName?: string;
    boundBaseUrl?: string;
}

export interface WorkspaceMessage {
    type: 'workspace';
    externalId: string;
    displayName: string;
    userId: string;
    status: 'active' | 'inactive';
    activationId: string;
    systems: SystemChoice[];
    schema: SchemaVariable[];
    variableNames: string[];
    variableValues?: Record<string, string>;
    error?: string;
}

/**
 * Users / activations browser.
 *
 * Roughly the platform Users tab: a pending/activated list on the left, and a
 * per-user detail pane on the right. Activated users show bound credentials and
 * editable activation-variable toggles; pending users get connection dropdowns.
 * Mutations (create, activate, deactivate, delete, update variables, redeploy)
 * are posted as messages; confirmation for delete/deactivate/redeploy lives on
 * the host side.
 */
export function renderActivationsHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori activations',
        styles: ACTIVATIONS_CSS,
        body: ACTIVATIONS_BODY,
        script: ACTIVATIONS_SCRIPT,
    });
}

const ACTIVATIONS_CSS = `
  .workspace {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
    min-height: 420px;
  }
  .toolbar .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  @media (max-width: 720px) {
    .workspace { grid-template-columns: 1fr; }
  }
  .user-list {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.28));
    border-radius: 4px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    overflow: hidden;
  }
  .user-group { padding: 10px 0 6px; }
  .user-group h2 {
    margin: 0 10px 6px;
    font-size: 0.72em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .user-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .user-row:hover { background: var(--vscode-list-hoverBackground); }
  .user-row.selected {
    background: var(--vscode-list-activeSelectionBackground, rgba(60,140,220,0.22));
    color: var(--vscode-list-activeSelectionForeground, inherit);
  }
  .user-row .dot {
    width: 8px;
    height: 8px;
    margin-top: 5px;
    flex: none;
    border-radius: 50%;
  }
  .user-row .dot.pending { background: #c9a227; }
  .user-row .dot.active { background: #3fa66b; }
  .user-row .who { min-width: 0; }
  .user-row .name { display: block; font-weight: 600; overflow-wrap: anywhere; }
  .user-row .ext {
    display: block;
    font-size: 0.82em;
    color: var(--vscode-descriptionForeground);
  }
  .detail-pane {
    min-width: 0;
    padding: 4px 2px 16px;
  }
  .detail-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px 16px;
    margin-bottom: 18px;
  }
  .detail-head h2 { margin: 0; font-size: 1.35em; font-weight: 650; }
  .detail-head .meta { margin: 4px 0 0; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .detail-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
  .detail-actions .danger {
    color: var(--vscode-errorForeground, #e03131);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--vscode-errorForeground, #e03131);
  }
  .detail-actions .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .card {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.28));
    border-radius: 4px;
    background: var(--vscode-textBlockQuote-background);
  }
  .card h3 { margin: 0 0 4px; font-size: 0.98em; }
  .card .hint { margin: 0 0 10px; font-size: 0.84em; color: var(--vscode-descriptionForeground); }
  .card label { display: block; font-size: 0.82em; font-weight: 600; margin: 8px 0 4px; }
  .card select, .card input[type="text"] {
    width: 100%;
    max-width: 520px;
    padding: 6px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0;
    font-size: 0.92em;
  }
  .bound { font-size: 0.92em; }
  .status-badge {
    display: inline-block;
    margin-bottom: 6px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75em;
    font-weight: 700;
  }
  .status-badge.on { background: rgba(63,166,107,0.22); color: #3fa66b; }
  .status-badge.off { background: rgba(201,162,39,0.22); color: #c9a227; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.78em;
    background: rgba(128,128,128,0.18);
    color: var(--vscode-descriptionForeground);
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .card-head h3 { margin: 0; }
  .connected { font-size: 0.92em; margin: 0 0 10px; }
  .modal {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.45);
  }
  .modal[hidden] { display: none !important; }
  .modal-card {
    width: min(420px, 92vw);
    padding: 18px 20px 16px;
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    box-shadow: 0 8px 28px rgba(0,0,0,0.4);
  }
  .modal-card h2 { margin: 0 0 14px; font-size: 1.15em; }
  .modal-card label {
    display: block;
    margin: 10px 0 4px;
    font-size: 0.82em;
    font-weight: 600;
  }
  .modal-card input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .modal-actions .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
`;

const ACTIVATIONS_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Search users...">
    <span class="count" id="count"></span>
    <button type="button" id="createUser" class="primary">Add user</button>
    <button type="button" id="redeploy">Redeploy</button>
    <button type="button" id="toggleRaw">Raw JSON</button>
    <button type="button" id="refresh">Refresh</button>
  </div>

  <div id="body" class="workspace">
    <aside class="user-list" id="userList"></aside>
    <section class="detail-pane" id="userDetail"></section>
  </div>
  <pre id="raw"></pre>

  <div id="newUser" class="modal" hidden>
    <div class="modal-card">
      <h2>New User</h2>
      <label for="newDisplayName">Display Name</label>
      <input id="newDisplayName" type="text" placeholder="Display Name">
      <label for="newExternalId">External ID</label>
      <input id="newExternalId" type="text" placeholder="External ID">
      <div class="modal-actions">
        <button type="button" id="newUserCancel">Cancel</button>
        <button type="button" id="newUserAdd" class="primary">Add</button>
      </div>
    </div>
  </div>
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
  let selectedId = '';
  let workspace = null;

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

  function renderGroup(title, rows, needle, pending) {
    const section = document.createElement('div');
    section.className = 'user-group';

    const shown = rows.filter((row) => matches(row, needle));
    const heading = document.createElement('h2');
    heading.textContent = title + ' (' + shown.length + ')';
    section.appendChild(heading);

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'None.';
      section.appendChild(empty);
      return section;
    }
    if (shown.length === 0) {
      return section;
    }

    for (const row of shown) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'user-row' + (row.externalId === selectedId ? ' selected' : '');
      btn.dataset.id = row.externalId;

      const dot = document.createElement('span');
      dot.className = 'dot ' + (pending ? 'pending' : 'active');
      btn.appendChild(dot);

      const who = document.createElement('span');
      who.className = 'who';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.displayName || row.externalId;
      who.appendChild(name);
      const ext = document.createElement('span');
      ext.className = 'ext';
      ext.textContent = row.externalId;
      who.appendChild(ext);
      btn.appendChild(who);

      btn.addEventListener('click', () => {
        selectedId = row.externalId;
        workspace = null;
        render();
        vscode.postMessage({
          type: 'select',
          externalId: row.externalId,
          label: row.displayName || row.externalId,
          userId: row.userId,
          status: row.status,
        });
      });
      section.appendChild(btn);
    }

    return section;
  }

  function renderList() {
    const list = el('userList');
    list.textContent = '';
    if (!payload || payload.error) {
      return;
    }
    const needle = el('filter').value.trim().toLowerCase();
    list.appendChild(renderGroup('Pending activation', payload.inactive, needle, true));
    list.appendChild(renderGroup('Activated', payload.active, needle, false));
  }

  function collectConnections() {
    const connections = [];
    const nodes = el('userDetail').querySelectorAll('select[data-template]');
    for (const node of nodes) {
      if (node.value) {
        connections.push({ templateId: node.dataset.template, connectionId: node.value });
      }
    }
    return connections;
  }

  function collectVariables() {
    const variables = [];
    const nodes = el('userDetail').querySelectorAll('[data-var]');
    for (const node of nodes) {
      const name = node.dataset.var;
      if (!name) continue;
      if (node.type === 'checkbox') {
        variables.push({ name: name, value: node.checked ? 'true' : 'false' });
        continue;
      }
      if (String(node.value || '').trim() === '' && node.dataset.required !== '1') {
        continue;
      }
      variables.push({ name: name, value: node.value });
    }
    return variables;
  }

  function renderWorkspace() {
    const pane = el('userDetail');
    pane.textContent = '';
    if (!payload) {
      return;
    }
    if (payload.error) {
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = payload.error;
      pane.appendChild(box);
      return;
    }
    if (!selectedId) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Select a user to see connections and activate or delete them.';
      pane.appendChild(empty);
      return;
    }
    if (!workspace || workspace.externalId !== selectedId) {
      const pending = document.createElement('div');
      pending.className = 'empty';
      pending.textContent = 'Loading user...';
      pane.appendChild(pending);
      return;
    }
    if (workspace.error) {
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = workspace.error;
      pane.appendChild(box);
      return;
    }

    const active = workspace.status === 'active';

    const head = document.createElement('div');
    head.className = 'detail-head';
    const titles = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'status-badge ' + (active ? 'on' : 'off');
    badge.textContent = active ? 'Activated' : 'Pending activation';
    titles.appendChild(badge);
    const h2 = document.createElement('h2');
    h2.textContent = workspace.displayName || workspace.externalId;
    titles.appendChild(h2);
    const pills = document.createElement('div');
    pills.className = 'pills';
    const extPill = document.createElement('span');
    extPill.className = 'pill';
    extPill.textContent = 'External ID: ' + workspace.externalId;
    pills.appendChild(extPill);
    if (workspace.activationId) {
      const actPill = document.createElement('span');
      actPill.className = 'pill';
      actPill.textContent = 'Activation ID: ' + workspace.activationId;
      pills.appendChild(actPill);
    }
    titles.appendChild(pills);
    head.appendChild(titles);

    const actions = document.createElement('div');
    actions.className = 'detail-actions';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = 'Delete user';
    del.addEventListener('click', () => {
      vscode.postMessage({
        type: 'deleteUser',
        externalId: workspace.externalId,
        userId: workspace.userId,
        label: workspace.displayName || workspace.externalId,
      });
    });
    actions.appendChild(del);

    if (active) {
      const deactivate = document.createElement('button');
      deactivate.type = 'button';
      deactivate.className = 'danger';
      deactivate.textContent = 'Deactivate User';
      deactivate.addEventListener('click', () => {
        vscode.postMessage({
          type: 'deactivate',
          externalId: workspace.externalId,
          label: workspace.displayName || workspace.externalId,
        });
      });
      actions.appendChild(deactivate);
    } else {
      const activate = document.createElement('button');
      activate.type = 'button';
      activate.className = 'primary';
      activate.textContent = 'Activate user';
      activate.addEventListener('click', () => {
        vscode.postMessage({
          type: 'activate',
          externalId: workspace.externalId,
          label: workspace.displayName || workspace.externalId,
          connections: collectConnections(),
          variables: collectVariables(),
        });
      });
      actions.appendChild(activate);
    }
    head.appendChild(actions);
    pane.appendChild(head);

    const cred = document.createElement('div');
    cred.className = 'card';
    const credTitle = document.createElement('h3');
    credTitle.textContent = 'Credentials';
    cred.appendChild(credTitle);
    const credHint = document.createElement('p');
    credHint.className = 'hint';
    credHint.textContent = active
      ? "Need to update user's credentials?"
      : 'Pick an existing connection for each system, then activate.';
    cred.appendChild(credHint);

    if (!workspace.systems || workspace.systems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No systems linked on this environment.';
      cred.appendChild(empty);
    } else {
      for (const system of workspace.systems) {
        const label = document.createElement('label');
        label.textContent = system.name;
        cred.appendChild(label);

        if (active) {
          const connected = document.createElement('p');
          connected.className = 'connected';
          connected.textContent = system.boundName
            ? 'Connected - ' + system.boundName + ' · Authorization Code'
            : 'No connection';
          cred.appendChild(connected);
          continue;
        }

        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = system.dynamic ? 'No connection — per-user (embedded)' : 'No connection — static';
        cred.appendChild(hint);

        const select = document.createElement('select');
        select.dataset.template = system.templateId;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = system.options && system.options.length
          ? 'Select existing connection'
          : 'No connections for this user';
        select.appendChild(placeholder);
        for (const option of system.options || []) {
          const node = document.createElement('option');
          node.value = option.id;
          node.textContent = option.name + (option.baseUrl ? ' · ' + option.baseUrl : '');
          if ((system.options || []).length === 1) {
            placeholder.selected = false;
            node.selected = true;
          }
          select.appendChild(node);
        }
        cred.appendChild(select);
      }
    }
    pane.appendChild(cred);

    const schema = workspace.schema || [];
    const cfg = document.createElement('div');
    cfg.className = 'card';
    const cfgHead = document.createElement('div');
    cfgHead.className = 'card-head';
    const cfgTitles = document.createElement('div');
    const cfgTitle = document.createElement('h3');
    cfgTitle.textContent = 'Configuration';
    cfgTitles.appendChild(cfgTitle);
    const cfgHint = document.createElement('p');
    cfgHint.className = 'hint';
    cfgHint.textContent = 'Additional settings required for this integration';
    cfgTitles.appendChild(cfgHint);
    cfgHead.appendChild(cfgTitles);
    if (active && schema.length > 0) {
      const update = document.createElement('button');
      update.type = 'button';
      update.className = 'primary';
      update.textContent = 'Update Activation Variables';
      update.addEventListener('click', () => {
        vscode.postMessage({
          type: 'updateVariables',
          externalId: workspace.externalId,
          label: workspace.displayName || workspace.externalId,
          variables: collectVariables(),
        });
      });
      cfgHead.appendChild(update);
    }
    cfg.appendChild(cfgHead);

    if (schema.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No activation variables declared.';
      cfg.appendChild(empty);
    } else {
      const values = workspace.variableValues || {};
      for (const variable of schema) {
        const current = values[variable.name] == null ? '' : String(values[variable.name]);
        if (variable.type === 'boolean') {
          const row = document.createElement('label');
          row.className = 'toggle';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.dataset.var = variable.name;
          box.checked = current.toLowerCase() === 'true';
          row.appendChild(box);
          const text = document.createElement('span');
          text.textContent = variable.name + (variable.required ? '' : ' (optional)');
          row.appendChild(text);
          cfg.appendChild(row);
        } else {
          const label = document.createElement('label');
          label.textContent = variable.name + (variable.required ? '' : ' (optional)');
          cfg.appendChild(label);
          const input = document.createElement('input');
          input.type = 'text';
          input.dataset.var = variable.name;
          if (variable.required) {
            input.dataset.required = '1';
          }
          input.value = current;
          cfg.appendChild(input);
        }
      }
    }
    pane.appendChild(cfg);
  }

  function render() {
    if (!payload) {
      return;
    }

    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = payload.command;
    el('raw').textContent = payload.rawJson || '';
    hideRawPane();
    controls();

    const total = payload.active.length + payload.inactive.length;
    const needle = el('filter').value.trim().toLowerCase();
    const shown =
      payload.active.filter((row) => matches(row, needle)).length +
      payload.inactive.filter((row) => matches(row, needle)).length;
    el('count').textContent = needle
      ? shown + ' of ' + total
      : total + (total === 1 ? ' user' : ' users');

    renderList();
    renderWorkspace();
  }

  function openNewUser() {
    el('newDisplayName').value = '';
    el('newExternalId').value = '';
    el('newUser').hidden = false;
  }

  function closeNewUser() {
    el('newUser').hidden = true;
  }

  el('refresh').addEventListener('click', apply);
  el('filter').addEventListener('input', render);
  el('createUser').addEventListener('click', openNewUser);
  el('newUserCancel').addEventListener('click', closeNewUser);
  el('newUserAdd').addEventListener('click', () => {
    const displayName = String(el('newDisplayName').value || '').trim();
    const externalId = String(el('newExternalId').value || '').trim();
    if (!displayName || !externalId) {
      return;
    }
    vscode.postMessage({ type: 'createUser', displayName: displayName, externalId: externalId });
    closeNewUser();
  });
  el('redeploy').addEventListener('click', () => {
    vscode.postMessage({ type: 'redeploy' });
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
      if (selectedId) {
        const known = payload.active.concat(payload.inactive)
          .some((row) => row.externalId === selectedId);
        if (!known) {
          selectedId = '';
          workspace = null;
        }
      }
      render();
      return;
    }
    if (message.type === 'workspace') {
      workspace = message;
      selectedId = message.externalId;
      render();
    }
  });
})();
`;
