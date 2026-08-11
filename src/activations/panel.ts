import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { CliError, CommandSpec, displayCommand, run } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues, retargetValues } from '../results/controls';
import {
    activationControls,
    buildActivationCreateArgs,
    buildActivationDeleteArgs,
    buildActivationDetailsArgs,
    buildActivationListArgs,
    buildConnectionsListArgs,
    buildSchemaListArgs,
    buildSetVariableArgs,
    buildSystemsListArgs,
    buildUserCreateArgs,
    ConnectionAssignment,
    VariableAssignment,
} from './args';
import { ActivationDetailMessage, ActivationsPayload, renderActivationsHtml } from './html';
import {
    encodeVariableValue,
    groupActivations,
    parseSuccessfulJson,
    SchemaVariable,
    SystemRow,
    toActivationDetail,
    toActivationRows,
    toConnectionRows,
    toSchemaVariables,
    toSystemRows,
} from './rows';

export interface ActivationsDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.activations';

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
    deps: ActivationsDeps;
    controls: Control[];
}

/** Single panel, so a second invocation refreshes rather than duplicating. */
let open: OpenPanel | undefined;

export async function showActivationsPanel(
    deps: ActivationsDeps,
    environments: string[],
): Promise<void> {
    const controls = activationControls(environments);

    if (open) {
        open.panel.reveal();
        open.deps = deps;
        open.controls = controls;
        open.values = retargetValues(controls, open.values);
        await load(open);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Activations · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = {
        panel,
        values: defaultValues(controls),
        deps,
        controls,
    };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderActivationsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage(
        (message: { type?: string; controls?: ControlValues; externalId?: string; label?: string }) => {
            if (message?.type === 'refresh') {
                if (message.controls) {
                    entry.values = { ...entry.values, ...message.controls };
                }
                void load(entry);
                return;
            }
            if (message?.type === 'createUser') {
                void createUser(entry);
                return;
            }
            if (message?.type === 'activate' && message.externalId) {
                void activateUser(entry, message.externalId, message.label ?? message.externalId);
                return;
            }
            if (message?.type === 'deactivate' && message.externalId) {
                void deactivateUser(entry, message.externalId, message.label ?? message.externalId);
                return;
            }
            if (message?.type === 'detail' && message.externalId) {
                void showDetail(entry, message.externalId);
                return;
            }
            if (message?.type === 'setVariable' && message.externalId) {
                void setVariable(entry, message.externalId, message.label ?? message.externalId);
            }
        },
    );

    await load(entry);
}

function defaultValues(controls: Control[]): ControlValues {
    return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps, values, controls } = entry;
    const args = [...buildActivationListArgs(values), ...projectArgs(deps.state)];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);
    const environment = String(values.environment ?? '');
    const heading = `Activations · ${environment || '—'}`;

    const base: ActivationsPayload = {
        heading,
        subtitle: subtitle(deps.state),
        command,
        controls,
        controlValues: values,
        active: [],
        inactive: [],
        rawJson: '',
    };

    if (!environment) {
        await post(entry, {
            ...base,
            controlError: 'Choose an environment first.',
            error: 'Choose an environment to list activations.',
        });
        return;
    }

    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runParsed(deps, spec),
        );

        const rows = toActivationRows(raw);
        const groups = groupActivations(rows);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(
            `${rows.length} user(s) · ${groups.active.length} active · ${groups.inactive.length} inactive`,
        );

        await post(entry, {
            ...base,
            active: groups.active,
            inactive: groups.inactive,
            // The CLI's printable rows include DynamicVariables values. Render
            // the already-sanitised groups instead of echoing that payload into
            // the opt-in raw pane.
            rawJson: JSON.stringify(
                { active: groups.active, inactive: groups.inactive },
                null,
                2,
            ),
        });
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);
        await post(entry, { ...base, error: message });
    }
}

async function createUser(entry: OpenPanel): Promise<void> {
    const displayName = await vscode.window.showInputBox({
        title: 'Create end-user · display name',
        placeHolder: 'Acme Corp',
        ignoreFocusOut: true,
    });
    if (displayName === undefined) {
        return;
    }
    if (!displayName.trim()) {
        void vscode.window.showWarningMessage('Versori: display name is required.');
        return;
    }

    const externalId = await vscode.window.showInputBox({
        title: 'Create end-user · external id',
        placeHolder: 'acme-corp',
        ignoreFocusOut: true,
    });
    if (externalId === undefined) {
        return;
    }
    if (!externalId.trim()) {
        void vscode.window.showWarningMessage('Versori: external id is required.');
        return;
    }

    await mutate(
        entry,
        'creating user',
        () => buildUserCreateArgs({ displayName, externalId }),
        `Created user "${displayName.trim()}" (${externalId.trim()}).`,
        false,
    );
}

/**
 * Activate an inactive end-user.
 *
 * Before spawning the CLI, enumerate systems, connections, and the variable
 * schema so every `--connection` / `--variable` flag is explicit — otherwise
 * the CLI falls into an interactive TUI and hangs under `execFile`.
 */
async function activateUser(entry: OpenPanel, externalId: string, label: string): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    let systems: SystemRow[];
    let schema: SchemaVariable[];
    try {
        systems = await listSystems(entry, environment);
        schema = await listSchema(entry);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not prepare activation — ${errorText(err)}`,
        );
        return;
    }

    if (systems.length === 0) {
        void vscode.window.showWarningMessage(
            'Versori: this environment has no systems linked. Link a system before activating.',
        );
        return;
    }

    const connections: ConnectionAssignment[] = [];
    for (const system of systems) {
        let candidates;
        try {
            candidates = await listConnections(
                entry,
                system.systemId,
                system.dynamic ? externalId : undefined,
            );
        } catch (err) {
            void vscode.window.showErrorMessage(
                `Versori: could not list connections for ${system.name} — ${errorText(err)}`,
            );
            return;
        }

        if (candidates.length === 0) {
            void vscode.window.showWarningMessage(
                `Versori: no ${system.dynamic ? 'embedded' : 'static'} connections for system "${system.name}". ` +
                    'Create one with `versori connections create` first.',
            );
            return;
        }

        const picked =
            candidates.length === 1
                ? candidates[0]
                : await vscode.window.showQuickPick(
                      candidates.map((connection) => ({
                          label: connection.name,
                          description: connection.id,
                          detail: connection.baseUrl || undefined,
                          connection,
                      })),
                      {
                          title: `Connection for ${system.name}`,
                          ignoreFocusOut: true,
                      },
                  ).then((item) => item?.connection);

        if (!picked) {
            return;
        }

        connections.push({
            templateId: system.templateId,
            connectionId: picked.id,
        });
    }

    const variables: VariableAssignment[] = [];
    const required = schema.filter((variable) => variable.required);
    const optional = schema.filter((variable) => !variable.required);

    for (const variable of required) {
        const value = await promptVariableValue(variable, true);
        if (value === undefined) {
            return;
        }
        variables.push({ name: variable.name, value });
    }

    if (optional.length > 0) {
        const extras = await vscode.window.showQuickPick(
            optional.map((variable) => ({
                label: variable.name,
                description: variable.type,
                detail: variable.description || undefined,
                variable,
            })),
            {
                title: 'Optional activation variables to set (none selected = skip)',
                canPickMany: true,
                ignoreFocusOut: true,
            },
        );
        if (extras === undefined) {
            return;
        }
        for (const item of extras) {
            const value = await promptVariableValue(item.variable, false);
            if (value === undefined) {
                return;
            }
            variables.push({ name: item.variable.name, value });
        }
    }

    await mutate(
        entry,
        'activating user',
        () =>
            buildActivationCreateArgs({
                environment,
                externalId,
                connections,
                variables,
            }),
        `Activated "${label}" on ${environment}.`,
    );
}

async function deactivateUser(entry: OpenPanel, externalId: string, label: string): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `Deactivate "${label}" on ${environment}?`,
        {
            modal: true,
            detail:
                'Deletes the activation link only. The end-user and their connections are kept. ' +
                'You can activate them again later.',
        },
        'Deactivate',
    );
    if (confirmed !== 'Deactivate') {
        return;
    }

    await mutate(
        entry,
        'deactivating user',
        () => buildActivationDeleteArgs(environment, externalId),
        `Deactivated "${label}" on ${environment}.`,
    );
}

async function showDetail(entry: OpenPanel, externalId: string): Promise<void> {
    const deps = entry.deps;
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        await postDetail(entry, {
            type: 'detail',
            externalId,
            heading: '',
            connections: [],
            variableNames: [],
            rawJson: '',
            error: 'Choose an environment first.',
        });
        return;
    }

    const spec: CommandSpec = {
        args: [...buildActivationDetailsArgs(environment, externalId), ...projectArgs(deps.state)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };

    try {
        const raw = await runParsed(deps, spec);
        const detail = toActivationDetail(raw);
        if (!detail) {
            await postDetail(entry, {
                type: 'detail',
                externalId,
                heading: '',
                connections: [],
                variableNames: [],
                rawJson: '',
                error: 'No activation details returned.',
            });
            return;
        }

        await postDetail(entry, {
            type: 'detail',
            externalId,
            heading: `${detail.displayName || externalId} · ${detail.id || 'activation'}`,
            connections: detail.connections,
            variableNames: detail.variableNames,
            rawJson: JSON.stringify(detail.redacted, null, 2),
        });
    } catch (err) {
        await postDetail(entry, {
            type: 'detail',
            externalId,
            heading: '',
            connections: [],
            variableNames: [],
            rawJson: '',
            error: errorText(err),
        });
    }
}

async function setVariable(entry: OpenPanel, externalId: string, label: string): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    let schema: SchemaVariable[];
    try {
        schema = await listSchema(entry);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not list declared variables — ${errorText(err)}`,
        );
        return;
    }

    if (schema.length === 0) {
        void vscode.window.showWarningMessage(
            'Versori: this project has no declared activation variables. Add one in the Variables panel first.',
        );
        return;
    }

    const picked = await vscode.window.showQuickPick(
        schema.map((variable) => ({
            label: variable.name,
            description: `${variable.type}${variable.required ? ' · required' : ''}`,
            detail: variable.description || undefined,
            variable,
        })),
        {
            title: `Set variable on ${label}`,
            ignoreFocusOut: true,
        },
    );
    if (!picked) {
        return;
    }

    const value = await promptVariableValue(picked.variable, false);
    // `undefined` = dismissed; blank string is a deliberate empty value.
    if (value === undefined) {
        return;
    }

    await mutate(
        entry,
        'setting variable',
        () =>
            buildSetVariableArgs({
                environment,
                externalId,
                name: picked.variable.name,
                value,
            }),
        `Set ${picked.variable.name} on "${label}".`,
    );
}

async function promptVariableValue(
    variable: SchemaVariable,
    required: boolean,
): Promise<string | undefined> {
    const placeHolder =
        variable.type === 'boolean'
            ? 'true or false'
            : variable.type === 'object'
              ? '{"key":"value"}'
              : variable.type === 'array'
                ? '["a","b"]'
                : variable.type === 'integer' || variable.type === 'number'
                  ? '42'
                  : 'value';

    const raw = await vscode.window.showInputBox({
        title: `${required ? 'Required' : 'Optional'} variable · ${variable.name} (${variable.type})`,
        prompt: variable.description || undefined,
        placeHolder,
        ignoreFocusOut: true,
        // Blank is allowed for optional vars and for set-variable; required blank
        // is rejected below so dismissal stays distinct from an empty string.
        value: '',
    });
    if (raw === undefined) {
        return undefined;
    }
    if (required && raw.trim() === '' && variable.type !== 'string') {
        // Strings may legitimately be blank; other required types need a value.
        void vscode.window.showWarningMessage(
            `Versori: ${variable.name} is required (${variable.type}).`,
        );
        return undefined;
    }

    try {
        return encodeVariableValue(raw, variable.type);
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return undefined;
    }
}

async function listSystems(entry: OpenPanel, environment: string): Promise<SystemRow[]> {
    const deps = entry.deps;
    const spec: CommandSpec = {
        args: [...buildSystemsListArgs(environment), ...projectArgs(deps.state)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const raw = await runParsed(deps, spec);
    return toSystemRows(raw);
}

async function listConnections(
    entry: OpenPanel,
    systemId: string,
    endUserId?: string,
): Promise<ReturnType<typeof toConnectionRows>> {
    const deps = entry.deps;
    const spec: CommandSpec = {
        args: buildConnectionsListArgs(systemId, endUserId),
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const raw = await runParsed(deps, spec);
    return toConnectionRows(raw);
}

async function listSchema(entry: OpenPanel): Promise<SchemaVariable[]> {
    const deps = entry.deps;
    const spec: CommandSpec = {
        args: [...buildSchemaListArgs(), ...projectArgs(deps.state)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const raw = await runParsed(deps, spec);
    return toSchemaVariables(raw);
}

async function mutate(
    entry: OpenPanel,
    title: string,
    args: () => string[],
    success: string,
    projectScoped = true,
): Promise<void> {
    const deps = entry.deps;

    let spec: CommandSpec;
    try {
        spec = {
            args: [...args(), ...(projectScoped ? projectArgs(deps.state) : [])],
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

async function runParsed(deps: ActivationsDeps, spec: CommandSpec): Promise<unknown | undefined> {
    const { stdout } = await run(deps.bin, { ...spec, json: true });
    return parseSuccessfulJson(stdout);
}

function post(entry: OpenPanel, payload: ActivationsPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'activations', payload });
}

function postDetail(entry: OpenPanel, message: ActivationDetailMessage): Thenable<boolean> {
    return entry.panel.webview.postMessage(message);
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
