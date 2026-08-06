export interface DocumentParts {
    /** Per-render nonce. Both the style and script tags carry it. */
    nonce: string;
    title: string;
    /** Panel-specific CSS, appended after BASE_CSS so it can override. */
    styles: string;
    /** Markup for <body>, above the script. */
    body: string;
    /** Panel-specific JS, appended after the shared scripts. */
    script: string;
}

/**
 * Assemble a webview document.
 *
 * `default-src 'none'` with a per-render nonce and no external origins is the
 * posture every Versori panel uses: CLI output is untrusted, and panels set all
 * text via `.textContent` so it can never be interpreted as markup.
 */
export function htmlDocument(parts: DocumentParts): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${parts.nonce}'; script-src 'nonce-${parts.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${parts.title}</title>
<style nonce="${parts.nonce}">
${BASE_CSS}
${parts.styles}
</style>
</head>
<body>
${parts.body}
<script nonce="${parts.nonce}">
${CONTROLS_SCRIPT}
${FIELD_PICKER_SCRIPT}
${RAW_PANE_SCRIPT}
${parts.script}
</script>
</body>
</html>`;
}

export const BASE_CSS = `
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 20px 24px;
  }
  h1 { font-size: 1.25em; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0 0 4px; }
  code.cmd {
    display: inline-block;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 16px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
    padding: 12px 14px;
    margin-bottom: 14px;
    border-radius: 3px;
    background: var(--vscode-textBlockQuote-background);
  }
  .controls .ctl { display: flex; flex-direction: column; gap: 4px; }
  .controls label {
    font-size: 0.82em;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .controls select, .controls input {
    padding: 4px 6px;
    font: inherit;
    font-size: 0.92em;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  .controls input[type="number"] { width: 90px; }
  .controls input[type="text"] { min-width: 220px; }
  .controls select:focus, .controls input:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .controls button.apply {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .ctlError {
    flex-basis: 100%;
    color: var(--vscode-errorForeground, #e03131);
    font-size: 0.88em;
  }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
  input[type="search"] {
    flex: 1;
    min-width: 160px;
    padding: 5px 8px;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
  }
  input[type="search"]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button {
    font: inherit;
    padding: 5px 12px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .count { color: var(--vscode-descriptionForeground); font-size: 0.88em; white-space: nowrap; }
  .chip {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 0.85em;
    font-weight: 600;
  }
  .chip.error { background: rgba(224,49,49,0.18); color: var(--vscode-errorForeground, #e03131); }
  .chip.warn  { background: rgba(200,150,0,0.20); color: #c89600; }
  .chip.info  { background: rgba(60,140,220,0.18); color: #3c8cdc; }
  .chip.muted { background: rgba(128,128,128,0.18); color: var(--vscode-descriptionForeground); }
  .picker { position: relative; display: inline-block; }
  .picker .menu {
    display: none;
    position: absolute;
    z-index: 10;
    right: 0;
    max-height: 320px;
    overflow-y: auto;
    padding: 8px 10px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    border-radius: 3px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  }
  .picker.open .menu { display: block; }
  .picker .menu label {
    display: flex;
    gap: 6px;
    align-items: center;
    white-space: nowrap;
    font-size: 0.9em;
    padding: 2px 0;
    cursor: pointer;
  }
  pre#raw {
    display: none;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    padding: 12px;
    border-radius: 3px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
  }
  pre#raw.show { display: block; }
  .empty, .error {
    padding: 20px;
    border-radius: 3px;
    background: var(--vscode-textBlockQuote-background);
    color: var(--vscode-descriptionForeground);
  }
  .error { color: var(--vscode-errorForeground, #e03131); white-space: pre-wrap; }
`;

/**
 * Expandable-row styling, shared by the log and issue panels.
 *
 * Both render a list of records whose headline matters and whose remaining
 * fields are one click away, so the chrome is identical.
 */
export const ENTRY_CSS = `
  .entry { border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25)); }
  .entry.hidden { display: none; }
  .head { display: flex; gap: 10px; align-items: baseline; padding: 5px 6px; cursor: pointer; }
  .head:hover { background: var(--vscode-list-hoverBackground); }
  .twist {
    width: 12px;
    flex: none;
    color: var(--vscode-descriptionForeground);
    font-size: 0.8em;
  }
  .ts {
    flex: none;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .sev { flex: none; }
  .msg { flex: 1; overflow-wrap: anywhere; }
  .inline { display: flex; gap: 6px; flex-wrap: wrap; flex: none; }
  .inline .kv {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.8em;
    padding: 0 5px;
    border-radius: 2px;
    background: rgba(128,128,128,0.15);
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .detail { display: none; padding: 4px 6px 12px 34px; }
  .entry.open .detail { display: block; }
  .detail dl {
    display: grid;
    grid-template-columns: minmax(120px, max-content) 1fr;
    gap: 2px 14px;
    margin: 0;
    font-size: 0.88em;
  }
  .detail dt { font-weight: 600; color: var(--vscode-descriptionForeground); }
  .detail dd {
    margin: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow-wrap: anywhere;
  }
`;

/**
 * Control-row renderer, shared by every panel family.
 *
 * `onChange(id, value)` fires per edit; `onApply()` is the commit. Selects
 * re-render immediately so `showWhen` fields appear and disappear at once.
 */
export const CONTROLS_SCRIPT = `
function renderControls(host, controls, values, onChange, onApply, controlError) {
  const rerender = () =>
    renderControls(host, controls, values, onChange, onApply, controlError);

  host.textContent = '';

  if (!controls || controls.length === 0) {
    host.style.display = 'none';
    return;
  }
  host.style.display = 'flex';

  for (const control of controls) {
    if (control.showWhen &&
        String(values[control.showWhen.field]) !== control.showWhen.equals) {
      continue;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ctl';

    const label = document.createElement('label');
    label.textContent = control.label;
    label.htmlFor = 'c_' + control.id;
    wrap.appendChild(label);

    let input;
    if (control.kind === 'select') {
      input = document.createElement('select');
      for (const option of control.options) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        node.selected = option.value === String(values[control.id]);
        input.appendChild(node);
      }
      input.addEventListener('change', () => {
        onChange(control.id, input.value);
        // Re-render so conditional fields appear or disappear immediately.
        rerender();
      });
    } else {
      input = document.createElement('input');
      input.type = control.kind === 'number'
        ? 'number'
        : (control.kind === 'text' ? 'text' : 'datetime-local');
      if (control.min !== undefined) { input.min = String(control.min); }
      if (control.placeholder) { input.placeholder = control.placeholder; }
      input.value = values[control.id] === undefined ? '' : String(values[control.id]);
      input.addEventListener('change', () => {
        onChange(control.id, control.kind === 'number' ? Number(input.value) : input.value);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { onApply(); } });
    }

    input.id = 'c_' + control.id;
    wrap.appendChild(input);
    host.appendChild(wrap);
  }

  const go = document.createElement('button');
  go.className = 'apply';
  go.textContent = 'Apply';
  go.addEventListener('click', onApply);
  host.appendChild(go);

  if (controlError) {
    const err = document.createElement('div');
    err.className = 'ctlError';
    err.textContent = controlError;
    host.appendChild(err);
  }
}
`;

/**
 * The Raw JSON pane, shared by every panel that has one.
 *
 * Two halves, and both are load-bearing:
 *
 * `wireRawPane()` is the toggle. Showing the pane hides the panel body, so the
 * verbatim payload replaces the curated view rather than sitting alongside it.
 *
 * `hideRawPane()` is the reset every panel must run when a **new payload**
 * arrives. The pane holds every value in that payload, so leaving it open would
 * mean each later refresh, Apply or page turn lands with the whole response
 * already on screen — one deliberate click buying an unbounded number of
 * reveals. That persistence, not the button, is the thing that was ruled a
 * violation. It matters most in the log panel, where fields are arbitrary
 * workflow-authored data and so exactly the class `redact()` cannot protect (it
 * matches field *names*, not values): there the per-field expand is the only
 * real protection, and a persistent raw pane bypasses it.
 *
 * The reset is per-**payload**, not per-render: three panels call it at the top
 * of `render()`, but `results` calls it on the payload path instead, because
 * there `render()` doubles as the filter-input and column-picker handler, and
 * a keystroke or column toggle is not new data — see `results/html.ts` for
 * where and why.
 *
 * Hoisted here rather than written four times so the four panels cannot drift
 * apart again — which is precisely how three of them came to be missing it.
 * Every panel with a raw pane uses the same three element ids (`raw`,
 * `toggleRaw`, `body`), so nothing has to be parameterised.
 */
export const RAW_PANE_SCRIPT = `
function hideRawPane() {
  document.getElementById('raw').classList.remove('show');
  document.getElementById('toggleRaw').classList.remove('active');
  document.getElementById('body').style.display = '';
}

function wireRawPane() {
  const button = document.getElementById('toggleRaw');
  button.addEventListener('click', () => {
    const showing = document.getElementById('raw').classList.toggle('show');
    button.classList.toggle('active', showing);
    document.getElementById('body').style.display = showing ? 'none' : '';
  });
}
`;

/**
 * Checkbox popover for choosing which keys to display.
 *
 * The key list comes from the data, never a hardcoded set — which is the whole
 * point: log records are heterogeneous, so the useful fields differ per project.
 */
export const FIELD_PICKER_SCRIPT = `
function renderFieldPicker(host, label, keys, selected, onChange) {
  // Unlike renderControls, this does not re-render itself — onChange only
  // notifies, so the caller re-renders to refresh the count and the checkboxes.
  // The open state therefore has to survive the rebuild, or ticking one field
  // would close the dropdown and every field would cost two clicks.
  const wasOpen = host.classList.contains('open');

  host.textContent = '';
  host.className = wasOpen ? 'picker open' : 'picker';

  const toggle = document.createElement('button');
  toggle.textContent = label + ' (' + selected.length + '/' + keys.length + ')';
  toggle.addEventListener('click', () => { host.classList.toggle('open'); });
  host.appendChild(toggle);

  const menu = document.createElement('div');
  menu.className = 'menu';

  for (const key of keys) {
    const row = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.includes(key);
    box.addEventListener('change', () => {
      const next = box.checked
        ? selected.concat([key])
        : selected.filter((k) => k !== key);
      onChange(next);
    });
    row.appendChild(box);
    const text = document.createElement('span');
    text.textContent = key;
    row.appendChild(text);
    menu.appendChild(row);
  }

  host.appendChild(menu);
}
`;
