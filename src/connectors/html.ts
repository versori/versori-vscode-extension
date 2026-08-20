import { Control, ControlValues } from '../results/controls';
import { htmlDocument } from '../webview/shell';
import { ConnectorRow } from './rows';

export interface ConnectorsPayload {
    heading: string;
    subtitle: string;
    command: string;
    controls: Control[];
    controlValues: ControlValues;
    controlError?: string;
    connectors: ConnectorRow[];
    rawJson: string;
    error?: string;
}

export interface ConnectorDetailMessage {
    type: 'detail';
    connector: ConnectorRow;
    existing: Array<{ id: string; name: string; baseUrl: string }>;
    error?: string;
}

export function renderConnectorsHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori connectors',
        styles: CONNECTORS_CSS,
        body: CONNECTORS_BODY,
        script: CONNECTORS_SCRIPT,
    });
}

const CONNECTORS_CSS = `
  .workspace {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
    min-height: 420px;
  }
  @media (max-width: 720px) {
    .workspace { grid-template-columns: 1fr; }
  }
  .connector-list {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.28));
    border-radius: 4px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    overflow: hidden;
  }
  .connector-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .connector-row:hover { background: var(--vscode-list-hoverBackground); }
  .connector-row.selected {
    background: var(--vscode-list-activeSelectionBackground, rgba(60,140,220,0.22));
    color: var(--vscode-list-activeSelectionForeground, inherit);
  }
  .connector-row .name { font-weight: 600; overflow-wrap: anywhere; }
  .status-badge {
    flex: none;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.72em;
    font-weight: 700;
  }
  .status-badge.embedded { color: #d19a4a; background: rgba(209,154,74,0.16); }
  .status-badge.bypassed { color: #b57bff; background: rgba(181,123,255,0.16); }
  .status-badge.connected { color: #3fa66b; background: rgba(63,166,107,0.16); }
  .status-badge.none { color: var(--vscode-descriptionForeground); background: rgba(128,128,128,0.14); }
  .detail-pane { min-width: 0; padding: 4px 2px 16px; }
  .detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .detail-titles { min-width: 0; }
  .detail-head h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 1.35em;
    font-weight: 650;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    background: var(--vscode-descriptionForeground);
  }
  .status-dot.connected { background: #3fa66b; }
  .status-dot.embedded { background: #d19a4a; }
  .status-dot.bypassed { background: #b57bff; }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    font-size: 0.88em;
  }
  .meta-row .k { color: var(--vscode-descriptionForeground); }
  .detail-head .primary {
    flex: none;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .detail-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    margin-top: 16px;
  }
  @media (max-width: 900px) {
    .detail-split { grid-template-columns: 1fr; }
  }
  .card {
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.28));
    border-radius: 4px;
    background: var(--vscode-textBlockQuote-background);
  }
  .detail-split .card { margin-top: 0; }
  .card h3 { margin: 0 0 10px; font-size: 0.98em; }
  .card .hint { margin: 0 0 10px; font-size: 0.84em; color: var(--vscode-descriptionForeground); }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .card-head h3 { margin: 0; }
  .danger {
    color: var(--vscode-errorForeground, #f48771);
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .conn-card {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(128,128,128,0.18);
  }
  .conn-card:first-of-type { border-top: none; padding-top: 0; }
  .conn-card h4 { margin: 0 0 6px; font-size: 1.05em; }
  .conn-card .kv { margin: 3px 0; font-size: 0.88em; }
  .conn-card .kv span { color: var(--vscode-descriptionForeground); margin-right: 8px; }
  .conn-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .in-use, .use {
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
  }
  .in-use {
    border: none;
    background: rgba(128,128,128,0.2);
    color: var(--vscode-descriptionForeground);
  }
  .use {
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none;
  }
  .compose h3 { margin: 16px 0 10px; }
  .compose .card { margin-top: 12px; }
  .field {
    display: block;
    margin: 10px 0;
    font-size: 0.82em;
    font-weight: 600;
  }
  .field input, .field select, .compose select {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 4px;
    padding: 7px 8px;
    font: inherit;
    font-weight: 400;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
  }
  .auth-select { width: min(36rem, 100%); }
  .chip {
    font-size: 0.72em;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #3d8bfd;
    margin-left: 8px;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .form-actions .primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .alert {
    margin: 10px 0;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 0.84em;
    background: rgba(60,140,220,0.14);
  }
`;

const CONNECTORS_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>
  <code class="cmd" id="command"></code>

  <div class="controls" id="controls"></div>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Search connectors...">
    <span class="count" id="count"></span>
    <button type="button" id="toggleRaw">Raw JSON</button>
    <button type="button" id="refresh">Refresh</button>
  </div>

  <div id="body" class="workspace">
    <aside class="connector-list" id="connectorList"></aside>
    <section class="detail-pane" id="connectorDetail"></section>
  </div>
  <pre id="raw"></pre>
`;

export const CONNECTORS_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  if (typeof wireNav === 'function') { wireNav(vscode); }

  const NEW_TYPES = [
    { type: 'api-key', label: 'API Key' },
    { type: 'basic-auth', label: 'Basic Auth' },
    { type: 'oauth2', label: 'OAuth2' },
    { type: 'hmac', label: 'HMAC (Webhook Only)' },
    { type: 'none', label: 'None (Bypass Authentication)' },
  ];

  let payload = null;
  let controlValues = {};
  let selectedId = '';
  let detail = null;
  let composing = false;
  let selectedAuth = '';
  let oauthGrant = 'authorizationCode';

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

  function statusLabel(status) {
    if (status === 'embedded') return 'Embedded';
    if (status === 'bypassed') return 'Bypassed';
    if (status === 'connected') return 'Connected';
    return '';
  }

  function matches(row, needle) {
    if (!needle) return true;
    return (row.name + ' ' + row.id + ' ' + row.status + ' ' + row.templateBaseUrl)
      .toLowerCase().includes(needle);
  }

  function renderList() {
    const list = el('connectorList');
    list.textContent = '';
    if (!payload || payload.error) return;
    const needle = el('filter').value.trim().toLowerCase();
    const rows = (payload.connectors || []).filter((row) => matches(row, needle));
    for (const row of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'connector-row' + (row.id === selectedId ? ' selected' : '');
      btn.dataset.id = row.id;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.name;
      btn.appendChild(name);
      const label = statusLabel(row.status);
      if (label) {
        const badge = document.createElement('span');
        badge.className = 'status-badge ' + row.status;
        badge.textContent = label;
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => {
        selectedId = row.id;
        detail = null;
        composing = false;
        selectedAuth = '';
        render();
        vscode.postMessage({ type: 'select', id: row.id });
      });
      list.appendChild(btn);
    }
  }

  function meta(label, value) {
    const row = document.createElement('div');
    row.className = 'meta-row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }

  function field(name, labelText, opts) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.textContent = '';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    wrap.appendChild(caption);
    const input = document.createElement(opts && opts.select ? 'select' : 'input');
    input.dataset.field = name;
    if (!(opts && opts.select)) {
      input.type = (opts && opts.type) || 'text';
      input.value = (opts && opts.value) || '';
      if (opts && opts.placeholder) input.placeholder = opts.placeholder;
    }
    wrap.appendChild(input);
    return wrap;
  }

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function findScheme(connector, name) {
    const schemes = connector.schemes || [];
    return schemes.find((scheme) => scheme.name === name) || schemes.find((scheme) => scheme.type === name);
  }

  function parseAuth(connector) {
    if (!selectedAuth) return null;
    if (selectedAuth.indexOf('new:') === 0) {
      return { schemeMode: 'new', schemeType: selectedAuth.slice(4), schemeName: '' };
    }
    if (selectedAuth.indexOf('existing:') === 0) {
      const name = selectedAuth.slice(9);
      const scheme = findScheme(connector, name);
      return {
        schemeMode: 'existing',
        schemeType: scheme ? scheme.type : '',
        schemeName: name,
        grant: scheme ? scheme.grant : '',
        tokenUrl: scheme ? scheme.tokenUrl : '',
        authorizeUrl: scheme ? scheme.authorizeUrl : '',
      };
    }
    return null;
  }

  function renderOverview(pane, connector, existing) {
    const split = document.createElement('div');
    split.className = 'detail-split';

    const active = document.createElement('div');
    active.className = 'card';
    const activeHead = document.createElement('div');
    activeHead.className = 'card-head';
    const activeTitle = document.createElement('h3');
    activeTitle.textContent = 'Active Connection';
    activeHead.appendChild(activeTitle);
    if (connector.activeConnectionId) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.dataset.action = 'remove-connection';
      remove.textContent = 'Remove Connection';
      remove.addEventListener('click', () => vscode.postMessage({
        type: 'remove-connection',
        id: connector.activeConnectionId,
      }));
      activeHead.appendChild(remove);
    }
    active.appendChild(activeHead);
    if (connector.activeConnectionName) {
      const card = document.createElement('div');
      card.className = 'conn-card';
      const name = document.createElement('h4');
      name.textContent = connector.activeConnectionName;
      card.appendChild(name);
      const url = document.createElement('p');
      url.className = 'kv';
      const urlK = document.createElement('span');
      urlK.textContent = 'Base URL';
      url.appendChild(urlK);
      const urlV = document.createElement('span');
      urlV.textContent = connector.activeBaseUrl || '—';
      url.appendChild(urlV);
      card.appendChild(url);
      active.appendChild(card);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No active connection.';
      active.appendChild(empty);
    }
    split.appendChild(active);

    const existCard = document.createElement('div');
    existCard.className = 'card';
    const existTitle = document.createElement('h3');
    existTitle.textContent = 'Existing Connections';
    existCard.appendChild(existTitle);
    if (!existing.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No connections for this connector.';
      existCard.appendChild(empty);
    } else {
      for (const connection of existing) {
        const card = document.createElement('div');
        card.className = 'conn-card';
        const name = document.createElement('h4');
        name.textContent = connection.name;
        card.appendChild(name);
        const url = document.createElement('p');
        url.className = 'kv';
        const urlK = document.createElement('span');
        urlK.textContent = 'Base URL';
        url.appendChild(urlK);
        const urlV = document.createElement('span');
        urlV.textContent = connection.baseUrl || '—';
        url.appendChild(urlV);
        card.appendChild(url);
        const actions = document.createElement('div');
        actions.className = 'conn-actions';
        if (connection.id === connector.activeConnectionId) {
          const used = document.createElement('button');
          used.type = 'button';
          used.className = 'in-use';
          used.textContent = 'Connection In Use';
          actions.appendChild(used);
        } else {
          const use = document.createElement('button');
          use.type = 'button';
          use.className = 'use';
          use.dataset.action = 'use-connection';
          use.dataset.id = connection.id;
          use.textContent = 'Use';
          use.addEventListener('click', () => vscode.postMessage({ type: 'use-connection', id: connection.id }));
          actions.appendChild(use);
        }
        card.appendChild(actions);
        existCard.appendChild(card);
      }
    }
    split.appendChild(existCard);
    pane.appendChild(split);

    const urlCard = document.createElement('div');
    urlCard.className = 'card';
    const urlTitle = document.createElement('h3');
    urlTitle.textContent = 'Base URL';
    urlCard.appendChild(urlTitle);
    const urlVal = document.createElement('p');
    urlVal.textContent = connector.templateBaseUrl || '—';
    urlCard.appendChild(urlVal);
    pane.appendChild(urlCard);
  }

  function renderCompose(pane, connector) {
    const wrap = document.createElement('div');
    wrap.className = 'compose';
    const heading = document.createElement('h3');
    heading.textContent = 'New Connection';
    wrap.appendChild(heading);

    const authCard = document.createElement('div');
    authCard.className = 'card';
    const authTitle = document.createElement('h3');
    authTitle.textContent = 'Auth Method';
    authCard.appendChild(authTitle);

    const parsed = parseAuth(connector);
    if (!parsed) {
      const select = document.createElement('select');
      select.className = 'auth-select';
      addOption(select, '', 'Select Authentication');
      const newGroup = document.createElement('optgroup');
      newGroup.label = 'NEW';
      NEW_TYPES.forEach((item) => addOption(newGroup, 'new:' + item.type, item.label));
      select.appendChild(newGroup);
      const existing = connector.schemes || [];
      if (existing.length) {
        const existGroup = document.createElement('optgroup');
        existGroup.label = 'EXISTING';
        existing.forEach((scheme) => addOption(
          existGroup,
          'existing:' + (scheme.name || scheme.type),
          scheme.name || scheme.label,
        ));
        select.appendChild(existGroup);
      }
      select.value = selectedAuth;
      select.addEventListener('change', () => {
        selectedAuth = select.value;
        oauthGrant = 'authorizationCode';
        renderDetail();
      });
      authCard.appendChild(select);
    } else {
      const head = document.createElement('div');
      head.className = 'card-head';
      const label = document.createElement('div');
      label.textContent = parsed.schemeMode === 'new' ? '+ New Auth Method' : (parsed.schemeName || parsed.schemeType);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = parsed.schemeType;
      label.appendChild(chip);
      head.appendChild(label);
      const change = document.createElement('button');
      change.type = 'button';
      change.textContent = 'Change method';
      change.addEventListener('click', () => {
        selectedAuth = '';
        renderDetail();
      });
      head.appendChild(change);
      authCard.appendChild(head);

      if (parsed.schemeMode === 'new') {
        authCard.appendChild(field('schemeName', 'Name*', { value: parsed.schemeType }));
        if (parsed.schemeType === 'api-key') {
          authCard.appendChild(field('apiKeyName', 'Header / query name*', { value: 'X-API-Key' }));
          const loc = field('apiKeyIn', 'Location*', { select: true });
          const locSelect = loc.lastChild;
          addOption(locSelect, 'header', 'header');
          addOption(locSelect, 'query', 'query');
          addOption(locSelect, 'cookie', 'cookie');
          locSelect.value = 'header';
          locSelect.dataset.field = 'apiKeyIn';
          authCard.appendChild(loc);
        }
        if (parsed.schemeType === 'oauth2') {
          const grant = field('oauthGrant', 'Grant*', { select: true });
          const grantSelect = grant.lastChild;
          addOption(grantSelect, 'authorizationCode', 'Authorization Code');
          addOption(grantSelect, 'clientCredentials', 'Client Credentials');
          addOption(grantSelect, 'password', 'Password');
          grantSelect.value = oauthGrant;
          grantSelect.dataset.field = 'oauthGrant';
          grantSelect.addEventListener('change', () => {
            oauthGrant = grantSelect.value;
            renderDetail();
          });
          authCard.appendChild(grant);
          authCard.appendChild(field('oauth2AuthorizeUrl', 'Authorize URL' + (oauthGrant === 'authorizationCode' ? '*' : ''), {}));
          authCard.appendChild(field('oauth2TokenUrl', 'Token URL*', {}));
          authCard.appendChild(field('oauth2ClientId', 'Client ID' + (oauthGrant === 'authorizationCode' ? '*' : ''), {}));
          authCard.appendChild(field('oauth2ClientSecret', 'Client Secret*', { type: 'password' }));
        }
        if (parsed.schemeType === 'hmac') {
          authCard.appendChild(field('hmacName', 'Signature header name*', { value: 'X-Hub-Signature' }));
          const loc = field('hmacIn', 'Location*', { select: true });
          const locSelect = loc.lastChild;
          addOption(locSelect, 'header', 'header');
          addOption(locSelect, 'query', 'query');
          locSelect.value = 'header';
          locSelect.dataset.field = 'hmacIn';
          authCard.appendChild(loc);
          const alg = field('hmacAlgorithm', 'Algorithm*', { select: true });
          const algSelect = alg.lastChild;
          addOption(algSelect, 'sha256', 'sha256');
          addOption(algSelect, 'sha1', 'sha1');
          addOption(algSelect, 'sha512', 'sha512');
          algSelect.value = 'sha256';
          algSelect.dataset.field = 'hmacAlgorithm';
          authCard.appendChild(alg);
        }
      }
    }
    wrap.appendChild(authCard);

    if (parsed) {
      const connCard = document.createElement('div');
      connCard.className = 'card';
      const connTitle = document.createElement('h3');
      connTitle.textContent = 'Connection';
      connCard.appendChild(connTitle);
      const kind = parsed.schemeType === 'none'
        ? 'bypass'
        : parsed.schemeType === 'oauth2' && (parsed.grant || oauthGrant) === 'authorizationCode'
          ? 'oauth2-code'
          : parsed.schemeType;
      if (kind === 'oauth2-code' || (parsed.schemeType === 'oauth2' && oauthGrant === 'authorizationCode' && parsed.schemeMode === 'new')) {
        const alert = document.createElement('div');
        alert.className = 'alert';
        alert.textContent = 'Authorization-code OAuth 2 must finish in the Versori UI. Connect saves the auth method, then opens the project.';
        connCard.appendChild(alert);
      }
      connCard.appendChild(field('connectionName', 'Connection Name*', {}));
      connCard.appendChild(field('baseUrl', 'API Base URL*', { value: connector.templateBaseUrl || '' }));
      if (parsed.schemeType === 'api-key') {
        connCard.appendChild(field('apiKey', 'API Key*', { type: 'password', placeholder: '$VAR or paste a value' }));
      }
      if (parsed.schemeType === 'basic-auth' || (parsed.schemeType === 'oauth2' && (parsed.grant || oauthGrant) === 'password')) {
        connCard.appendChild(field('username', 'Username*', {}));
        connCard.appendChild(field('password', 'Password*', { type: 'password' }));
      }
      if (parsed.schemeType === 'oauth2' && (parsed.grant || oauthGrant) === 'clientCredentials') {
        connCard.appendChild(field('clientId', 'Client ID*', {}));
        connCard.appendChild(field('clientSecret', 'Client Secret*', { type: 'password' }));
      }
      wrap.appendChild(connCard);
    }

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      composing = false;
      selectedAuth = '';
      renderDetail();
    });
    actions.appendChild(cancel);
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'primary';
    connect.dataset.action = 'connect';
    connect.textContent = parsed && parsed.schemeType === 'none' ? 'Bypass Authentication' : 'Connect';
    connect.addEventListener('click', () => submitCompose(wrap, connector));
    actions.appendChild(connect);
    wrap.appendChild(actions);
    pane.appendChild(wrap);
  }

  function readField(root, name) {
    const nodes = root.querySelectorAll('input');
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].dataset.field === name) return nodes[i].value || '';
    }
    const selects = root.querySelectorAll('select');
    for (let i = 0; i < selects.length; i += 1) {
      if (selects[i].dataset.field === name) return selects[i].value || '';
    }
    return '';
  }

  function submitCompose(root, connector) {
    const parsed = parseAuth(connector);
    if (!parsed) return;
    const grant = readField(root, 'oauthGrant') || parsed.grant || oauthGrant;
    const message = {
      type: 'create-connection',
      schemeMode: parsed.schemeMode,
      schemeType: parsed.schemeType,
      schemeName: readField(root, 'schemeName') || parsed.schemeName,
      connectionName: readField(root, 'connectionName'),
      baseUrl: readField(root, 'baseUrl'),
    };
    if (parsed.schemeType === 'none') message.bypass = true;
    const extras = {
      oauth2GrantType: parsed.schemeType === 'oauth2' ? grant : '',
      oauth2AuthorizeUrl: readField(root, 'oauth2AuthorizeUrl') || parsed.authorizeUrl || '',
      oauth2TokenUrl: readField(root, 'oauth2TokenUrl') || parsed.tokenUrl || '',
      oauth2ClientId: readField(root, 'oauth2ClientId'),
      oauth2ClientSecret: readField(root, 'oauth2ClientSecret'),
      apiKeyName: readField(root, 'apiKeyName'),
      apiKeyIn: readField(root, 'apiKeyIn'),
      hmacName: readField(root, 'hmacName'),
      hmacIn: readField(root, 'hmacIn'),
      hmacAlgorithm: readField(root, 'hmacAlgorithm'),
      apiKey: readField(root, 'apiKey'),
      username: readField(root, 'username'),
      password: readField(root, 'password'),
      clientId: readField(root, 'clientId'),
      clientSecret: readField(root, 'clientSecret'),
    };
    Object.keys(extras).forEach((key) => {
      if (extras[key]) message[key] = extras[key];
    });
    vscode.postMessage(message);
  }

  function renderDetail() {
    const pane = el('connectorDetail');
    pane.textContent = '';
    if (!payload) return;
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
      empty.textContent = 'Select a connector.';
      pane.appendChild(empty);
      return;
    }
    if (!detail || detail.connector.id !== selectedId) {
      const pending = document.createElement('div');
      pending.className = 'empty';
      pending.textContent = 'Loading connector...';
      pane.appendChild(pending);
      return;
    }
    if (detail.error) {
      const box = document.createElement('div');
      box.className = 'error';
      box.textContent = detail.error;
      pane.appendChild(box);
      return;
    }

    const connector = detail.connector;
    const head = document.createElement('div');
    head.className = 'detail-head';
    const titles = document.createElement('div');
    titles.className = 'detail-titles';
    const h2 = document.createElement('h2');
    const dot = document.createElement('span');
    dot.className = 'status-dot ' + connector.status;
    h2.appendChild(dot);
    const title = document.createElement('span');
    title.textContent = connector.name;
    h2.appendChild(title);
    titles.appendChild(h2);
    titles.appendChild(meta('Connection Key', connector.name));
    titles.appendChild(meta('Connector ID', connector.id));
    head.appendChild(titles);
    if (!composing) {
      const newConn = document.createElement('button');
      newConn.type = 'button';
      newConn.className = 'primary';
      newConn.dataset.action = 'new-connection';
      newConn.textContent = 'New Connection';
      newConn.addEventListener('click', () => {
        composing = true;
        selectedAuth = '';
        renderDetail();
      });
      head.appendChild(newConn);
    }
    pane.appendChild(head);

    if (composing) {
      renderCompose(pane, connector);
      return;
    }
    renderOverview(pane, connector, detail.existing || []);
  }

  function render() {
    if (!payload) return;
    el('heading').textContent = payload.heading;
    el('subtitle').textContent = payload.subtitle;
    el('command').textContent = payload.command;
    el('raw').textContent = payload.rawJson || '';
    hideRawPane();
    controls();
    const total = (payload.connectors || []).length;
    const needle = el('filter').value.trim().toLowerCase();
    const shown = (payload.connectors || []).filter((row) => matches(row, needle)).length;
    el('count').textContent = needle ? shown + ' of ' + total : total + (total === 1 ? ' connector' : ' connectors');
    renderList();
    renderDetail();
  }

  el('refresh').addEventListener('click', apply);
  el('filter').addEventListener('input', render);
  wireRawPane();

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'connectors' && message.payload) {
      payload = message.payload;
      controlValues = { ...(payload.controlValues || {}) };
      composing = false;
      selectedAuth = '';
      if (selectedId && !(payload.connectors || []).some((row) => row.id === selectedId)) {
        selectedId = '';
        detail = null;
      }
      render();
      return;
    }
    if (message.type === 'detail') {
      detail = message;
      selectedId = message.connector && message.connector.id;
      composing = false;
      selectedAuth = '';
      render();
    }
  });
})();
`;
