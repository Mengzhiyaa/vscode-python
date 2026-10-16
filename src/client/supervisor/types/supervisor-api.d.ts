import * as vscode from 'vscode';
export declare enum RuntimeState {
    Uninitialized = "uninitialized",
    Initializing = "initializing",
    Starting = "starting",
    Ready = "ready",
    Idle = "idle",
    Busy = "busy",
    Restarting = "restarting",
    Exiting = "exiting",
    Exited = "exited",
    Offline = "offline",
    Interrupting = "interrupting"
}
export declare enum RuntimeExitReason {
    Unknown = "unknown",
    Shutdown = "shutdown",
    ForcedQuit = "forcedQuit",
    Restart = "restart",
    Error = "error",
    StartupFailed = "startupFailed",
    SwitchRuntime = "switchRuntime",
    ExtensionHost = "extensionHost",
    Transferred = "transferred"
}
export declare enum RuntimeStartMode {
    Starting = "starting",
    Restarting = "restarting",
    Reconnecting = "reconnecting",
    Switching = "switching"
}
export interface LanguageRuntimeExit {
    runtime_name: string;
    session_name?: string;
    exit_code: number;
    reason: RuntimeExitReason;
    message: string;
}
export declare enum RuntimeStartupPhase {
    Initializing = "initializing",
    AwaitingTrust = "awaitingTrust",
    Reconnecting = "reconnecting",
    NewFolderTasks = "newFolderTasks",
    Starting = "starting",
    Discovering = "discovering",
    Complete = "complete"
}
export type RuntimeStartupPhaseValue = `${RuntimeStartupPhase}`;
export type ConsoleState = 'uninitialized' | 'starting' | 'busy' | 'ready' | 'offline' | 'interrupting' | 'restarting' | 'exiting' | 'exited' | 'disconnected';
export interface ConsoleSettings {
    scrollbackSize: number;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    fontLigatures: string;
    fontVariations: string;
    fontWeight: string;
    letterSpacing: number;
    showResourceMonitor: boolean;
    promptWhenIncomplete: boolean;
    sashSize: number;
}
export declare enum RuntimeCodeExecutionMode {
    Interactive = "interactive",
    Unprocessed = "unprocessed",
    NonInteractive = "non-interactive",
    Silent = "silent",
    Transient = "transient"
}
export declare enum RuntimeErrorBehavior {
    Stop = "stop",
    Continue = "continue"
}
export interface RuntimeResourceUsage {
    cpu_percent: number;
    memory_bytes: number;
    process_id?: number;
    thread_count?: number;
    sampling_period_ms?: number;
    timestamp?: number;
}
export declare enum NewFolderStartupPhase {
    Initializing = "initializing",
    ApplyLayout = "applyLayout",
    AwaitingTrust = "awaitingTrust",
    CreatingFolder = "creatingFolder",
    RuntimeStartup = "runtimeStartup",
    PostInitialization = "postInitialization",
    Complete = "complete"
}
/**
 * Read-only view of a {@link Barrier} for the public API surface.
 * Consumers can query whether it is open and wait for it, but cannot open it.
 */
export interface BarrierLike {
    isOpen(): boolean;
    wait(): Promise<boolean>;
}
export interface NewFolderConfiguration {
    readonly folderScheme?: string;
    readonly folderAuthority?: string;
    readonly runtimeMetadata?: LanguageRuntimeMetadata;
    readonly folderTemplate?: string;
    readonly folderPath?: string;
    readonly folderName?: string;
    readonly initGitRepo?: boolean;
    readonly createPyprojectToml?: boolean;
    readonly pythonEnvProviderId?: string;
    readonly pythonEnvProviderName?: string;
    readonly pythonEnvName?: string;
    readonly installIpykernel?: boolean;
    readonly condaPythonVersion?: string;
    readonly uvPythonVersion?: string;
    readonly useRenv?: boolean;
    readonly openInNewWindow?: boolean;
}
export interface IPositronNewFolderTaskOptions {
    readonly label?: string;
    readonly runtimeMetadata?: LanguageRuntimeMetadata;
}
export interface IPositronNewFolderService extends vscode.Disposable {
    readonly onDidChangeNewFolderStartupPhase: vscode.Event<NewFolderStartupPhase>;
    readonly startupPhase: NewFolderStartupPhase;
    readonly onDidChangePendingInitTasks: vscode.Event<Set<string>>;
    readonly onDidChangePostInitTasks: vscode.Event<Set<string>>;
    readonly pendingInitTasks: Set<string>;
    readonly pendingPostInitTasks: Set<string>;
    readonly initTasksComplete: BarrierLike;
    readonly postInitTasksComplete: BarrierLike;
    readonly newFolderRuntimeMetadata: LanguageRuntimeMetadata | undefined;
    storeNewFolderConfig(newFolderConfig: NewFolderConfiguration): Promise<void>;
    clearNewFolderConfig(): Promise<void>;
    initNewFolder(): Promise<void>;
    completeRuntimeStartup(): Promise<void>;
    isCurrentWindowNewFolder(): boolean;
    registerInitTask(task: Promise<void> | (() => Promise<void>), options?: IPositronNewFolderTaskOptions): vscode.Disposable;
    registerPostInitTask(task: Promise<void> | (() => Promise<void>), options?: IPositronNewFolderTaskOptions): vscode.Disposable;
}
export declare enum LanguageRuntimeSessionMode {
    Console = "console",
    Notebook = "notebook",
    Background = "background"
}
export declare enum LanguageRuntimeSessionLocation {
    Machine = "machine",
    Workspace = "workspace",
    Browser = "browser"
}
export declare enum LanguageRuntimeStartupBehavior {
    Immediate = "immediate",
    Implicit = "implicit",
    Explicit = "explicit",
    Manual = "manual"
}
export interface LanguageRuntimeMetadata {
    runtimeId: string;
    runtimeName: string;
    runtimePath: string;
    /** Human-friendly runtime path, for example one using `~` shorthand. */
    runtimeDisplayPath?: string;
    runtimeVersion: string;
    runtimeShortName: string;
    runtimeSource: string;
    languageId: string;
    languageName: string;
    languageVersion: string;
    /** Extension that provides this runtime; used to reactivate it before reload restore. */
    extensionId?: string;
    base64EncodedIconSvg?: string;
    sessionLocation?: LanguageRuntimeSessionLocation;
    startupBehavior: LanguageRuntimeStartupBehavior;
    cacheable?: boolean;
    extraRuntimeData?: unknown;
}
/**
 * One root that a runtime provider scans for interpreters. The path should be
 * resolved before it is returned; `mtimeMs` is zero when the path is absent.
 */
export interface RuntimeRootEntry {
    readonly path: string;
    readonly exists: boolean;
    readonly mtimeMs: number;
}
/**
 * Cheap fingerprint of the roots that influence runtime discovery.
 */
export interface RuntimeRootSignature {
    readonly entries: readonly RuntimeRootEntry[];
    readonly opaque?: string;
}
export interface IRuntimeSessionMetadata {
    sessionId: string;
    sessionName: string;
    sessionMode: LanguageRuntimeSessionMode;
    notebookUri?: vscode.Uri;
    workingDirectory?: string;
    createdTimestamp: number;
    startReason: string;
}
export interface LanguageRuntimeDynState {
    sessionName: string;
    inputPrompt: string;
    continuationPrompt: string;
    busy?: boolean;
    currentWorkingDirectory?: string;
    currentNotebookUri?: vscode.Uri;
}
export interface JupyterKernelSpec {
    argv: Array<string>;
    display_name: string;
    language: string;
    interrupt_mode?: 'signal' | 'message';
    env?: NodeJS.ProcessEnv;
    kernel_protocol_version: string;
    startup_command?: string;
}
export interface ILanguageInstallation {
    readonly languageId: string;
    readonly languageName: string;
    readonly runtimePath: string;
    readonly runtimeVersion: string;
    readonly runtimeSource: string;
    readonly base64EncodedIconSvg?: string;
    readonly startupBehavior?: LanguageRuntimeMetadata['startupBehavior'];
    readonly extraRuntimeData?: Record<string, unknown>;
}
export interface ILanguageInstallationPickerOptions {
    forcePick?: boolean;
    allowBrowse?: boolean;
    persistSelection?: boolean;
    title?: string;
    placeHolder?: string;
    preselectRuntimePath?: string;
}
export interface ILanguageStatementRangeProvider {
    provideStatementRange(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<{
        range: vscode.Range;
        code?: string;
    } | null | undefined>;
}
export interface InputBoundary {
    readonly range: {
        readonly start: number;
        readonly end: number;
    };
    readonly kind: 'whitespace' | 'complete' | 'incomplete' | 'invalid';
    readonly data?: {
        readonly message?: string;
    };
}
export interface ILanguageInputBoundaryProvider {
    provideInputBoundaries(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): vscode.ProviderResult<InputBoundary[]>;
}
export interface ILanguageHelpTopicProvider {
    provideHelpTopic(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<string | null | undefined>;
}
export declare enum LanguageLspState {
    Uninitialized = "uninitialized",
    Starting = "starting",
    Stopped = "stopped",
    Running = "running"
}
export interface ILanguageLspStateChangeEvent {
    oldState: LanguageLspState;
    newState: LanguageLspState;
}
export interface ILanguageLsp extends vscode.Disposable {
    readonly state: LanguageLspState;
    /** Optional per-runtime Console configuration; overrides the factory default. */
    readonly consoleLspConfiguration?: ILanguageConsoleLspConfiguration;
    /** Standard LSP access through this session's already initialized Host client. */
    readonly consoleLspBridge?: ILanguageConsoleLspBridge;
    readonly onDidChangeState?: vscode.Event<ILanguageLspStateChangeEvent>;
    readonly statementRangeProvider?: ILanguageStatementRangeProvider;
    readonly inputBoundaryProvider?: ILanguageInputBoundaryProvider;
    readonly helpTopicProvider?: ILanguageHelpTopicProvider;
    activate(port: number): Promise<void>;
    deactivate(): Promise<void>;
    wait(): Promise<boolean>;
    showOutput(): void;
}
export interface ILanguageConsoleLspNotification {
    readonly method: string;
    readonly params?: unknown;
}
export interface ILanguageConsoleLspRegistration {
    readonly id: string;
    readonly method: string;
    readonly registerOptions?: Readonly<Record<string, unknown>>;
}
/** The Host owns the physical connection, initialization, configuration and shutdown. */
export interface ILanguageConsoleLspBridge {
    readonly capabilities: Readonly<Record<string, unknown>> | undefined;
    readonly registrations: readonly ILanguageConsoleLspRegistration[];
    readonly onDidReceiveNotification: vscode.Event<ILanguageConsoleLspNotification>;
    sendRequest(method: string, params: unknown, token: vscode.CancellationToken): Promise<unknown>;
    sendNotification(method: string, params: unknown): Promise<void>;
    registerRequestHandler(method: string, handler: (params: unknown, token: vscode.CancellationToken) => Promise<unknown>): vscode.Disposable;
}
/** Opt-in Console configuration for a bridge to the session's Host client. */
export interface ILanguageConsoleLspConfiguration {
    readonly rootUri?: string;
    readonly workspaceFolders?: readonly {
        readonly uri: string;
        readonly name: string;
    }[];
    readonly initializationOptions?: unknown;
    readonly settings?: Readonly<Record<string, unknown>>;
    /** Vetted server commands; never interpreted as VS Code commands. */
    readonly allowedCommands?: readonly string[];
    /** Use runtime completion when the Console server returns no suggestions. Defaults to true. */
    readonly kernelCompletionFallback?: boolean;
}
export interface ILanguageLspFactory {
    readonly languageId: string;
    /** Enables the session-isolated Webview client without replacing the Host client. */
    readonly consoleLsp?: ILanguageConsoleLspConfiguration;
    create(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata, dynState: LanguageRuntimeDynState, logChannel: vscode.LogOutputChannel): ILanguageLsp;
}
export type LanguageSessionMode = 'console' | 'notebook' | 'background';
export interface ILanguageRuntimeProvider<TInstallation = unknown> {
    /** Stable owner used to partition discovery cache entries. */
    readonly extensionId?: string;
    readonly languageId: string;
    readonly languageName: string;
    readonly alwaysRediscover?: boolean;
    readonly lspFactory?: ILanguageLspFactory;
    discoverInstallations(logChannel: vscode.LogOutputChannel): AsyncGenerator<TInstallation>;
    resolveInitialInstallation(logChannel: vscode.LogOutputChannel): Promise<TInstallation | undefined>;
    promptForInstallation(logChannel: vscode.LogOutputChannel, options?: ILanguageInstallationPickerOptions): Promise<TInstallation | undefined>;
    formatRuntimeName(installation: TInstallation): string;
    getRuntimeIconPath?(installation: TInstallation): vscode.IconPath | undefined;
    getRuntimePath(installation: TInstallation): string;
    getRuntimeSource(installation: TInstallation): string;
    createRuntimeMetadata(context: vscode.ExtensionContext, installation: TInstallation, logChannel: vscode.LogOutputChannel): LanguageRuntimeMetadata;
    createKernelSpec(context: vscode.ExtensionContext, installation: TInstallation, sessionMode: LanguageSessionMode, logChannel: vscode.LogOutputChannel): Promise<JupyterKernelSpec>;
    validateMetadata?(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata>;
    validateSession?(sessionId: string): Promise<boolean>;
    restoreInstallationFromMetadata?(metadata: LanguageRuntimeMetadata): TInstallation | undefined;
    /**
     * Changes a live session's working directory using language-owned logic.
     * The common supervisor deliberately does not assume an R-style `setwd()`.
     */
    setWorkingDirectory?(session: ILanguageRuntimeSession, workingDirectory: string): Promise<void>;
    shouldRecommendForWorkspace?(): Promise<boolean>;
    getDiscoveryRootSignature?(): Promise<RuntimeRootSignature>;
    getSessionIdPrefix?(sessionMode: LanguageSessionMode): string;
    /** Publishes installations discovered after the initial enumeration settles. */
    readonly onDidDiscoverInstallation?: vscode.Event<TInstallation>;
    /** Publishes runtime removals after the initial enumeration settles. */
    readonly onDidRemoveRuntime?: vscode.Event<{
        readonly runtimeId: string;
    }>;
}
export type BinaryArchiveType = 'zip' | 'tar.gz';
export interface BinaryDefinition {
    repo: string;
    /**
     * GitHub release tag used to download the binary.
     */
    version?: string;
    /**
     * Version emitted by `<binary> --version` when it differs from the
     * GitHub release tag.
     */
    reportedVersion?: string;
    binaryName: string;
    archivePattern: (version: string, platform: string) => string;
    archiveType?: BinaryArchiveType;
    installDir: string;
    platformOverride?: (platform: string) => string;
}
export interface IBinaryProvider {
    getBinaryDefinitions(): Readonly<Record<string, BinaryDefinition>>;
}
export interface Utf8Position {
    line: number;
    character: number;
}
export interface Utf8Range {
    start: Utf8Position;
    end: Utf8Position;
}
export interface Utf8Location {
    uri: vscode.Uri;
    range: Utf8Range;
}
export interface ICodeExecutionAttribution {
    source: string;
    fileUri?: vscode.Uri;
    lineNumber?: number;
    codeLocation?: Utf8Location;
    metadata?: Record<string, unknown>;
}
export interface RuntimeCodeExecutionOptions {
    mode?: RuntimeCodeExecutionMode;
    errorBehavior?: RuntimeErrorBehavior;
    attribution?: ICodeExecutionAttribution;
}
export interface EvaluateCodeResult {
    result: any;
    output: string;
}
/**
 * Public runtime message envelope for notebook/controller integrations.
 * Message-specific fields (for example data, text, or original_message) are
 * preserved as additional properties.
 */
export interface RuntimeProtocolMessage {
    id: string;
    event_clock: number;
    parent_id: string;
    when: string;
    type: string;
    metadata?: Record<string, unknown>;
    buffers?: Array<Uint8Array>;
    data?: Record<string, unknown>;
    output_id?: string;
    text?: string;
    name?: string;
    original_message?: RuntimeProtocolMessage;
}
export interface RuntimeStreamMessage extends RuntimeProtocolMessage {
    name: string;
    text: string;
}
export interface RuntimeInputMessage extends RuntimeProtocolMessage {
    code: string;
    execution_count: number;
}
export interface RuntimeErrorMessage extends RuntimeProtocolMessage {
    name: string;
    message: string;
    traceback: string[];
}
export interface RuntimeOutputMessage extends RuntimeProtocolMessage {
    kind: string;
    data: Record<string, unknown>;
    outputMetadata?: Record<string, unknown>;
    output_id?: string;
    execution_count?: number;
}
export interface RuntimeResultMessage extends RuntimeOutputMessage {
    execution_count: number;
}
export interface RuntimeStateMessage extends RuntimeProtocolMessage {
    state: string;
}
export interface RuntimePromptMessage extends RuntimeProtocolMessage {
    prompt: string;
    password: boolean;
}
export interface RuntimeClearOutputMessage extends RuntimeProtocolMessage {
    wait: boolean;
}
export interface RuntimeUpdateOutputMessage extends RuntimeProtocolMessage {
    kind: string;
    data: Record<string, unknown>;
    output_id: string;
}
export interface RuntimeIPyWidgetMessage extends RuntimeProtocolMessage {
    original_message: RuntimeProtocolMessage;
}
export interface RuntimeDebugProtocolEvent {
    seq: number;
    type: 'event';
    event: string;
    body?: Record<string, unknown>;
}
export interface RuntimeDebugProtocolResponse {
    seq: number;
    type: 'response';
    request_seq: number;
    success: boolean;
    command: string;
    message?: string;
    body?: Record<string, unknown>;
}
export interface RuntimeDebugEventMessage extends RuntimeProtocolMessage {
    content: RuntimeDebugProtocolEvent;
}
export interface RuntimeDebugReplyMessage extends RuntimeProtocolMessage {
    content: RuntimeDebugProtocolResponse;
}
export interface RuntimeOutputRendererContext {
    readonly session: ILanguageRuntimeSession;
    readonly outputKind: string;
    readonly outputId: string;
}
export interface RuntimeRenderedOutput {
    readonly target: 'viewer' | 'plot';
    readonly title?: string;
    readonly uri?: vscode.Uri;
    readonly html?: string;
}
/**
 * Extension-host bridge for outputs that require renderer/preload logic.
 * Renderer extensions retain ownership of loading scripts and interpreting
 * their MIME payload; Supervisor owns the resulting Viewer/Plots surface.
 */
export interface IRuntimeOutputRenderer {
    readonly id: string;
    readonly mimeTypes?: readonly string[];
    readonly outputKinds?: readonly string[];
    render(output: RuntimeOutputMessage, context: RuntimeOutputRendererContext): Promise<RuntimeRenderedOutput | undefined>;
    /** Releases renderer state associated with a cleared or disposed output. */
    disposeOutput?(context: RuntimeOutputRendererContext): void | Promise<void>;
}
export declare enum LanguageRuntimeClientType {
    Variables = "positron.variables",
    Lsp = "positron.lsp",
    Plot = "positron.plot",
    DataExplorer = "positron.dataExplorer",
    Ui = "positron.ui",
    Help = "positron.help",
    Connection = "positron.connection",
    Reticulate = "positron.reticulate",
    IPyWidget = "jupyter.widget",
    IPyWidgetControl = "jupyter.widget.control"
}
export interface ILanguageRuntimeClientInstance extends vscode.Disposable {
    getClientId(): string;
    getClientType(): LanguageRuntimeClientType;
}
/** Output channels associated with one runtime session. */
export type RuntimeSessionOutputChannel = 'console' | 'kernel' | 'lsp';
export interface ILanguageRuntimeSession {
    readonly sessionId: string;
    readonly state: RuntimeState;
    readonly isForeground: boolean;
    readonly workingDirectory: string | undefined;
    readonly created: number;
    readonly dynState: LanguageRuntimeDynState;
    readonly runtimeMetadata: LanguageRuntimeMetadata;
    readonly metadata: IRuntimeSessionMetadata;
    readonly sessionMetadata: IRuntimeSessionMetadata;
    readonly lsp: ILanguageLsp;
    readonly onDidChangeRuntimeState: vscode.Event<RuntimeState>;
    readonly onDidEndSession: vscode.Event<LanguageRuntimeExit>;
    readonly onDidChangeWorkingDirectory: vscode.Event<string>;
    /**
     * Every unhandled runtime protocol message, including wrapped IPyWidget
     * messages. NotebookController owners use this event to project runtime
     * output into NotebookCellExecution.
     */
    readonly onDidReceiveRuntimeMessage: vscode.Event<RuntimeProtocolMessage>;
    readonly onDidReceiveRuntimeMessageStream: vscode.Event<RuntimeStreamMessage>;
    readonly onDidReceiveRuntimeMessageInput: vscode.Event<RuntimeInputMessage>;
    readonly onDidReceiveRuntimeMessageError: vscode.Event<RuntimeErrorMessage>;
    readonly onDidReceiveRuntimeMessageOutput: vscode.Event<RuntimeOutputMessage>;
    readonly onDidReceiveRuntimeMessageResult: vscode.Event<RuntimeResultMessage>;
    readonly onDidReceiveRuntimeMessageState: vscode.Event<RuntimeStateMessage>;
    readonly onDidReceiveRuntimeMessagePrompt: vscode.Event<RuntimePromptMessage>;
    readonly onDidReceiveRuntimeMessageClearOutput: vscode.Event<RuntimeClearOutputMessage>;
    readonly onDidReceiveRuntimeMessageUpdateOutput: vscode.Event<RuntimeUpdateOutputMessage>;
    readonly onDidReceiveRuntimeMessageIPyWidget: vscode.Event<RuntimeIPyWidgetMessage>;
    readonly onDidReceiveRuntimeMessageDebugEvent: vscode.Event<RuntimeDebugEventMessage>;
    readonly onDidReceiveRuntimeMessageDebugReply: vscode.Event<RuntimeDebugReplyMessage>;
    /** Writes a language-owned lifecycle event to this session's Supervisor channel. */
    emitLog?(message: string, level?: vscode.LogLevel): void;
    /** Lists the diagnostic channels available for this session. */
    listOutputChannels?(): readonly RuntimeSessionOutputChannel[];
    /** Shows a diagnostic channel belonging to this session. */
    showOutput?(channel?: RuntimeSessionOutputChannel): void;
    activateLsp(): Promise<void>;
    deactivateLsp(): Promise<void>;
    startDap(targetName: string, debugType: string, debugName: string): Promise<void>;
    connectDap(): Promise<boolean>;
    disconnectDap(): Promise<void>;
    setConsoleWidth(widthInChars: number): Promise<void>;
    execute(code: string, id: string, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior, attribution?: ICodeExecutionAttribution): void | Promise<void>;
    evaluate(code: string): Promise<EvaluateCodeResult>;
    executeAndWait(code: string, options?: RuntimeCodeExecutionOptions, token?: vscode.CancellationToken): Promise<void>;
    callMethod(method: string, ...args: unknown[]): Promise<unknown>;
    watchRuntimeClient(clientType: LanguageRuntimeClientType, handler: (client: ILanguageRuntimeClientInstance) => void): vscode.Disposable;
    waitLsp(): Promise<ILanguageLsp | undefined>;
    getRuntimeState(): RuntimeState;
    createClient(id: string, type: LanguageRuntimeClientType, params: Record<string, unknown>, metadata?: Record<string, unknown>): Promise<void>;
    listClients(type?: LanguageRuntimeClientType): Promise<Record<string, string>>;
    replyToPrompt(id: string, reply: string): Promise<void>;
    interrupt(): Promise<void>;
    /** Fires with the execution ID when queued or submitted work is cancelled or rejected. */
    readonly onDidCancelExecution?: vscode.Event<string>;
    setWorkingDirectory(workingDirectory: string): Promise<void>;
    restart(workingDirectory?: string): Promise<void>;
    shutdown(exitReason?: RuntimeExitReason): Promise<void>;
    forceQuit(): Promise<void>;
}
export interface IRuntimeSessionWillStartEvent {
    session: ILanguageRuntimeSession;
    startMode: RuntimeStartMode;
    hasConsole: boolean;
    activate: boolean;
}
export interface IUiClientInstance extends vscode.Disposable {
    readonly onDidWorkingDirectory: vscode.Event<{
        directory: string;
    }>;
    didChangePlotsRenderSettings(settings: unknown): Promise<void>;
    callMethod(method: string, params: Array<unknown>): Promise<unknown>;
}
export interface ActiveRuntimeSession {
    readonly session: ILanguageRuntimeSession;
    readonly hasConsole: boolean;
    readonly workingDirectory: string;
    state: RuntimeState;
}
export interface ILanguageRuntimeSessionStateEvent {
    session_id: string;
    old_state: RuntimeState;
    new_state: RuntimeState;
}
export interface IRuntimeUiClientStartedEvent {
    sessionId: string;
    uiClient: IUiClientInstance;
}
export interface LanguageRuntimePackage {
    id: string;
    name: string;
    displayName: string;
    version: string;
    license?: string;
    latestVersion?: string;
    publishedDate?: string;
    attached?: boolean;
    outdated?: boolean;
    description?: string;
    title?: string;
    author?: string;
    maintainer?: string;
    url?: string;
    source?: string;
    vulnerabilities?: PackageVulnerability[];
}
export interface PackageVulnerability {
    readonly id: string;
    readonly osvId: string;
    readonly score?: number;
    readonly scoreVersion?: 'v3' | 'v4';
    readonly summary?: string;
    readonly fixedIn?: string;
    readonly published?: string;
    readonly url?: string;
}
export interface PackageRepositoryRequest {
    readonly url: string;
    readonly method?: 'GET' | 'POST';
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly timeoutMs?: number;
}
export interface PackageRepositoryResponse {
    readonly status: number;
    readonly body: string;
}
export type PackagesMetadataStatus = 'fresh' | 'cached' | 'unsupported' | 'timed-out' | 'fetch-failed';
export type PackagesVulnerabilityStatus = 'fresh' | 'cached' | 'disabled' | 'unavailable' | 'timed-out';
export interface PackagesSnapshot {
    packages: LanguageRuntimePackage[];
    metadataStatus: PackagesMetadataStatus;
    vulnerabilityStatus: PackagesVulnerabilityStatus;
    vulnerabilitySource?: {
        readonly host: string;
        readonly fetchedAt: number;
    };
}
export interface PackagesSnapshotOptions {
    listTimeoutMs?: number;
    metadataTimeoutMs?: number;
    vulnerabilityTimeoutMs?: number;
    includeVulnerabilities?: boolean;
}
export interface PackageSpec {
    name: string;
    version?: string;
}
export interface ILanguageRuntimePackageManager {
    dispose?(): void;
    packageRepositoryUrl?(token?: vscode.CancellationToken): Promise<string | undefined>;
    repositoryRequest?(request: PackageRepositoryRequest, token?: vscode.CancellationToken): Promise<PackageRepositoryResponse>;
    getPackageDetail?(name: string, token?: vscode.CancellationToken): Promise<Partial<LanguageRuntimePackage> | undefined>;
    getPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
    uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void>;
    updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
    updateAllPackages(token?: vscode.CancellationToken): Promise<void>;
    searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]>;
    getPackageMetadata?(packageNames: string[], token?: vscode.CancellationToken): Promise<Map<string, Partial<LanguageRuntimePackage>> | undefined>;
}
export interface ILanguageRuntimePackageManagerProvider {
    readonly languageId: string;
    createPackageManager(session: ILanguageRuntimeSession): ILanguageRuntimePackageManager | undefined;
}
export type PackagesItemSize = 'card' | 'row';
export interface IPositronPackagesInstance {
    resolveLatestVersion(name: string, token?: vscode.CancellationToken): Promise<string | undefined>;
    getPackageDetail(name: string, token?: vscode.CancellationToken): Promise<Partial<LanguageRuntimePackage> | undefined>;
    getPackagesSnapshot(token?: vscode.CancellationToken, options?: PackagesSnapshotOptions): Promise<PackagesSnapshot>;
    readonly packages: LanguageRuntimePackage[];
    readonly session: ILanguageRuntimeSession;
    readonly onDidRefreshPackagesInstance: vscode.Event<LanguageRuntimePackage[]>;
    readonly onDidChangeRefreshState: vscode.Event<boolean>;
    readonly onDidChangeInstallState: vscode.Event<boolean>;
    readonly onDidChangeUninstallState: vscode.Event<boolean>;
    readonly onDidChangeUpdateState: vscode.Event<boolean>;
    readonly onDidChangeUpdateAllState: vscode.Event<boolean>;
    refreshPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    refreshMetadata(token?: vscode.CancellationToken): Promise<void>;
    installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
    uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void>;
    updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
    updateAllPackages(token?: vscode.CancellationToken): Promise<void>;
    searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]>;
}
export interface IPositronPackagesService extends vscode.Disposable {
    resolveLatestVersion(name: string, token?: vscode.CancellationToken): Promise<string | undefined>;
    getPackageDetail(name: string, token?: vscode.CancellationToken): Promise<Partial<LanguageRuntimePackage> | undefined>;
    getPackagesSnapshot(token?: vscode.CancellationToken, options?: PackagesSnapshotOptions): Promise<PackagesSnapshot>;
    readonly activeSession: ILanguageRuntimeSession | undefined;
    readonly activePackagesInstance: IPositronPackagesInstance | undefined;
    readonly selectedPackage: string | undefined;
    readonly itemSize: PackagesItemSize;
    readonly onDidChangeActivePackagesInstance: vscode.Event<IPositronPackagesInstance | undefined>;
    readonly onDidStopPackagesInstance: vscode.Event<IPositronPackagesInstance>;
    readonly onDidChangeItemSize: vscode.Event<PackagesItemSize>;
    registerPackageManagerProvider(provider: ILanguageRuntimePackageManagerProvider): vscode.Disposable;
    setActivePositronPackagesSession(session: ILanguageRuntimeSession): void;
    setSelectedPackage(packageName: string | undefined): void;
    setItemSize(itemSize: PackagesItemSize): void;
    getInstances(): IPositronPackagesInstance[];
    refreshPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    refreshMetadata(token?: vscode.CancellationToken): Promise<void>;
    installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
    uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void>;
    updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void>;
    updateAllPackages(token?: vscode.CancellationToken): Promise<void>;
    searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]>;
    searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]>;
}
export interface INotebookSessionUriChangedEvent {
    sessionId: string;
    oldUri: vscode.Uri;
    newUri: vscode.Uri;
}
export interface IRuntimeManager {
    readonly id: number;
    readonly onDidDiscoverRuntime?: vscode.Event<IDiscoveredLanguageRuntime>;
    readonly onDidFinishDiscovery?: vscode.Event<void>;
    discoverAllRuntimes(disabledLanguageIds: string[], force?: boolean): Promise<void>;
    recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<LanguageRuntimeMetadata[]>;
    registerDiscoveredRuntime?<TInstallation = unknown>(languageId: string, installation: TInstallation, metadata: LanguageRuntimeMetadata): boolean;
    registerExternalDiscoveryManager?(languageId: string): vscode.Disposable;
}
export interface ILanguageRuntimeSessionManager {
    managesRuntime(runtimeMetadata: LanguageRuntimeMetadata): Promise<boolean>;
    createSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata, sessionName: string): Promise<ILanguageRuntimeSession>;
    validateSession(runtimeMetadata: LanguageRuntimeMetadata, sessionId: string): Promise<boolean>;
    restoreSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata, sessionName: string): Promise<ILanguageRuntimeSession>;
    validateMetadata(metadata: LanguageRuntimeMetadata): Promise<LanguageRuntimeMetadata>;
}
export interface IRuntimeSessionService {
    readonly activeSession: ILanguageRuntimeSession | undefined;
    foregroundSession: ILanguageRuntimeSession | undefined;
    readonly activeSessions: readonly ILanguageRuntimeSession[];
    readonly sessions: readonly ILanguageRuntimeSession[];
    readonly onWillStartSession: vscode.Event<IRuntimeSessionWillStartEvent>;
    readonly onDidStartRuntime: vscode.Event<ILanguageRuntimeSession>;
    readonly onDidFailStartRuntime: vscode.Event<ILanguageRuntimeSession>;
    readonly onDidCreateSession: vscode.Event<ILanguageRuntimeSession>;
    readonly onDidDeleteSession: vscode.Event<string>;
    readonly onDidDeleteRuntimeSession: vscode.Event<string>;
    readonly onDidChangeActiveSession: vscode.Event<ILanguageRuntimeSession | undefined>;
    readonly onDidChangeForegroundSession: vscode.Event<ILanguageRuntimeSession | undefined>;
    readonly onDidChangeRuntimeState: vscode.Event<ILanguageRuntimeSessionStateEvent>;
    readonly onDidUpdateNotebookSessionUri: vscode.Event<INotebookSessionUriChangedEvent>;
    readonly onDidUpdateSessionName: vscode.Event<ILanguageRuntimeSession>;
    readonly onDidStartUiClient: vscode.Event<IRuntimeUiClientStartedEvent>;
    implicitStartupSuppressed: boolean;
    /**
     * Declares the language-extension-owned VS Code NotebookController that
     * will create/finalize cell executions and forward code to runtime sessions.
     * Disposing the returned value unregisters ownership; it does not dispose
     * the controller itself.
     */
    registerNotebookController(controller: vscode.NotebookController, languageIds: readonly string[]): vscode.Disposable;
    registerSessionManager(manager: ILanguageRuntimeSessionManager): vscode.Disposable;
    getSession(sessionId: string): ILanguageRuntimeSession | undefined;
    getActiveSession(sessionId: string): ActiveRuntimeSession | undefined;
    getActiveSessions(): ActiveRuntimeSession[];
    getConsoleSessionForRuntime(runtimeId: string, includeExited?: boolean): ILanguageRuntimeSession | undefined;
    getConsoleSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined;
    getNotebookSessionForNotebookUri(notebookUri: vscode.Uri): ILanguageRuntimeSession | undefined;
    startNewRuntimeSession(runtimeId: string, sessionName: string, sessionMode: LanguageRuntimeSessionMode, notebookUri: vscode.Uri | undefined, source: string, startMode: RuntimeStartMode, activate: boolean): Promise<string>;
    autoStartRuntime(metadata: LanguageRuntimeMetadata, source: string, activate: boolean): Promise<string>;
    selectRuntime(runtimeId: string, source: string, notebookUri?: vscode.Uri): Promise<void>;
    focusSession(sessionId: string): Promise<void>;
    restartSession(sessionId: string, source: string, interrupt?: boolean): Promise<void>;
    interruptSession(sessionId: string): Promise<void>;
    forceQuitSession(sessionId: string): Promise<void>;
    deleteSession(sessionId: string): Promise<boolean>;
    shutdownNotebookSession(notebookUri: vscode.Uri, exitReason: RuntimeExitReason, source: string): Promise<void>;
    updateNotebookSessionUri(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<string | undefined>;
    updateSessionName(sessionId: string, name: string): void;
    updateActiveLanguages(): void;
    watchUiClient(sessionId: string, handler: (uiClient: IUiClientInstance) => vscode.Disposable | void): vscode.Disposable;
    selectInstallation<TInstallation = unknown>(languageId: string, options?: ILanguageInstallationPickerOptions): Promise<TInstallation | undefined>;
}
export interface ICodeExecutionObserver {
    /** Called when the execution reaches Idle without a runtime error. */
    onFinished?(): void;
    /** Called for a runtime error, cancellation, or session termination. */
    onFailed?(error: Error): void;
}
export interface IPositronConsoleService {
    readonly onDidChangeConsoleWidth: vscode.Event<number>;
    revealConsole(preserveFocus?: boolean): Promise<void>;
    focusConsole(): Promise<void>;
    showConsole(): Promise<void>;
    getConsoleWidth(): number;
    executeCode(languageId: string, sessionId: string | undefined, code: string, attribution: ICodeExecutionAttribution, focus: boolean, allowIncomplete?: boolean, mode?: RuntimeCodeExecutionMode, errorBehavior?: RuntimeErrorBehavior, executionId?: string, documentUri?: vscode.Uri, executionMetadata?: Record<string, unknown>, observer?: ICodeExecutionObserver): Promise<string>;
}
export interface IPositronHelpService {
    showHelpTopic(languageId: string, topic: string): Promise<boolean>;
    find(): Promise<void>;
    showWelcomePage(): void;
}
export interface ISessionRestoreFailedEvent {
    sessionId: string;
    error: Error;
}
export interface IRuntimeAutoStartEvent {
    runtime: LanguageRuntimeMetadata;
    newSession: boolean;
    activate: boolean;
}
export interface SerializedSessionMetadata {
    sessionName: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    metadata: IRuntimeSessionMetadata;
    sessionState: RuntimeState;
    workingDirectory?: string;
    hasConsole?: boolean;
    lastUsed: number;
    localWindowId?: string;
}
export interface IRuntimeStartupService {
    readonly startupPhase: RuntimeStartupPhase;
    readonly discoveredRuntimeCount: number;
    readonly onDidChangeRuntimeStartupPhase: vscode.Event<RuntimeStartupPhase>;
    readonly onWillAutoStartRuntime: vscode.Event<IRuntimeAutoStartEvent>;
    readonly onSessionRestoreFailure: vscode.Event<ISessionRestoreFailedEvent>;
    startup(): Promise<void>;
    resetArchitectureMismatchWarning(languageId?: string): void;
    hasAffiliatedRuntime(): boolean;
    getAffiliatedRuntimeMetadata(languageId: string): LanguageRuntimeMetadata | undefined;
    getAffiliatedRuntimes(): LanguageRuntimeMetadata[];
    clearAffiliatedRuntime(languageId: string): void;
    getPreferredRuntime(languageId: string): LanguageRuntimeMetadata | undefined;
    registerNewFolderInitTask(task: Promise<void> | (() => Promise<void>), options?: {
        label?: string;
        affiliatedRuntimeMetadata?: LanguageRuntimeMetadata;
    }): vscode.Disposable;
    getRestoredSessions(): Promise<SerializedSessionMetadata[]>;
    completeDiscovery(id: number): void;
    registerRuntimeManager(manager: IRuntimeManager): vscode.Disposable;
    rediscoverAllRuntimes(): Promise<void>;
}
/**
 * Runtime-only services exposed to language contributions. Registration
 * ownership is deliberately absent and must go through `api.languages`.
 */
export interface ILanguageContributionServices {
    /** @deprecated Use languageLogChannel for language-owned diagnostics. */
    readonly logChannel: vscode.LogOutputChannel;
    /** Supervisor framework diagnostics. Language extensions should rarely write here. */
    readonly frameworkLogChannel?: vscode.LogOutputChannel;
    /** Diagnostics owned by the registered language extension. */
    readonly languageLogChannel?: vscode.LogOutputChannel;
    readonly runtimeSessionService: Omit<IRuntimeSessionService, 'registerNotebookController' | 'registerSessionManager'>;
    readonly runtimeStartupService: Omit<IRuntimeStartupService, 'registerRuntimeManager'>;
    readonly positronNewFolderService: IPositronNewFolderService;
    readonly positronConsoleService: IPositronConsoleService;
    readonly positronHelpService: IPositronHelpService;
    readonly positronPackagesService: IPositronPackagesService;
}
export interface ISupervisorEnvironmentVariableAction {
    readonly action: vscode.EnvironmentVariableMutatorType;
    readonly name: string;
    readonly value: string;
}
export interface ILanguageTextMateGrammarContribution {
    readonly scopeName: string;
    readonly grammarUri: vscode.Uri;
}
export interface ILanguageWebviewAssets {
    readonly localResourceRoots?: readonly vscode.Uri[];
    readonly monacoSupportModule?: vscode.Uri;
    readonly textMateGrammar?: ILanguageTextMateGrammarContribution;
}
export type SupervisorApiCapability = 'languageCapabilityRegistry' | 'passiveLanguageAssets' | 'optionalLanguageCapabilities' | 'languageCapabilityState' | 'languageOperationState';
export interface ILanguageRegistrationIdentity {
    readonly ownerExtensionId: string;
    readonly languageId: string;
    readonly registrationId: string;
    readonly revision: number;
}
export type LanguageCapabilityKind = 'runtimeProvider' | 'sessionManager' | 'lspFactory' | 'binaryProvider' | 'notebookController' | 'packageManager' | 'help' | 'dataExplorer' | 'testExplorer' | 'commands';
export type CapabilityErrorKind = 'conflict' | 'invalid-registration' | 'dependency-missing' | 'transient-io' | 'timeout' | 'unsupported' | 'cancelled' | 'internal';
export interface SerializedCapabilityError {
    readonly kind: CapabilityErrorKind;
    readonly message: string;
    readonly stack?: string;
}
export interface ILanguageCapabilityKey {
    readonly ownerExtensionId: string;
    readonly languageId: string;
    readonly registrationId: string;
    readonly capabilityId: string;
}
export interface ILanguageCapabilityState extends ILanguageCapabilityKey {
    readonly capability: LanguageCapabilityKind;
    readonly generation: number;
    readonly phase: 'registered' | 'activating' | 'ready' | 'degraded' | 'failed' | 'disposed';
    readonly attempt: number;
    readonly changedAt: number;
    readonly error?: SerializedCapabilityError;
}
export interface ILanguageCapabilityStateChangeEvent {
    readonly previous: ILanguageCapabilityState | undefined;
    readonly current: ILanguageCapabilityState;
}
export type LanguageOperationKind = 'discovery' | 'recommendation' | 'sessionValidation' | 'sessionRestore' | 'sessionStart' | 'lspBind' | 'notebookInitialize';
export interface ILanguageOperationKey {
    readonly ownerExtensionId: string;
    readonly languageId: string;
    readonly operation: LanguageOperationKind;
    readonly entityId: string;
    readonly generation: number;
}
export interface ILanguageOperationState {
    readonly key: ILanguageOperationKey;
    readonly phase: 'pending' | 'running' | 'succeeded' | 'degraded' | 'failed' | 'cancelled';
    readonly attempt: number;
    readonly changedAt: number;
    readonly error?: SerializedCapabilityError;
}
export interface ILanguageOperationStateChangeEvent {
    readonly previous: ILanguageOperationState | undefined;
    readonly current: ILanguageOperationState;
}
export interface ILanguageCapabilityActivationContext {
    readonly identity: ILanguageRegistrationIdentity;
    readonly generation: number;
    readonly services: ILanguageContributionServices;
}
export interface ILanguageOptionalCapabilityDescriptor {
    readonly id: string;
    readonly revision: number;
    readonly kind: Exclude<LanguageCapabilityKind, 'runtimeProvider' | 'sessionManager' | 'lspFactory' | 'binaryProvider'>;
    readonly dependencies?: readonly string[];
    readonly activate: (context: ILanguageCapabilityActivationContext, signal: AbortSignal) => vscode.Disposable | readonly vscode.Disposable[] | Promise<vscode.Disposable | readonly vscode.Disposable[]>;
}
export interface ILanguageNotebookControllerCapability {
    readonly capabilityId: string;
    readonly controller: vscode.NotebookController;
    readonly languageIds: readonly string[];
}
export interface ILanguageCapabilitySnapshot {
    readonly identity: ILanguageRegistrationIdentity;
    readonly generation: number;
    /** Language-owned channel. The registering extension retains disposal ownership. */
    readonly logChannel?: vscode.LogOutputChannel;
    readonly runtimeProvider?: ILanguageRuntimeProvider<unknown>;
    readonly lspFactory?: ILanguageLspFactory;
    readonly binaryProvider?: IBinaryProvider;
    readonly sessionManager?: ILanguageRuntimeSessionManager;
    readonly notebookControllers: readonly ILanguageNotebookControllerCapability[];
    readonly optionalCapabilities: readonly ILanguageOptionalCapabilityDescriptor[];
}
export interface ILanguageRegistrationState {
    readonly identity: ILanguageRegistrationIdentity;
    readonly generation: number;
    readonly phase: 'active' | 'superseded' | 'disposed';
}
export interface ILanguageRegistrationHandle extends vscode.Disposable {
    readonly identity: ILanguageRegistrationIdentity;
    readonly generation: number;
    readonly snapshot: ILanguageCapabilitySnapshot;
    readonly onDidChangeState: vscode.Event<ILanguageRegistrationState>;
    whenCapabilityReady(capabilityId: string, options?: {
        timeout?: number;
        signal?: AbortSignal;
    }): Promise<ILanguageCapabilityState>;
    retry(capabilityId?: string): void;
}
export interface ILanguageRegistrationBuilder {
    /** Associates an extension-owned language log channel with every registered capability. */
    setLogChannel(logChannel: vscode.LogOutputChannel): this;
    setRuntimeProvider<TInstallation>(provider: ILanguageRuntimeProvider<TInstallation>): this;
    setLspFactory(factory: ILanguageLspFactory): this;
    setBinaryProvider(provider: IBinaryProvider): this;
    setSessionManager(manager: ILanguageRuntimeSessionManager): this;
    addNotebookController(capabilityId: string, controller: vscode.NotebookController, languageIds?: readonly string[]): this;
    addOptionalCapability(descriptor: ILanguageOptionalCapabilityDescriptor): this;
    commit(): ILanguageRegistrationHandle;
    rollback(): void;
}
export interface ILanguageCapabilityRegistrationClient {
    readonly ownerExtensionId: string;
    begin(identity: Omit<ILanguageRegistrationIdentity, 'ownerExtensionId'>): ILanguageRegistrationBuilder;
}
export interface ILanguageCapabilityRegistry {
    forExtension(ownerExtensionId: string): ILanguageCapabilityRegistrationClient;
    getSnapshot(languageId: string): ILanguageCapabilitySnapshot | undefined;
    getCapabilityState(key: ILanguageCapabilityKey): ILanguageCapabilityState | undefined;
    getOperationState(key: ILanguageOperationKey): ILanguageOperationState | undefined;
    readonly onDidChangeCapabilityState: vscode.Event<ILanguageCapabilityStateChangeEvent>;
    readonly onDidChangeOperationState: vscode.Event<ILanguageOperationStateChangeEvent>;
}
export interface IDataExplorerBackendRpcRequest {
    readonly method: string;
    readonly uri: string;
    readonly params: Readonly<Record<string, unknown>>;
}
export interface IDataExplorerBackendEvent {
    readonly method: 'schema_update' | 'data_update' | 'return_column_profiles' | 'close';
    readonly uri: string;
    readonly params?: unknown;
}
export interface IDataExplorerBackendTransport extends vscode.Disposable {
    readonly datasetId?: string;
    readonly clientId?: string;
    readonly onDidEmitEvent?: vscode.Event<IDataExplorerBackendEvent>;
    handleRpc(request: IDataExplorerBackendRpcRequest): Promise<unknown>;
}
/**
 * The declarative half of an importer: what it is called, what language its code is written in, and
 * which file extensions it can read. Extensions cannot read every format (base R cannot read XLSX),
 * so the extension list is what keeps unusable options off the offer.
 */
export interface IDataImporterMetadata {
    readonly id: string;
    /** The language the generated code is written in, e.g. 'python'. */
    readonly languageId: string;
    /** A human-readable name for the importer, e.g. 'Python (pandas)'. */
    readonly displayName: string;
    /** File extensions this importer can read, without a leading dot, e.g. ['csv', 'tsv']. */
    readonly fileExtensions: readonly string[];
    /**
     * Words this importer's language will not let you assign to, e.g. 'class' for Python or 'if'
     * for R. Positron suffixes a derived default that collides with one, so an importer that omits
     * the list gets 'class = ...' offered for a file named class.csv.
     */
    readonly reservedNames?: readonly string[];
}
/**
 * Import options that are not part of the file's identity. This bag is the seam for future options
 * (delimiter, skip rows, NA strings, column types, encoding); today only the two below exist.
 */
export interface IDataImportOptions {
    /** Whether the first row holds column names. Defaults to true when absent. */
    readonly hasHeaderRow?: boolean;
    /** The worksheet to read, for formats that have sheets. */
    readonly sheetName?: string;
}
/**
 * A column sort from the Data Explorer view. The column is named rather than indexed, because the
 * generated code operates on the loaded dataframe, where names are the only stable handle.
 */
export interface IDataImportSortKey {
    /** The name of the column to sort by. */
    readonly columnName: string;
    /** Sort order: ascending (true) or descending (false). */
    readonly ascending: boolean;
}
/** The fields every row filter carries, whatever its type. */
export interface IDataImportRowFilterBase {
    /** The name of the column the filter applies to. */
    readonly columnName: string;
    /** The column's canonical Positron display type, e.g. 'integer', 'string', 'boolean'. */
    readonly columnType: string;
    /** How this filter combines with the one before it. Ignored on the first filter. */
    readonly condition: 'and' | 'or';
}
/** Keeps rows where the column's value falls inside (or, for not_between, outside) a range. */
export interface IDataImportBetweenFilter extends IDataImportRowFilterBase {
    readonly filterType: 'between' | 'not_between';
    /** The lower limit, as a stringified column value. */
    readonly leftValue: string;
    /** The upper limit, as a stringified column value. */
    readonly rightValue: string;
}
/** Keeps rows satisfying a binary comparison against one value. */
export interface IDataImportCompareFilter extends IDataImportRowFilterBase {
    readonly filterType: 'compare';
    readonly op: '=' | '!=' | '<' | '<=' | '>' | '>=';
    /** The comparison value, as a stringified column value. */
    readonly value: string;
}
/** Keeps rows whose text matches a search term. */
export interface IDataImportSearchFilter extends IDataImportRowFilterBase {
    readonly filterType: 'search';
    readonly searchType: 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex_match';
    readonly term: string;
    readonly caseSensitive: boolean;
}
/** Keeps rows whose value is in (or, when not inclusive, not in) a set. */
export interface IDataImportSetMembershipFilter extends IDataImportRowFilterBase {
    readonly filterType: 'set_membership';
    /** The set members, as stringified column values. */
    readonly values: string[];
    readonly inclusive: boolean;
}
/** A row filter that needs no parameters beyond its type. */
export interface IDataImportUnaryFilter extends IDataImportRowFilterBase {
    readonly filterType: 'is_null' | 'not_null' | 'is_empty' | 'not_empty' | 'is_true' | 'is_false';
}
/**
 * One row filter from the Data Explorer view, discriminated on filterType so a generator can
 * switch over it exhaustively and route any type it cannot translate to `unsupported`.
 */
export type IDataImportRowFilter = IDataImportBetweenFilter | IDataImportCompareFilter | IDataImportSearchFilter | IDataImportSetMembershipFilter | IDataImportUnaryFilter;
/**
 * The Data Explorer view at the moment the dialog opened: what the user is looking at beyond the
 * raw file. Row filters marked invalid by the backend are excluded, because they are not applied
 * to the on-screen data either.
 */
export interface IDataImportView {
    readonly rowFilters: IDataImportRowFilter[];
    readonly sortKeys: IDataImportSortKey[];
}
/**
 * A request to generate the code that loads one file into one variable.
 */
export interface IDataImportRequest {
    /** The original file, not the positron-data-explorer URI. */
    readonly fileUri: vscode.Uri;
    /**
     * The target variable name. Positron's derived default is always assignable, but the user is
     * free to replace it with anything, so an importer should embed this as given rather than
     * assume it parses.
     */
    readonly variableName: string;
    /** Format and parsing options. */
    readonly options: IDataImportOptions;
    /**
     * The Data Explorer view to reproduce, present only when the user asked to include the
     * current filters and sorts. A generator that cannot translate part of it reports that part
     * in `unsupported` rather than dropping it silently.
     */
    readonly view?: IDataImportView;
}
/**
 * Generated code, plus anything the importer could not express. Silently dropping a filter would
 * hand someone a different dataframe than the one on screen, so the omissions travel with the code.
 */
export interface IDataImportResult {
    /** The generated code, ready to run in a console. */
    readonly code: string;
    /** Human-readable descriptions of anything in the request the importer could not translate. */
    readonly unsupported?: string[];
}
/**
 * A registered importer: its metadata plus its code generator.
 */
export interface IDataImporter extends IDataImporterMetadata {
    /**
     * Generates the code that loads the requested file.
     * @param request The file, target variable name, and options.
     * @returns The generated code, or undefined if the importer declined to generate any.
     */
    generateCode(request: IDataImportRequest): Promise<IDataImportResult | undefined>;
}
export interface IDataExplorerBackendProvider {
    readonly id: string;
    readonly ownerExtensionId?: string;
    canHandle(uri: vscode.Uri): boolean | Promise<boolean>;
    open(uri: vscode.Uri): Promise<IDataExplorerBackendTransport>;
}
export type DataConnectionParameterValues = Record<string, boolean | number | string>;
export declare enum DataConnectionParameterType {
    Boolean = "boolean",
    File = "file",
    Number = "number",
    Option = "option",
    Password = "password",
    String = "string"
}
export interface DataConnectionParameterBase {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly required?: boolean;
}
export type DataConnectionParameter = DataConnectionParameterBase & ({
    readonly type: DataConnectionParameterType.Boolean;
    readonly defaultValue?: boolean;
} | {
    readonly type: DataConnectionParameterType.File;
    readonly defaultValue?: string;
    readonly placeholder?: string;
    readonly filters?: {
        readonly [name: string]: readonly string[];
    };
} | {
    readonly type: DataConnectionParameterType.Number;
    readonly defaultValue?: number;
    readonly placeholder?: string;
} | {
    readonly type: DataConnectionParameterType.Option;
    readonly options: readonly string[];
    readonly defaultValue?: string;
    readonly placeholder?: string;
} | {
    readonly type: DataConnectionParameterType.Password;
    readonly secret: true;
    readonly placeholder?: string;
} | {
    readonly type: DataConnectionParameterType.String;
    readonly secret?: false;
    readonly defaultValue?: string;
    readonly placeholder?: string;
} | {
    readonly type: DataConnectionParameterType.String;
    readonly secret: true;
    readonly placeholder?: string;
    readonly masked?: boolean;
});
export interface DataConnectionMechanism {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly parameters: readonly DataConnectionParameter[];
}
export interface ConnectionCodeVariant {
    readonly id: string;
    readonly label: string;
    readonly code: string;
}
export declare enum DataConnectionNodeKind {
    Database = "database",
    Schema = "schema",
    Table = "table",
    View = "view",
    Field = "field",
    GroupDatabases = "group-databases",
    GroupSchemas = "group-schemas",
    GroupTables = "group-tables",
    GroupViews = "group-views",
    GroupColumns = "group-columns",
    GroupIndexes = "group-indexes",
    Index = "index"
}
export interface DataConnectionNode {
    readonly name: string;
    readonly kind: DataConnectionNodeKind;
    readonly dataType?: string;
    readonly isPrimaryKey?: boolean;
    getChildren?(): Promise<readonly DataConnectionNode[]>;
    preview?(): Promise<void>;
}
export interface DataConnection {
    isReadOnly(): Promise<boolean>;
    getChildren(): Promise<readonly DataConnectionNode[]>;
    disconnect(): Promise<void>;
    isConnected(): Promise<boolean>;
}
export interface DataConnectionDriver {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly iconSvg: string;
    readonly mechanisms: readonly DataConnectionMechanism[];
    readonly supportedLanguageIds: readonly string[];
    connect(mechanismId: string, parameters: DataConnectionParameterValues): Promise<DataConnection>;
    generateConnectionCode?(mechanismId: string, languageId: string, parameters: DataConnectionParameterValues): Promise<readonly ConnectionCodeVariant[]>;
    redactParameterValue?(mechanismId: string, parameterId: string, value: string): vscode.ProviderResult<string>;
}
export interface DataConnectionDriverSummary {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly mechanisms: readonly DataConnectionMechanism[];
    readonly supportedLanguageIds: readonly string[];
}
/** @deprecated Use DataConnectionNode. */
export interface IDataConnectionNode {
    readonly handle: number;
    readonly name: string;
    readonly kind: string;
    readonly dtype?: string;
    readonly hasChildren?: boolean;
    readonly containsData?: boolean;
}
export interface IDataConnectionHandle extends vscode.Disposable {
    isConnected(): Promise<boolean>;
    getChildren(): Promise<readonly IDataConnectionNode[]>;
    nodeGetChildren(nodeHandle: number): Promise<readonly IDataConnectionNode[]>;
    nodePreview(nodeHandle: number): Promise<void>;
    disconnect(): Promise<void>;
}
export interface IDataConnectionParameter {
    readonly id: string;
    readonly label: string;
    readonly type: 'boolean' | 'number' | 'string' | 'password' | 'option';
    readonly required?: boolean;
    readonly secret?: boolean;
    readonly defaultValue?: boolean | number | string;
    readonly options?: readonly string[];
    readonly placeholder?: string;
}
export interface IDataConnectionDriver {
    readonly id: string;
    readonly metadata: {
        readonly id: string;
        readonly name: string;
        readonly description?: string;
        readonly iconSvg?: string;
        readonly mechanisms: readonly {
            readonly id: string;
            readonly label: string;
            readonly description?: string;
            readonly parameters: readonly IDataConnectionParameter[];
        }[];
        readonly supportedLanguageIds?: readonly string[];
    };
    connect(mechanismId: string, params: DataConnectionParameterValues): Promise<IDataConnectionHandle>;
}
export interface IDataConnectionProfile {
    readonly id: string;
    readonly createdAt: number;
    lastUsedAt?: number;
    readonly driverId: string;
    connectionName: string;
    mechanismId: string;
    parameterValues: DataConnectionParameterValues;
    autoConnect?: boolean;
}
export interface ISupervisorFrameworkApi {
    registerDataImporter(importer: IDataImporter): vscode.Disposable;
    getDataImporters(fileExtension: string): Promise<readonly IDataImporterMetadata[]>;
    generateDataImportCode(importerId: string, request: IDataImportRequest): Promise<IDataImportResult | undefined>;
    readonly apiVersion: 2;
    readonly protocolVersion: {
        readonly major: 2;
        readonly minor: number;
    };
    readonly capabilities: readonly SupervisorApiCapability[];
    readonly services: ILanguageContributionServices;
    readonly languages: ILanguageCapabilityRegistry;
    readonly version: string;
    startRuntime(metadata: LanguageRuntimeMetadata, source: string, activate: boolean): Promise<string>;
    createSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata, kernelSpec: JupyterKernelSpec, dynState: LanguageRuntimeDynState): Promise<ILanguageRuntimeSession>;
    restoreSession(runtimeMetadata: LanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata, dynState: LanguageRuntimeDynState): Promise<ILanguageRuntimeSession>;
    validateSession(sessionId: string): Promise<boolean>;
    registerDataExplorerBackendProvider(provider: IDataExplorerBackendProvider): vscode.Disposable;
    openDataExplorer(uri: vscode.Uri, providerId?: string): Promise<void>;
    registerRuntimeOutputRenderer(renderer: IRuntimeOutputRenderer): vscode.Disposable;
    registerDataConnectionDriver(driver: DataConnectionDriver | IDataConnectionDriver): vscode.Disposable;
    getDataConnectionDrivers(): Promise<readonly DataConnectionDriverSummary[]>;
    connectDataConnection(driverId: string, mechanismId: string, parameters: DataConnectionParameterValues): Promise<DataConnection>;
    addUpdateDataConnectionProfile(profile: IDataConnectionProfile, connect?: boolean): Promise<void>;
    connectDataConnectionProfile(profileId: string): Promise<void>;
    registerEnvironmentContributions(extensionId: string, actions: readonly ISupervisorEnvironmentVariableAction[]): vscode.Disposable;
}
export interface IDiscoveredLanguageRuntime<TInstallation = unknown> {
    readonly provider: ILanguageRuntimeProvider<TInstallation>;
    readonly installation: TInstallation;
    readonly metadata: LanguageRuntimeMetadata;
}
