import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

import { buildConnectionsListArgs } from '../activations/args';
import { parseSuccessfulJson, toConnectionRows } from '../activations/rows';
import { CliError, CommandSpec, buildArgs, displayCommand, run } from '../cli';
import { contextFor, projectArgs } from '../commands/target';
import { ResolvedState } from '../resolver/types';
import { Control, ControlValues, retargetValues } from '../results/controls';
import { handleNavMessage } from '../webview/nav';
import {
    AddAuthSchemeInput,
    ConnectionCreateInput,
    buildAddAuthSchemeArgs,
    buildConnectionCreateArgs,
    buildConnectionUnlinkArgs,
    buildConnectorListArgs,
    buildStaticConnectionsArgs,
    buildSystemConnectArgs,
    buildUpdateAuthSchemeTemplateArgs,
    connectionCreateKind,
    connectorControls,
    redactSecretArgs,
    versoriProjectUrl,
} from './args';
import { ConnectorDetailMessage, ConnectorsPayload, renderConnectorsHtml } from './html';
import { ConnectorRow, toConnectorRows } from './rows';

export interface ConnectorsDeps {
    bin: string;
    state: ResolvedState;
    output: vscode.OutputChannel;
}

const VIEW_TYPE = 'versori.results.connectors';

interface ConnectorHostMessage {
    type?: string;
    controls?: ControlValues;
    id?: string;
    name?: string;
    schemeType?: string;
    schemeMode?: 'new' | 'existing';
    schemeName?: string;
    connectionName?: string;
    baseUrl?: string;
    bypass?: boolean;
    oauth2GrantType?: string;
    oauth2AuthorizeUrl?: string;
    oauth2TokenUrl?: string;
    oauth2ClientId?: string;
    oauth2ClientSecret?: string;
    apiKeyName?: string;
    apiKeyIn?: string;
    hmacName?: string;
    hmacIn?: string;
    hmacAlgorithm?: string;
    apiKey?: string;
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
}

interface OpenPanel {
    panel: vscode.WebviewPanel;
    values: ControlValues;
    deps: ConnectorsDeps;
    controls: Control[];
    selectedId?: string;
    connectors: ConnectorRow[];
}

let open: OpenPanel | undefined;

export async function showConnectorsPanel(
    deps: ConnectorsDeps,
    environments: string[],
): Promise<void> {
    const controls = connectorControls(environments);

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
        'Connectors · Versori',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );

    const entry: OpenPanel = {
        panel,
        values: Object.fromEntries(controls.map((control) => [control.id, control.value])),
        deps,
        controls,
        connectors: [],
    };
    open = entry;

    panel.onDidDispose(() => {
        open = undefined;
    });
    panel.webview.html = renderConnectorsHtml(crypto.randomBytes(16).toString('base64'));

    panel.webview.onDidReceiveMessage((message: ConnectorHostMessage) => {
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
        if (message?.type === 'select' && message.id) {
            void showDetail(entry, message.id, entry.connectors);
            return;
        }
        if (message?.type === 'create-connection') {
            void createConnectionFromForm(entry, message);
            return;
        }
        if (message?.type === 'remove-connection' && message.id) {
            void unlinkConnection(entry, message.id);
            return;
        }
        if (message?.type === 'use-connection' && message.id) {
            void useConnection(entry, message.id);
        }
    });

    await load(entry);
}

async function load(entry: OpenPanel): Promise<void> {
    const { deps, values, controls } = entry;
    const args = [...buildConnectorListArgs(values), ...projectArgs(deps.state)];
    const spec: CommandSpec = {
        args,
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    };
    const command = displayCommand(spec);
    const environment = String(values.environment ?? '');
    const heading = `Connectors · ${environment || '—'}`;

    const base: ConnectorsPayload = {
        heading,
        subtitle: subtitle(deps.state),
        command,
        controls,
        controlValues: values,
        connectors: [],
        rawJson: '',
    };

    if (!environment) {
        await post(entry, {
            ...base,
            controlError: 'Choose an environment first.',
            error: 'Choose an environment to list connectors.',
        });
        return;
    }

    try {
        const systemsSpec = spec;
        const staticSpec: CommandSpec = {
            args: [...buildStaticConnectionsArgs(environment), ...projectArgs(deps.state)],
            cwd: deps.state.projectDir,
            context: contextFor(deps.state),
        };
        const [systemsRaw, staticRaw] = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Versori: ${heading}` },
            () => Promise.all([runParsed(deps, systemsSpec), runParsed(deps, staticSpec)]),
        );

        const connectors = toConnectorRows(systemsRaw, staticRaw);
        entry.connectors = connectors;
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(`${connectors.length} connector(s)`);

        await post(entry, {
            ...base,
            connectors,
            rawJson: JSON.stringify(connectors, null, 2),
        });

        if (entry.selectedId && connectors.some((row) => row.id === entry.selectedId)) {
            await showDetail(entry, entry.selectedId, connectors);
        } else {
            entry.selectedId = undefined;
        }
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${command}`);
        deps.output.appendLine(message);
        await post(entry, { ...base, error: message });
    }
}

async function showDetail(
    entry: OpenPanel,
    id: string,
    known?: ConnectorRow[],
): Promise<void> {
    entry.selectedId = id;
    const connector = (known ?? []).find((row) => row.id === id);
    const fromPayload = connector ?? (await loadConnector(entry, id));
    if (!fromPayload) {
        await postDetail(entry, {
            type: 'detail',
            connector: emptyConnector(id),
            existing: [],
            error: 'Connector not found.',
        });
        return;
    }

    try {
        const existing = toConnectionRows(await listSystemConnections(entry, fromPayload.id));
        await postDetail(entry, {
            type: 'detail',
            connector: fromPayload,
            existing: existing.map((row) => ({
                id: row.id,
                name: row.name,
                baseUrl: row.baseUrl,
            })),
        });
    } catch (err) {
        await postDetail(entry, {
            type: 'detail',
            connector: fromPayload,
            existing: [],
            error: errorText(err),
        });
    }
}

async function loadConnector(entry: OpenPanel, id: string): Promise<ConnectorRow | undefined> {
    const environment = String(entry.values.environment ?? '').trim();
    if (!environment) {
        return undefined;
    }
    try {
        const [systemsRaw, staticRaw] = await Promise.all([
            runParsed(entry.deps, {
                args: [...buildConnectorListArgs(entry.values), ...projectArgs(entry.deps.state)],
                cwd: entry.deps.state.projectDir,
                context: contextFor(entry.deps.state),
            }),
            runParsed(entry.deps, {
                args: [...buildStaticConnectionsArgs(environment), ...projectArgs(entry.deps.state)],
                cwd: entry.deps.state.projectDir,
                context: contextFor(entry.deps.state),
            }),
        ]);
        return toConnectorRows(systemsRaw, staticRaw).find((row) => row.id === id);
    } catch {
        return undefined;
    }
}

async function listSystemConnections(entry: OpenPanel, systemId: string): Promise<unknown> {
    const deps = entry.deps;
    return runParsed(deps, {
        args: buildConnectionsListArgs(systemId),
        cwd: deps.state.projectDir,
        context: contextFor(deps.state),
    });
}

function selectedConnector(entry: OpenPanel): ConnectorRow | undefined {
    return entry.connectors.find((row) => row.id === entry.selectedId);
}

async function createConnectionFromForm(entry: OpenPanel, message: ConnectorHostMessage): Promise<void> {
    const connector = selectedConnector(entry);
    const environment = String(entry.values.environment ?? '').trim();
    if (!connector) {
        void vscode.window.showWarningMessage('Versori: select a connector first.');
        return;
    }
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }
    if (!connector.connectionTemplateId) {
        void vscode.window.showWarningMessage('Versori: this connector has no connection template id.');
        return;
    }

    const schemeType = (message.schemeType ?? '').trim();
    const schemeName = (message.schemeName ?? '').trim();
    const connectionName = (message.connectionName ?? '').trim();
    if (!schemeType) {
        void vscode.window.showWarningMessage('Versori: choose an authentication method.');
        return;
    }
    if (message.schemeMode === 'new' && !schemeName) {
        void vscode.window.showWarningMessage('Versori: auth method name is required.');
        return;
    }
    if (!connectionName && connectionCreateKind({ type: schemeType, grant: message.oauth2GrantType ?? '' }) !== 'oauth2-code') {
        void vscode.window.showWarningMessage('Versori: connection name is required.');
        return;
    }

    const steps: Array<{ title: string; args: () => string[]; projectScoped: boolean }> = [];

    if (message.schemeMode === 'new') {
        const scheme: AddAuthSchemeInput = {
            systemId: connector.id,
            type: schemeType,
            name: schemeName,
            apiKeyName: message.apiKeyName,
            apiKeyIn: message.apiKeyIn,
            oauth2TokenUrl: message.oauth2TokenUrl,
            oauth2AuthorizeUrl: message.oauth2AuthorizeUrl,
            oauth2GrantType: message.oauth2GrantType,
            oauth2ClientId: message.oauth2ClientId,
            oauth2ClientSecret: message.oauth2ClientSecret,
            hmacName: message.hmacName,
            hmacIn: message.hmacIn,
            hmacAlgorithm: message.hmacAlgorithm,
        };
        steps.push({
            title: 'adding auth scheme',
            args: () => buildAddAuthSchemeArgs(scheme),
            projectScoped: false,
        });
    }

    if (schemeName) {
        steps.push({
            title: 'pinning auth scheme',
            args: () => buildUpdateAuthSchemeTemplateArgs(connector.connectionTemplateId, schemeName),
            projectScoped: true,
        });
    }

    const kind = connectionCreateKind({
        type: schemeType,
        grant: message.oauth2GrantType ?? '',
    });

    if (kind === 'oauth2-code') {
        const ok = await runSteps(entry, steps, `Saved OAuth 2 method on "${connector.name}".`);
        if (ok) {
            await openAuthorizationCodeUi(entry.deps.state.projectId);
        }
        return;
    }
    if (kind === 'unsupported') {
        if (message.schemeMode === 'new') {
            await runSteps(entry, steps, `Saved ${schemeType} on "${connector.name}".`);
        }
        void vscode.window.showWarningMessage(
            `Versori: the CLI cannot create connections for ${schemeType}.`,
        );
        return;
    }
    if (!connectionName) {
        void vscode.window.showWarningMessage('Versori: connection name is required.');
        return;
    }

    const create: ConnectionCreateInput = {
        environment,
        name: connectionName,
        templateId: connector.connectionTemplateId,
        baseUrl: message.baseUrl,
        bypass: kind === 'bypass' || message.bypass,
        apiKey: message.apiKey,
        username: message.username,
        password: message.password,
        clientId: message.clientId || message.oauth2ClientId,
        clientSecret: message.clientSecret || message.oauth2ClientSecret,
        tokenUrl: message.oauth2TokenUrl,
    };
    steps.push({
        title: 'creating connection',
        args: () => buildConnectionCreateArgs(create),
        projectScoped: true,
    });
    await runSteps(entry, steps, `Created connection "${connectionName}" on "${connector.name}".`);
}

async function unlinkConnection(entry: OpenPanel, connectionId: string): Promise<void> {
    const connector = selectedConnector(entry);
    if (!connector?.connectionTemplateId) {
        void vscode.window.showWarningMessage('Versori: this connector has no connection template id.');
        return;
    }
    const confirmed = await vscode.window.showWarningMessage(
        `Unbind the active connection from ${connector.name}? The connection is kept — Use or New Connection to bind another.`,
        { modal: true },
        'Unbind',
    );
    if (confirmed !== 'Unbind') {
        return;
    }
    await mutate(
        entry,
        'unbinding connection',
        () =>
            buildConnectionUnlinkArgs({
                connectionId,
                templateId: connector.connectionTemplateId,
            }),
        `Unbound the active connection from "${connector.name}".`,
        false,
    );
}

async function openAuthorizationCodeUi(projectId: string | undefined): Promise<void> {
    const id = projectId?.trim() ?? '';
    if (!id) {
        void vscode.window.showWarningMessage(
            'Versori: OAuth 2 authorization-code connections must be created in the Versori UI. The CLI cannot complete the browser redirect.',
        );
        return;
    }
    const url = versoriProjectUrl(id);
    const openUi = await vscode.window.showInformationMessage(
        'OAuth 2 authorization-code connections must finish in the Versori UI. The CLI cannot complete the browser redirect.',
        'Open Versori',
    );
    if (openUi === 'Open Versori') {
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }
}

async function useConnection(entry: OpenPanel, connectionId: string): Promise<void> {
    const connector = selectedConnector(entry);
    const environment = String(entry.values.environment ?? '').trim();
    if (!connector) {
        void vscode.window.showWarningMessage('Versori: select a connector first.');
        return;
    }
    if (!environment) {
        void vscode.window.showWarningMessage('Versori: choose an environment first.');
        return;
    }
    if (!connector.connectionTemplateId) {
        void vscode.window.showWarningMessage('Versori: this connector has no connection template id.');
        return;
    }

    await mutate(
        entry,
        'binding connection',
        () =>
            buildSystemConnectArgs({
                environment,
                templateId: connector.connectionTemplateId,
                connectionId,
            }),
        `Bound connection on "${connector.name}".`,
        true,
    );
}

async function runSteps(
    entry: OpenPanel,
    steps: Array<{ title: string; args: () => string[]; projectScoped: boolean }>,
    success: string,
): Promise<boolean> {
    if (steps.length === 0) {
        return true;
    }
    for (const step of steps) {
        const ok = await mutate(entry, step.title, step.args, success, step.projectScoped, false);
        if (!ok) {
            await load(entry);
            return false;
        }
    }
    void vscode.window.showInformationMessage(success);
    await load(entry);
    return true;
}

async function mutate(
    entry: OpenPanel,
    title: string,
    args: () => string[],
    success: string,
    projectScoped: boolean,
    reload = true,
): Promise<boolean> {
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
        return false;
    }

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Versori: ${title}` },
            () => run(deps.bin, spec),
        );
        deps.output.appendLine(`$ ${displaySafe(spec)}`);
        if (reload) {
            void vscode.window.showInformationMessage(success);
        }
    } catch (err) {
        const message = errorText(err);
        deps.output.appendLine(`$ ${displaySafe(spec)}`);
        deps.output.appendLine(message);
        void vscode.window.showErrorMessage(`Versori: ${title} failed — ${message}`);
        if (reload) {
            await load(entry);
        }
        return false;
    }

    if (reload) {
        await load(entry);
    }
    return true;
}

function displaySafe(spec: CommandSpec): string {
    return `versori ${redactSecretArgs(buildArgs(spec)).join(' ')}`;
}

function emptyConnector(id: string): ConnectorRow {
    return {
        id,
        connectionTemplateId: '',
        name: id,
        domain: '',
        dynamic: false,
        templateBaseUrl: '',
        schemes: [],
        status: 'none',
        activeConnectionId: '',
        activeConnectionName: '',
        activeBaseUrl: '',
    };
}

async function runParsed(deps: ConnectorsDeps, spec: CommandSpec): Promise<unknown | undefined> {
    const { stdout } = await run(deps.bin, { ...spec, json: true });
    return parseSuccessfulJson(stdout);
}

function post(entry: OpenPanel, payload: ConnectorsPayload): Thenable<boolean> {
    return entry.panel.webview.postMessage({ type: 'connectors', payload });
}

function postDetail(entry: OpenPanel, message: ConnectorDetailMessage): Thenable<boolean> {
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
