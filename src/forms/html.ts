import { FormSpec } from './types';

/**
 * Render the form panel.
 *
 * The spec is embedded as JSON and the DOM is built client-side, so no user or
 * CLI value is ever interpolated into HTML — values are assigned via `.value`
 * and `.textContent`. Only the JSON blob needs escaping.
 *
 * A strict CSP blocks everything except the nonce-tagged inline style and
 * script. There are no external resources of any kind.
 */
export function renderFormHtml(spec: FormSpec, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(spec.title)}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 24px;
  }
  .wrap { max-width: 620px; margin: 0 auto; }
  h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 4px; }
  .subtitle {
    color: var(--vscode-descriptionForeground);
    margin: 0 0 24px;
    font-size: 0.92em;
  }
  .field { margin-bottom: 18px; }
  label.title { display: block; font-weight: 600; margin-bottom: 6px; }
  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.88em;
    margin-top: 4px;
  }
  input[type="text"], textarea, select {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    font-family: inherit;
    font-size: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  textarea { min-height: 72px; resize: vertical; }
  input:focus, textarea:focus, select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .invalid { border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
  .static {
    padding: 6px 8px;
    background: var(--vscode-textBlockQuote-background);
    border-radius: 2px;
  }
  .check { display: flex; align-items: flex-start; gap: 8px; }
  .check input { margin-top: 3px; }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  .spacer { flex: 1; }
  button {
    font-family: inherit;
    font-size: inherit;
    padding: 6px 14px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.danger {
    background: var(--vscode-inputValidation-errorBorder, #be1100);
    color: #fff;
  }
  .confirm {
    display: none;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    padding: 12px;
    border-radius: 3px;
    background: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,0.12));
    border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
  }
  .confirm.show { display: flex; }
  .confirm .msg { flex: 1; }
  #output {
    display: none;
    margin-top: 20px;
    padding: 12px;
    max-height: 320px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.88em;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
    border-radius: 3px;
  }
  #output.show { display: block; }
  .status { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="heading"></h1>
  <p class="subtitle" id="subtitle"></p>
  <div id="fields"></div>

  <div class="actions">
    <button id="submit"></button>
    <button id="cancel" class="secondary">Close</button>
    <span class="spacer"></span>
    <span class="status" id="status"></span>
  </div>

  <div class="confirm" id="confirm">
    <span class="msg" id="confirmMsg"></span>
    <label class="check">
      <input type="checkbox" id="dontAsk">
      <span>Don't ask again</span>
    </label>
    <button id="confirmCancel" class="secondary">Cancel</button>
    <button id="confirmGo" class="danger">Yes, continue</button>
  </div>

  <pre id="output"></pre>
</div>

<script type="application/json" id="spec" nonce="${nonce}">${encodeJson(spec)}</script>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const spec = JSON.parse(document.getElementById('spec').textContent);

  const values = {};
  for (const field of spec.fields) { values[field.id] = field.value; }

  const el = (id) => document.getElementById(id);
  el('heading').textContent = spec.heading;
  el('subtitle').textContent = spec.subtitle;

  const inputs = {};
  const container = el('fields');

  for (const field of spec.fields) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    if (field.kind === 'checkbox') {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!field.value;
      box.addEventListener('change', () => { values[field.id] = box.checked; sync(); });
      const text = document.createElement('span');
      text.textContent = field.label;
      label.appendChild(box);
      label.appendChild(text);
      wrap.appendChild(label);
      inputs[field.id] = box;
    } else {
      const label = document.createElement('label');
      label.className = 'title';
      label.textContent = field.label;
      label.htmlFor = 'f_' + field.id;
      wrap.appendChild(label);

      let control;
      if (field.kind === 'select' && field.options.length <= 1) {
        // Single environment: show it, do not make the user open a dropdown.
        control = document.createElement('div');
        control.className = 'static';
        control.textContent = field.options[0] || field.value || '(none)';
      } else if (field.kind === 'select') {
        control = document.createElement('select');
        for (const option of field.options) {
          const node = document.createElement('option');
          node.value = option;
          node.textContent = option;
          node.selected = option === field.value;
          control.appendChild(node);
        }
        control.addEventListener('change', () => { values[field.id] = control.value; sync(); });
      } else {
        control = document.createElement(field.kind === 'textarea' ? 'textarea' : 'input');
        if (field.kind === 'text') { control.type = 'text'; }
        control.value = field.value || '';
        if (field.placeholder) { control.placeholder = field.placeholder; }
        control.addEventListener('input', () => { values[field.id] = control.value; sync(); });
      }

      control.id = 'f_' + field.id;
      wrap.appendChild(control);
      inputs[field.id] = control;
    }

    if (field.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = field.hint;
      wrap.appendChild(hint);
    }

    container.appendChild(wrap);
  }

  const required = spec.fields
    .filter((f) => (f.kind === 'text' || f.kind === 'textarea') && f.required)
    .map((f) => f.id);

  const interpolate = (template) =>
    template.replace(/\\{(\\w+)\\}/g, (m, key) => (key in values ? String(values[key]) : m));

  const isDryRun = () => !!values[spec.dryRunFieldId];
  const missing = () => required.filter((id) => !String(values[id] || '').trim());

  let busy = false;

  function sync() {
    const blanks = missing();
    for (const id of required) {
      const control = inputs[id];
      if (control) { control.classList.toggle('invalid', blanks.includes(id)); }
    }

    const submit = el('submit');
    submit.textContent = isDryRun() ? spec.dryRunLabel : interpolate(spec.liveLabel);
    submit.classList.toggle('danger', !isDryRun());
    submit.disabled = busy || blanks.length > 0;

    el('confirmMsg').textContent = interpolate(spec.confirmMessage);
  }

  function hideConfirm() { el('confirm').classList.remove('show'); }

  function send(dontAskAgain) {
    busy = true;
    hideConfirm();
    sync();
    el('status').textContent = 'Running...';
    vscode.postMessage({ type: 'submit', values: values, dontAskAgain: !!dontAskAgain });
  }

  el('submit').addEventListener('click', () => {
    if (missing().length > 0) { return; }
    if (!isDryRun() && spec.confirmWhenLive) {
      el('confirm').classList.add('show');
      return;
    }
    send(false);
  });

  el('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  el('confirmCancel').addEventListener('click', hideConfirm);
  el('confirmGo').addEventListener('click', () => send(el('dontAsk').checked));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'result') {
      busy = false;
      el('status').textContent = message.ok ? 'Finished' : 'Failed';
      const output = el('output');
      output.textContent = message.text || '(no output)';
      output.classList.add('show');
      if (message.confirmDisabled) { spec.confirmWhenLive = false; }
      sync();
    }
  });

  sync();
}());
</script>
</body>
</html>`;
}

function encodeJson(value: unknown): string {
    // `<` is escaped so the payload can never terminate the script element.
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(text: string): string {
    return text.replace(
        /[&<>"']/g,
        (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
    );
}
