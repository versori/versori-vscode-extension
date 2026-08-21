import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, run } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import {
    buildVariableAddArgs,
    buildVariableRemoveArgs,
    buildVariablesListArgs,
    buildVariableUpdateArgs,
    parseFieldList,
    VARIABLE_TYPES,
    VariableType,
} from './args';
import { renderVariablesHtml, VariablesPayload } from './html';
import { parseSuccessfulJson, toVariableRows, VariableRow } from './rows';
import { handleNavMessage } from '../webview/nav';

export interface VariablesDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.variables';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    deps: VariablesDeps;
    /** Last successful rows — used to pre-fill update prompts. */
    rows: VariableRow[];
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

export async function showVariablesPanel(deps: VariablesDeps): Promise<void> {
    if (open) {
        open.panel.reveal();
        open.deps = deps;
        await load(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Variables · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = { panel, deps, rows: [] };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderVariablesHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage((message: { type?: string; name?: string }) => {
        if (handleNavMessage(message, panel)) {
            return;
        }
        if (message?.type === 'refresh') {
            void load(entry);
            return;
        }
        if (message?.type === 'add') {
            void addVariable(entry);
            return;
        }
        if (message?.type === 'update' && message.name) {
            void updateVariable(entry, message.name);
            return;
        }
        if (message?.type === 'remove' && message.name) {
            void removeVariable(entry, message.name);
        }
    });

    await load(entry);
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps } = entry;
    const args = [...buildVariablesListArgs(), ...projectArgs(deps.state)];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);
    const heading = 'Activation variable schema';

    const base: VariablesPayload = {
        heading,
        subtitle: subtitle(deps.state),
        command,
        variables: [],
        rawJson: '',
    };

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runParsed(deps, spec),
        );

        const variables = toVariableRows(raw);
        entry.rows = variables;
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(`${variables.length} variable(s)`);

        await post(entry, {
            ...base,
            variables,
            rawJson: JSON.stringify(raw ?? { type: 'variableRow', items: [] }, null, 2),
        });
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);
        entry.rows = [];
        await post(entry, { ...base, error: message });
    }
}

async function addVariable(entry: OpenPanel): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: 'Add variable · name',
        placeHolder: 'tenant_org_id',
        ignoreFocusOut: true,
    });
    if (name === undefined) {
        return;
    }
    if (!name.trim()) {
        void vscode.window.showWarningMessage('Versori: variable name is required.');
        return;
    }

    const typePick = await pickType('Variable type', 'string');
    if (!typePick) {
        return;
    }

    let itemsType: VariableType | undefined;
    if (typePick === 'array') {
        itemsType = await pickType('Array item type', 'string');
        if (!itemsType) {
            return;
        }
    }

    const description = await vscode.window.showInputBox({
        title: 'Description (optional)',
        placeHolder: 'leave blank for none',
        ignoreFocusOut: true,
    });
    if (description === undefined) {
        return;
    }

    const requiredPick = await vscode.window.showQuickPick(
        [
            { label: 'Optional', required: false },
            { label: 'Required on every activation', required: true },
        ],
        { title: 'Required?', ignoreFocusOut: true },
    );
    if (!requiredPick) {
        return;
    }

    let fields: string[] | undefined;
    let strict = false;
    if (typePick === 'object' || (typePick === 'array' && itemsType === 'object')) {
        const fieldRaw = await vscode.window.showInputBox({
            title: 'Sub-fields (optional, comma-separated path:type[:required])',
            placeHolder: 'street:string:required, zip:string',
            ignoreFocusOut: true,
        });
        if (fieldRaw === undefined) {
            return;
        }
        fields = parseFieldList(fieldRaw);

        const strictPick = await vscode.window.showQuickPick(
            [
                { label: 'Allow unknown sub-keys', strict: false },
                { label: 'Strict (additionalProperties: false)', strict: true },
            ],
            { title: 'Object strictness', ignoreFocusOut: true },
        );
        if (!strictPick) {
            return;
        }
        strict = strictPick.strict;
    }

    await mutate(
        entry,
        'adding variable',
        () =>
            buildVariableAddArgs({
                name,
                type: typePick,
                description,
                required: requiredPick.required,
                itemsType,
                strict,
                fields,
            }),
        `Declared variable "${name.trim()}".`,
    );
}

async function updateVariable(entry: OpenPanel, name: string): Promise<void> {
    const existing = entry.rows.find((row) => row.name === name);
    const currentType = (VARIABLE_TYPES as readonly string[]).includes(existing?.type ?? '')
        ? (existing?.type as VariableType)
        : 'string';

    const typePick = await vscode.window.showQuickPick(
        [
            { label: `Keep current (${currentType})`, type: undefined as VariableType | undefined },
            ...VARIABLE_TYPES.map((type) => ({ label: type, type: type as VariableType | undefined })),
        ],
        {
            title: `Update ${name} · type`,
            ignoreFocusOut: true,
        },
    );
    if (!typePick) {
        return;
    }

    const description = await vscode.window.showInputBox({
        title: `Update ${name} · description (blank clears)`,
        value: existing?.description ?? '',
        ignoreFocusOut: true,
    });
    if (description === undefined) {
        return;
    }

    const requiredPick = await vscode.window.showQuickPick(
        [
            { label: 'Leave required flag unchanged', required: undefined as boolean | undefined },
            { label: 'Mark required', required: true as boolean | undefined },
            { label: 'Mark optional', required: false as boolean | undefined },
        ],
        { title: `Update ${name} · required`, ignoreFocusOut: true },
    );
    if (!requiredPick) {
        return;
    }

    let itemsType: VariableType | undefined;
    const effectiveType = typePick.type ?? currentType;
    if (effectiveType === 'array') {
        itemsType = await pickType('Array item type', 'string');
        if (!itemsType) {
            return;
        }
    }

    let fields: string[] | undefined;
    let strict: boolean | undefined;
    if (effectiveType === 'object' || (effectiveType === 'array' && itemsType === 'object')) {
        const fieldRaw = await vscode.window.showInputBox({
            title: 'Additional sub-fields (optional, comma-separated)',
            placeHolder: 'leave blank to leave fields unchanged',
            ignoreFocusOut: true,
        });
        if (fieldRaw === undefined) {
            return;
        }
        fields = parseFieldList(fieldRaw);

        const strictPick = await vscode.window.showQuickPick(
            [
                { label: 'Leave strictness unchanged', strict: undefined as boolean | undefined },
                {
                    label: 'Set strict (additionalProperties: false)',
                    strict: true as boolean | undefined,
                },
            ],
            { title: 'Object strictness', ignoreFocusOut: true },
        );
        if (!strictPick) {
            return;
        }
        strict = strictPick.strict;
    }

    await mutate(
        entry,
        'updating variable',
        () =>
            buildVariableUpdateArgs({
                name,
                type: typePick.type,
                description,
                required: requiredPick.required,
                itemsType,
                strict: strict || undefined,
                fields: fields && fields.length > 0 ? fields : undefined,
            }),
        `Updated variable "${name}".`,
    );
}

async function removeVariable(entry: OpenPanel, name: string): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
        `Remove declared variable "${name}" from the project schema?`,
        {
            modal: true,
            detail:
                'Activations that already set this key keep their stored value, but new ' +
                'activations cannot set it. Passes --yes to the CLI after this confirmation.',
        },
        'Remove',
    );
    if (confirmed !== 'Remove') {
        return;
    }

    await mutate(
        entry,
        'removing variable',
        () => buildVariableRemoveArgs(name),
        `Removed variable "${name}".`,
    );
}

async function pickType(
    title: string,
    selected: VariableType,
): Promise<VariableType | undefined> {
    const picked = await vscode.window.showQuickPick(
        VARIABLE_TYPES.map((type) => ({
            label: type,
            type,
            picked: type === selected,
        })),
        {
            title,
            ignoreFocusOut: true,
        },
    );
    return picked?.type;
}

async function mutate(
    entry: OpenPanel,
    title: string,
    args: () => string[],
    success: string,
): Promise<void> {
    const deps = entry.deps;

    let spec: CommandSpec;
    try {
        spec = {
            args: [...args(), ...projectArgs(deps.state)],
            cwd: deps.state.projectDir,
            context: contextFor(deps.state),
            json: false,
        };
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
    }

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Versori: ${title}` },
            () => run(deps.bin, spec),
        );
        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        void vscode.window.showInformationMessage(success);
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${displayCommand(spec)}`);
        deps.output.appendLine(message);
        void vscode.window.showErrorMessage(`Versori: ${title} failed — ${message}`);
    }

    await load(entry);
}

async function runParsed(deps: VariablesDeps, spec: CommandSpec): Promise<unknown | undefined> {
    const { stdout } = await run(deps.bin, { ...spec, json: true });
    return parseSuccessfulJson(stdout);
}

function post(entry: OpenPanel, payload: VariablesPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'variables', payload });
}

function subtitle(state: ResolvedState): string {
    const parts = [`Context: ${state.contextName ?? 'none'}`];
    if (state.projectId) {
        parts.push(`Project: ${state.projectId}`);
    }
    return parts.join('  ·  ');
}

function errorText(err: unknown): string {
    if (err instanceof CliError) {
        return err.stderr || err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
