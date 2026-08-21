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
    buildEndUserConnectionsListArgs,
    buildSchemaListArgs,
    buildSetVariableArgs,
    buildSystemsListArgs,
    buildUserCreateArgs,
    buildUserDeleteArgs,
    buildVersionsDeployArgs,
    mergePickedWithStaticConnections,
    ConnectionAssignment,
    VariableAssignment,
} from './args';
import { ActivationsPayload, SystemChoice, WorkspaceMessage, renderActivationsHtml } from './html';
import {
    ConnectionRow,
    encodeVariableValue,
    groupActivations,
    parseSuccessfulJson,
    readDeployedVersion,
    SchemaVariable,
    SystemRow,
    toActivationDetail,
    toActivationRows,
    toConnectionRows,
    toSchemaVariables,
    toSystemRows,
    withFallbackConnections,
} from './rows';
import { handleNavMessage } from '../webview/nav';

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
    selectedExternalId?: string;
    catalogEnv?: string;
    catalogSystems?: Promise<SystemRow[]>;
    catalogSchema?: Promise<SchemaVariable[]>;
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
        (message: {
            type?: string;
            controls?: ControlValues;
            externalId?: string;
            displayName?: string;
            userId?: string;
            label?: string;
            status?: 'active' | 'inactive';
            connections?: ConnectionAssignment[];
            variables?: VariableAssignment[];
        }) => {
            if (handleNavMessage(message, panel)) {
                return;
            }
            if (message?.type === 'refresh') {
                if (message.controls) {
                    entry.values = { ...entry.values, ...message.controls };
                }
                void load(entry);
                return;
            }
            if (message?.type === 'createUser') {
                void createUser(entry, message.displayName, message.externalId);
                return;
            }
            if (message?.type === 'select' && message.externalId) {
                void showWorkspace(entry, {
                    externalId: message.externalId,
                    displayName: message.label ?? message.externalId,
                    userId: message.userId ?? '',
                    status: message.status === 'active' ? 'active' : 'inactive',
                });
                return;
            }
            if (message?.type === 'activate' && message.externalId) {
                void activateUser(
                    entry,
                    message.externalId,
                    message.label ?? message.externalId,
                    {
                        connections: message.connections ?? [],
                        variables: message.variables ?? [],
                    },
                );
                return;
            }
            if (message?.type === 'deactivate' && message.externalId) {
                void deactivateUser(entry, message.externalId, message.label ?? message.externalId);
                return;
            }
            if (message?.type === 'deleteUser' && (message.userId || message.externalId)) {
                void deleteUser(entry, {
                    userId: message.userId ?? '',
                    externalId: message.externalId ?? '',
                    label: message.label ?? message.externalId ?? message.userId ?? 'user',
                });
                return;
            }
            if (message?.type === 'updateVariables' && message.externalId) {
                void updateVariables(
                    entry,
                    message.externalId,
                    message.label ?? message.externalId,
                    message.variables ?? [],
                );
                return;
            }
            if (message?.type === 'redeploy') {
                void redeploy(entry);
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
        const listing = vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => runParsed(deps, spec),
        );
        void cachedSystems(entry, environment);
        void cachedSchema(entry, environment);
        const raw = await listing;

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

        if (entry.selectedExternalId) {
            const selected = rows.find((row) => row.externalId === entry.selectedExternalId);
            if (selected) {
                await showWorkspace(entry, {
                    externalId: selected.externalId,
                    displayName: selected.displayName,
                    userId: selected.userId,
                    status: selected.status,
                });
            } else {
                entry.selectedExternalId = undefined;
            }
        }
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);
        await post(entry, { ...base, error: message });
    }
}

async function createUser(
    entry: OpenPanel,
    displayNameRaw?: string,
    externalIdRaw?: string,
): Promise<void> {
    const displayName = displayNameRaw?.trim() ?? '';
    const externalId = externalIdRaw?.trim() ?? '';
    if (!displayName || !externalId) {
        void vscode.window.showWarningMessage('Versori: display name and external id are required.');
        return;
    }

    await mutate(
        entry,
        'creating user',
        () => buildUserCreateArgs({ displayName, externalId }),
        `Created user "${displayName}" (${externalId}).`,
        false,
    );
}

/**
 * Activate an inactive end-user.
 *
 * Connection and variable picks come from the detail pane dropdowns so the CLI
 * never falls into an interactive TUI under `execFile`.
 */
async function activateUser(
    entry: OpenPanel,
    externalId: string,
    label: string,
    picked: { connections: ConnectionAssignment[]; variables: VariableAssignment[] },
): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    let systems: SystemRow[];
    try {
        systems = await cachedSystems(entry, environment);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not load environment systems — ${errorText(err)}`,
        );
        return;
    }

    const missingDynamic = systems.some(
        (system) =>
            system.dynamic &&
            !picked.connections.some((item) => item.templateId === system.templateId && item.connectionId),
    );
    if (missingDynamic) {
        void vscode.window.showWarningMessage(
            'Versori: pick a connection for every system before activating.',
        );
        return;
    }

    let connections: ConnectionAssignment[];
    try {
        const staticSources = await Promise.all(
            systems
                .filter((system) => !system.dynamic)
                .map(async (system) => {
                    const rows = await listConnections(entry, system.systemId);
                    return {
                        templateId: system.templateId,
                        dynamic: false,
                        connectionId: rows[0]?.id ?? '',
                    };
                }),
        );
        connections = mergePickedWithStaticConnections(picked.connections, staticSources);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not load static connections — ${errorText(err)}`,
        );
        return;
    }

    if (connections.length === 0 || connections.some((item) => !item.connectionId)) {
        void vscode.window.showWarningMessage(
            'Versori: pick a connection for every system before activating.',
        );
        return;
    }

    let schema: SchemaVariable[];
    try {
        schema = await cachedSchema(entry, environment);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not load activation variables — ${errorText(err)}`,
        );
        return;
    }

    const variables: VariableAssignment[] = [];
    try {
        for (const item of picked.variables) {
            const spec = schema.find((variable) => variable.name === item.name);
            variables.push({
                name: item.name,
                value: encodeVariableValue(item.value, spec?.type),
            });
        }
        for (const required of schema.filter((variable) => variable.required)) {
            if (!variables.some((item) => item.name === required.name)) {
                void vscode.window.showWarningMessage(
                    `Versori: ${required.name} is required before activating.`,
                );
                return;
            }
        }
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
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

async function showWorkspace(
    entry: OpenPanel,
    user: { externalId: string; displayName: string; userId: string; status: 'active' | 'inactive' },
): Promise<void> {
    entry.selectedExternalId = user.externalId;
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        await postWorkspace(entry, {
            type: 'workspace',
            externalId: user.externalId,
            displayName: user.displayName,
            userId: user.userId,
            status: user.status,
            activationId: '',
            systems: [],
            schema: [],
            variableNames: [],
            variableValues: {},
            error: 'Choose an environment first.',
        });
        return;
    }

    try {
        const systemsP = cachedSystems(entry, environment);
        const schemaP = cachedSchema(entry, environment);

        if (user.status === 'active') {
            const [systems, schema, detail] = await Promise.all([
                systemsP,
                schemaP,
                loadActivationDetail(entry, environment, user.externalId),
            ]);
            await postWorkspace(entry, {
                type: 'workspace',
                externalId: user.externalId,
                displayName: detail?.displayName || user.displayName,
                userId: user.userId,
                status: user.status,
                activationId: detail?.id ?? '',
                systems: bindSystems(systems, detail?.connections ?? []),
                schema,
                variableNames: detail?.variableNames ?? [],
                variableValues: detail?.variableValues ?? {},
            });
            return;
        }

        const [systems, schema, endUserRaw] = await Promise.all([
            systemsP,
            schemaP,
            listEndUserConnections(entry, user.externalId),
        ]);
        const grouped = groupConnectionsBySystem(toConnectionRows(endUserRaw));

        await postWorkspace(entry, {
            type: 'workspace',
            externalId: user.externalId,
            displayName: user.displayName,
            userId: user.userId,
            status: user.status,
            activationId: '',
            systems: systems.map((system) => ({
                name: system.name,
                systemId: system.systemId,
                templateId: system.templateId,
                dynamic: system.dynamic,
                options: (grouped.get(system.systemId) ?? []).map((connection) => ({
                    id: connection.id,
                    name: connection.name,
                    baseUrl: connection.baseUrl,
                })),
            })),
            schema,
            variableNames: [],
            variableValues: {},
        });
    } catch (err) {
        await postWorkspace(entry, {
            type: 'workspace',
            externalId: user.externalId,
            displayName: user.displayName,
            userId: user.userId,
            status: user.status,
            activationId: '',
            systems: [],
            schema: [],
            variableNames: [],
            variableValues: {},
            error: errorText(err),
        });
    }
}

async function loadActivationDetail(
    entry: OpenPanel,
    environment: string,
    externalId: string,
) {
    const deps = entry.deps;
    const spec: CommandSpec = {
        args: [...buildActivationDetailsArgs(environment, externalId), ...projectArgs(deps.state)],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    try {
        const raw = await runParsed(deps, spec);
        let detail = toActivationDetail(raw);
        if (detail && detail.connections.length === 0) {
            detail = withFallbackConnections(detail, await listEndUserConnections(entry, externalId));
        }
        return detail;
    } catch {
        return undefined;
    }
}

async function deleteUser(
    entry: OpenPanel,
    input: { userId: string; externalId: string; label: string },
): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
        `Delete user "${input.label}" from the organisation?`,
        {
            modal: true,
            detail:
                'This calls DELETE /users/{id} and removes the end-user, not just this environment activation. ' +
                'It cannot be undone.',
        },
        'Delete user',
    );
    if (confirmed !== 'Delete user') {
        return;
    }

    entry.selectedExternalId = undefined;
    await mutate(
        entry,
        'deleting user',
        () => buildUserDeleteArgs({ userId: input.userId, externalId: input.externalId }),
        `Deleted user "${input.label}".`,
        false,
    );
}

async function updateVariables(
    entry: OpenPanel,
    externalId: string,
    label: string,
    picked: VariableAssignment[],
): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }
    if (picked.length === 0) {
        void vscode.window.showWarningMessage('Versori: no activation variables to update.');
        return;
    }

    let schema: SchemaVariable[];
    try {
        schema = await cachedSchema(entry, environment);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not load activation variables — ${errorText(err)}`,
        );
        return;
    }

    const encoded: VariableAssignment[] = [];
    try {
        for (const item of picked) {
            const spec = schema.find((variable) => variable.name === item.name);
            encoded.push({
                name: item.name,
                value: encodeVariableValue(item.value, spec?.type),
            });
        }
    } catch (err) {
        void vscode.window.showErrorMessage(`Versori: ${errorText(err)}`);
        return;
    }

    const deps = entry.deps;
    const specs: CommandSpec[] = encoded.map((item) => ({
        args: [
            ...buildSetVariableArgs({
                environment,
                externalId,
                name: item.name,
                value: item.value,
            }),
            ...projectArgs(deps.state),
        ],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
        json: false,
    }));

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Versori: updating activation variables' },
            async () => {
                for (const spec of specs) {
                    await run(deps.bin, spec);
                    deps.output.appendLine(`$ ${displayCommand(spec)}`);
                }
            },
        );
        void vscode.window.showInformationMessage(`Updated activation variables on "${label}".`);
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(message);
        void vscode.window.showErrorMessage(
            `Versori: updating activation variables failed — ${message}`,
        );
    }

    await load(entry);
}

async function redeploy(entry: OpenPanel): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    const projectId = entry.deps.state.projectId;
    if (!projectId) {
        void vscode.window.showWarningMessage('Versori: no project is selected.');
        return;
    }

    const deps = entry.deps;
    const detailsSpec: CommandSpec = {
        args: ['projects', 'details', projectId],
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };

    let version: { id: string; name: string } | undefined;
    try {
        const raw = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Versori: reading deployed version' },
            () => runParsed(deps, detailsSpec),
        );
        version = readDeployedVersion(raw, environment);
    } catch (err) {
        void vscode.window.showErrorMessage(
            `Versori: could not read project details — ${errorText(err)}`,
        );
        return;
    }

    if (!version) {
        void vscode.window.showWarningMessage(
            `Versori: nothing is deployed on ${environment}, so there is no version to redeploy.`,
        );
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `Redeploy "${version.name || version.id}" to ${environment}?`,
        {
            modal: true,
            detail:
                'Runs projects versions deploy for the currently live version. ' +
                'It does not upload local files or create a new version.',
        },
        'Redeploy',
    );
    if (confirmed !== 'Redeploy') {
        return;
    }

    const live = version;
    await mutate(
        entry,
        'redeploying',
        () => buildVersionsDeployArgs(environment, live.id),
        `Redeployed ${live.name || live.id} to ${environment}.`,
    );
}

async function setVariable(entry: OpenPanel, externalId: string, label: string): Promise<void> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }

    let schema: SchemaVariable[];
    try {
        schema = await cachedSchema(entry, environment);
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

function resetCatalog(entry: OpenPanel, environment: string): void {
    if (entry.catalogEnv === environment) {
        return;
    }
    entry.catalogEnv = environment;
    entry.catalogSystems = undefined;
    entry.catalogSchema = undefined;
}

function cachedSystems(entry: OpenPanel, environment: string): Promise<SystemRow[]> {
    resetCatalog(entry, environment);
    entry.catalogSystems ??= listSystems(entry, environment).catch((err: unknown) => {
        entry.catalogSystems = undefined;
        throw err;
    });
    return entry.catalogSystems;
}

function cachedSchema(entry: OpenPanel, environment: string): Promise<SchemaVariable[]> {
    resetCatalog(entry, environment);
    entry.catalogSchema ??= listSchema(entry).catch((err: unknown) => {
        entry.catalogSchema = undefined;
        throw err;
    });
    return entry.catalogSchema;
}

function groupConnectionsBySystem(rows: ConnectionRow[]): Map<string, ConnectionRow[]> {
    const grouped = new Map<string, ConnectionRow[]>();
    for (const row of rows) {
        const list = grouped.get(row.systemId) ?? [];
        list.push(row);
        grouped.set(row.systemId, list);
    }
    return grouped;
}

function bindSystems(
    systems: SystemRow[],
    connections: Array<{ id: string; name: string; systemId: string; baseUrl: string }>,
): SystemChoice[] {
    return systems.map((system) => {
        const bound = connections.find((connection) => connection.systemId === system.systemId);
        return {
            name: system.name,
            systemId: system.systemId,
            templateId: system.templateId,
            dynamic: system.dynamic,
            options: [],
            boundId: bound?.id,
            boundName: bound?.name,
            boundBaseUrl: bound?.baseUrl,
        };
    });
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

async function listEndUserConnections(
    entry: OpenPanel,
    endUserId: string,
): Promise<unknown> {
    const deps = entry.deps;
    const spec: CommandSpec = {
        args: buildEndUserConnectionsListArgs(endUserId),
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    return runParsed(deps, spec);
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

function postWorkspace(entry: OpenPanel, message: WorkspaceMessage): Thenable<boolean> {
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
