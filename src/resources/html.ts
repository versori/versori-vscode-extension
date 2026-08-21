import { htmlDocument } from '../webview/shell';
import {
    AUTOSCALING_MAX,
    CPU_DEFAULT_M,
    CPU_MAX_M,
    CPU_MIN_M,
    CPU_STEP_M,
    MEMORY_DEFAULT_MB,
    MEMORY_MAX_MB,
    MEMORY_MIN_MB,
    MEMORY_STEP_MB,
    REPLICAS_DEFAULT,
    REPLICAS_MAX,
    REPLICAS_MIN,
    ResourceEditorState,
    STORAGE_DEFAULT_MB,
    STORAGE_MAX_MB,
    STORAGE_MIN_MB,
    STORAGE_STEP_MB,
} from './config';

export interface ResourcesPayload {
    heading: string;
    subtitle: string;
    environment: string;
    editor: ResourceEditorState;
    busy?: boolean;
    error?: string;
    success?: string;
}

export function renderResourcesHtml(nonce: string): string {
    return htmlDocument({
        nonce,
        title: 'Versori resources',
        styles: RESOURCES_CSS,
        body: RESOURCES_BODY,
        script: RESOURCES_SCRIPT,
    });
}

const RESOURCES_CSS = `
  .env-badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 0.85em;
    font-weight: 600;
    color: var(--vscode-badge-foreground, #fff);
    background: var(--vscode-badge-background, #0e639c);
    vertical-align: middle;
  }
  .grid {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 14px;
    align-items: start;
    margin-top: 16px;
  }
  @media (max-width: 720px) {
    .grid { grid-template-columns: 1fr; }
  }
  .section {
    padding: 14px 16px;
    border-radius: 8px;
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.12));
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
  }
  .section h2 {
    margin: 0 0 4px;
    font-size: 1.02em;
    font-weight: 600;
  }
  .section .desc {
    margin: 0 0 14px;
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
  }
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .slider-row { display: flex; flex-direction: column; gap: 6px; }
  .slider-row .label {
    font-size: 0.92em;
    font-weight: 600;
  }
  .slider-row input[type="range"] {
    width: 100%;
    accent-color: var(--vscode-button-background, #0e639c);
  }
  .bounds {
    display: flex;
    justify-content: space-between;
    color: var(--vscode-descriptionForeground);
    font-size: 0.82em;
  }
  .custom-note {
    color: var(--vscode-descriptionForeground);
    font-size: 0.82em;
    margin: 0;
  }
  .custom-note.warn {
    color: var(--vscode-editorWarning-foreground, #cca700);
  }
  .text-field, .advanced input[type="text"] {
    width: 100%;
    box-sizing: border-box;
    padding: 5px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .text-field:focus, .advanced input[type="text"]:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .switch-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  .switch-row .copy { display: flex; flex-direction: column; gap: 4px; }
  .switch-row .copy .label { font-weight: 600; font-size: 0.92em; }
  .switch-row .copy .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.82em;
  }
  .switch {
    position: relative;
    width: 40px;
    height: 22px;
    flex: none;
  }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch span {
    position: absolute;
    inset: 0;
    cursor: pointer;
    border-radius: 999px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
    transition: background 0.15s ease;
  }
  .switch span::before {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    left: 2px;
    top: 2px;
    border-radius: 50%;
    background: var(--vscode-foreground);
    transition: transform 0.15s ease;
  }
  .switch input:checked + span {
    background: var(--vscode-button-background, #0e639c);
    border-color: transparent;
  }
  .switch input:checked + span::before {
    transform: translateX(18px);
    background: var(--vscode-button-foreground, #fff);
  }
  .advanced {
    margin-top: 14px;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
  }
  .advanced summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.92em;
  }
  .advanced .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 14px;
    margin-top: 12px;
  }
  @media (max-width: 720px) {
    .advanced .fields { grid-template-columns: 1fr; }
  }
  .advanced label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.82em;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .footer button.primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .footer button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .status {
    margin-top: 12px;
    font-size: 0.9em;
  }
  .status.error { color: var(--vscode-errorForeground, #e03131); }
  .status.success { color: var(--vscode-charts-green, #3fb950); }
  .status.busy { color: var(--vscode-descriptionForeground); }
  .actions-inline { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .actions-inline button { font-size: 0.82em; padding: 3px 8px; }
`;

const RESOURCES_BODY = `
  <h1 id="heading">Loading...</h1>
  <p class="subtitle" id="subtitle"></p>

  <div class="grid">
    <section class="section" id="resourcesSection">
      <h2>Resources</h2>
      <div class="stack" id="resources"></div>
    </section>
    <div class="stack">
      <section class="section">
        <h2>Scaling</h2>
        <p class="desc">Replicas set the baseline; autoscaling can grow up to the maximum below.</p>
        <div class="stack" id="scaling"></div>
      </section>
      <section class="section">
        <h2>Networking</h2>
        <div id="networking"></div>
      </section>
    </div>
  </div>

  <details class="advanced" id="advanced">
    <summary>Advanced</summary>
    <div class="fields" id="advancedFields"></div>
  </details>

  <div class="footer">
    <button type="button" id="discard">Discard</button>
    <button type="button" class="primary" id="apply">Apply</button>
  </div>
  <div class="status" id="status"></div>
`;

/**
 * Exported so `html.test.ts` can execute it against a stubbed DOM.
 * `renderResourcesHtml` embeds the same source.
 */
export const RESOURCES_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  if (typeof wireNav === 'function') { wireNav(vscode); }

  const RANGES = ${JSON.stringify({
      cpu: {
          min: CPU_MIN_M,
          max: CPU_MAX_M,
          step: CPU_STEP_M,
          fallback: CPU_DEFAULT_M,
          kind: 'cpu',
      },
      memory: {
          min: MEMORY_MIN_MB,
          max: MEMORY_MAX_MB,
          step: MEMORY_STEP_MB,
          fallback: MEMORY_DEFAULT_MB,
          kind: 'size',
      },
      storage: {
          min: STORAGE_MIN_MB,
          max: STORAGE_MAX_MB,
          step: STORAGE_STEP_MB,
          fallback: STORAGE_DEFAULT_MB,
          kind: 'size',
      },
      replicas: {
          min: REPLICAS_MIN,
          max: REPLICAS_MAX,
          step: 1,
          fallback: REPLICAS_DEFAULT,
          kind: 'count',
      },
      maxReplicas: {
          min: REPLICAS_MIN,
          max: AUTOSCALING_MAX,
          step: 1,
          fallback: REPLICAS_DEFAULT,
          kind: 'count',
      },
  })};

  let editor = null;
  let baseline = null;
  let busy = false;

  function formatCpu(n) { return n + 'm'; }
  function formatSize(n) {
    if (n >= 1000 && n % 1000 === 0) return (n / 1000) + ' GiB';
    return n + ' MiB';
  }
  function formatCount(n) { return String(n); }
  function formatFor(kind, n) {
    if (kind === 'cpu') return formatCpu(n);
    if (kind === 'size') return formatSize(n);
    return formatCount(n);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function syncRange(key, value) {
    const other = document.querySelector('input[type="range"][data-key="' + key + '"]');
    if (other) {
      other.value = String(value);
    }
    const bound = document.querySelector('[data-bound-for="' + key + '"]');
    const range = RANGES[key];
    if (bound && range) {
      bound.textContent = formatFor(range.kind, value);
    }
  }

  function setStatus(kind, text) {
    const node = el('status');
    node.className = 'status' + (kind ? ' ' + kind : '');
    node.textContent = text || '';
  }

  function setBusy(next) {
    busy = next;
    el('apply').disabled = busy;
    el('discard').disabled = busy;
  }

  function renderQuantity(host, key, label) {
    const control = editor[key];
    const range = RANGES[key];
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';

    const title = document.createElement('div');
    title.className = 'label';
    title.textContent = label;
    wrap.appendChild(title);

    if (control.mode === 'custom') {
      const note = document.createElement('p');
      note.className = 'custom-note warn';
      note.textContent = 'Value is outside the slider range (or not on a step). Editing as text so Apply will not clamp it.';
      wrap.appendChild(note);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-field';
      input.value = control.raw;
      input.addEventListener('input', () => {
        editor[key] = { mode: 'custom', raw: input.value };
      });
      wrap.appendChild(input);

      const actions = document.createElement('div');
      actions.className = 'actions-inline';
      const useSlider = document.createElement('button');
      useSlider.type = 'button';
      useSlider.textContent = 'Use slider (' + formatFor(range.kind, range.fallback) + ')';
      useSlider.addEventListener('click', () => {
        editor[key] = { mode: 'slider', value: range.fallback };
        render();
      });
      actions.appendChild(useSlider);
      wrap.appendChild(actions);
      host.appendChild(wrap);
      return;
    }

    if (control.mode === 'unset') {
      const note = document.createElement('p');
      note.className = 'custom-note';
      note.textContent = 'Not set. Use the slider to choose a value, or leave blank.';
      wrap.appendChild(note);

      const actions = document.createElement('div');
      actions.className = 'actions-inline';
      const useSlider = document.createElement('button');
      useSlider.type = 'button';
      useSlider.textContent = 'Set with slider';
      useSlider.addEventListener('click', () => {
        editor[key] = { mode: 'slider', value: range.fallback };
        render();
      });
      const custom = document.createElement('button');
      custom.type = 'button';
      custom.textContent = 'Enter custom value';
      custom.addEventListener('click', () => {
        editor[key] = { mode: 'custom', raw: '' };
        render();
      });
      actions.appendChild(useSlider);
      actions.appendChild(custom);
      wrap.appendChild(actions);
      host.appendChild(wrap);
      return;
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(control.value);
    input.dataset.key = key;
    // Update in place — calling render() here tears down the <input> mid-drag
    // and leaves the control click-only.
    input.addEventListener('input', () => {
      const next = Number(input.value);
      editor[key] = { mode: 'slider', value: next };
      left.textContent = formatFor(range.kind, next);

      if (key === 'replicas' && editor.maxReplicas.mode === 'slider' && editor.maxReplicas.value < next) {
        editor.maxReplicas = { mode: 'slider', value: next };
        syncRange('maxReplicas', next);
      }
      if (key === 'maxReplicas' && editor.replicas.mode === 'slider' && next < editor.replicas.value) {
        editor.maxReplicas = { mode: 'slider', value: editor.replicas.value };
        input.value = String(editor.replicas.value);
        left.textContent = formatFor(range.kind, editor.replicas.value);
      }
    });
    wrap.appendChild(input);

    const bounds = document.createElement('div');
    bounds.className = 'bounds';
    const left = document.createElement('span');
    left.dataset.boundFor = key;
    left.textContent = formatFor(range.kind, control.value);
    const right = document.createElement('span');
    right.textContent = formatFor(range.kind, range.max);
    bounds.appendChild(left);
    bounds.appendChild(right);
    wrap.appendChild(bounds);

    const actions = document.createElement('div');
    actions.className = 'actions-inline';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      editor[key] = { mode: 'unset' };
      render();
    });
    const custom = document.createElement('button');
    custom.type = 'button';
    custom.textContent = 'Custom…';
    custom.addEventListener('click', () => {
      let raw;
      if (range.kind === 'cpu') {
        raw = formatCpu(control.value);
      } else if (range.kind === 'size') {
        raw = control.value + 'M';
      } else {
        raw = String(control.value);
      }
      editor[key] = { mode: 'custom', raw: raw };
      render();
    });
    actions.appendChild(clear);
    actions.appendChild(custom);
    wrap.appendChild(actions);

    host.appendChild(wrap);
  }

  function renderNetworking() {
    const host = el('networking');
    host.textContent = '';
    const row = document.createElement('div');
    row.className = 'switch-row';

    const copy = document.createElement('div');
    copy.className = 'copy';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Static IP';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = "Route traffic through the static IP of this environment's execution pool.";
    copy.appendChild(label);
    copy.appendChild(hint);

    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!editor.staticIP;
    input.addEventListener('change', () => {
      editor.staticIP = input.checked;
    });
    const track = document.createElement('span');
    toggle.appendChild(input);
    toggle.appendChild(track);

    row.appendChild(copy);
    row.appendChild(toggle);
    host.appendChild(row);
  }

  function renderAdvanced() {
    const host = el('advancedFields');
    host.textContent = '';

    const fields = [
      ['serviceAccount', 'Service account', editor.serviceAccount, (v) => { editor.serviceAccount = v; }],
      ['cpuRequest', 'CPU request', editor.requests.cpu, (v) => { editor.requests.cpu = v; }],
      ['memoryRequest', 'Memory request', editor.requests.memory, (v) => { editor.requests.memory = v; }],
      ['storageRequest', 'Storage request', editor.requests.storage, (v) => { editor.requests.storage = v; }],
    ];

    for (const [id, labelText, value, onChange] of fields) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = id;
      input.value = value || '';
      input.placeholder = 'leave blank to keep / clear';
      input.addEventListener('input', () => onChange(input.value));
      label.appendChild(input);
      host.appendChild(label);
    }
  }

  function render() {
    if (!editor) return;

    el('resources').textContent = '';
    renderQuantity(el('resources'), 'cpu', 'CPU');
    renderQuantity(el('resources'), 'memory', 'Memory');
    renderQuantity(el('resources'), 'storage', 'Storage');

    el('scaling').textContent = '';
    renderQuantity(el('scaling'), 'replicas', 'Replicas');
    renderQuantity(el('scaling'), 'maxReplicas', 'Autoscaling max');

    renderNetworking();
    renderAdvanced();
  }

  function applyPayload(payload) {
    el('heading').textContent = payload.heading || 'Environment Config';
    const subtitle = el('subtitle');
    subtitle.textContent = '';
    subtitle.appendChild(document.createTextNode('Configure infrastructure for '));
    const badge = document.createElement('span');
    badge.className = 'env-badge';
    badge.textContent = payload.environment || '';
    subtitle.appendChild(badge);
    if (payload.subtitle) {
      subtitle.appendChild(document.createTextNode('  ·  ' + payload.subtitle));
    }

    editor = clone(payload.editor);
    baseline = clone(payload.editor);
    setBusy(!!payload.busy);
    if (payload.error) {
      setStatus('error', payload.error);
    } else if (payload.success) {
      setStatus('success', payload.success);
    } else if (payload.busy) {
      setStatus('busy', 'Updating…');
    } else {
      setStatus('', '');
    }
    render();
  }

  el('apply').addEventListener('click', () => {
    if (!editor || busy) return;
    setBusy(true);
    setStatus('busy', 'Updating…');
    vscode.postMessage({ type: 'apply', editor: editor });
  });

  el('discard').addEventListener('click', () => {
    if (!baseline || busy) return;
    editor = clone(baseline);
    setStatus('', '');
    render();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'resources') {
      applyPayload(message.payload || {});
      return;
    }
    if (message.type === 'status') {
      setBusy(!!message.busy);
      if (message.error) {
        setStatus('error', message.error);
      } else if (message.success) {
        setStatus('success', message.success);
        if (message.editor) {
          editor = clone(message.editor);
          baseline = clone(message.editor);
          render();
        }
      } else if (message.busy) {
        setStatus('busy', 'Updating…');
      } else {
        setStatus('', '');
      }
    }
  });
})();
`;
