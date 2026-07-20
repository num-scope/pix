export const IPC_PROTOCOL_VERSION = 1 as const;

export interface ResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
  contextFiles: number;
}

export interface ModelSummary {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  /**
   * `builtin` — pi/pi-ai catalog providers.
   * `custom` — user models.json / extension-registered providers.
   */
  source: "builtin" | "custom";
}

/** Non-secret provider credential status (never includes API keys or tokens). */
export interface ProviderAuthSummary {
  provider: string;
  displayName: string;
  configured: boolean;
  source?:
    | "stored"
    | "runtime"
    | "environment"
    | "fallback"
    | "models_json_key"
    | "models_json_command";
  label?: string;
  modelCount: number;
  oauthAvailable: boolean;
}

export interface ProjectTrustSummary {
  required: boolean;
  trusted: boolean;
  savedDecision: boolean | null;
  fallback: "ask" | "always" | "never";
}

/** Session usage projection from pi `getSessionStats` / `getContextUsage`. */
export interface SessionUsageSummary {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  context?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export interface HostSnapshot {
  runtimeId: string;
  sequence: number;
  cwd: string;
  agentDir: string;
  sessionId: string;
  sessionFile?: string;
  model?: {
    provider: string;
    id: string;
  };
  thinkingLevel?: string;
  availableThinkingLevels?: string[];
  usage?: SessionUsageSummary;
  activeTools: string[];
  projectTrusted: boolean;
  trust?: ProjectTrustSummary;
  resources: ResourceCounts;
  configuredPackages: {
    global: number;
    project: number;
  };
  diagnostics: Array<{
    type: "info" | "warning" | "error";
    message: string;
  }>;
}

export type RuntimeEvent =
  | { type: "agent.started" | "agent.settled" }
  | { type: "message.delta"; delta: string }
  | { type: "message.completed"; reason: "stop" | "length" | "toolUse" }
  | { type: "message.failed"; reason: "aborted" | "error"; message: string }
  | { type: "tool.started"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool.completed";
      toolCallId: string;
      toolName: string;
      output: string;
      isError: boolean;
    }
  | {
      type: "custom.message";
      customType: string;
      content: string;
      details?: unknown;
    }
  | {
      type: "custom.entry";
      customType: string;
      data?: unknown;
    };

export interface P07ProbeResult {
  extensions: number;
  extensionDiagnostics: number;
  input: { width: number; height: number };
  output: { width: number; height: number; bytes: number };
}

export type ExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "setStatus"
  | "setWorkingMessage"
  | "setWorkingVisible"
  | "setWorkingIndicator"
  | "setHiddenThinkingLabel"
  | "setWidget"
  | "setTitle"
  | "setEditorText"
  | "unsupported";

export interface ExtensionUiResponse {
  runtimeId: string;
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Serializable thread row for the sidebar (pi session metadata). */
export interface SessionThreadSummary {
  id: string;
  path: string;
  cwd: string;
  title: string;
  modifiedAt: string;
  messageCount: number;
  active: boolean;
}

/** History used to rebuild the timeline after open/switch/new/fork. */
export interface SessionHistoryMessage {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  isError?: boolean;
  /** pi session entry id when available (fork target). */
  entryId?: string;
}

/** Configured pi package row for Installed view. */
export interface PackageSummary {
  source: string;
  scope: "global" | "project";
  kind: "npm" | "git" | "local" | "unknown";
  filtered: boolean;
  installedPath?: string;
}

/** Loaded pi resource row for Resources view. */
export interface ResourceSummary {
  kind: "extension" | "skill" | "prompt" | "theme" | "context";
  name: string;
  path: string;
  source?: string;
}

/** Composer chrome: current git branch / worktree summary. */
export interface GitContextInfo {
  branch?: string;
  /** Display label (e.g. 本地 / worktree folder name). */
  worktree?: string;
  /** True when cwd is the primary worktree (`.git` is a directory). */
  isMainWorktree?: boolean;
  /** Absolute path of the primary worktree root when known. */
  mainWorktreePath?: string;
  /** Absolute path of the current worktree root. */
  worktreePath?: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  /** True when name is a remote-tracking ref (e.g. origin/main). */
  remote?: boolean;
}

export interface GitWorktreeInfo {
  path: string;
  branch?: string;
  bare?: boolean;
  /** Primary worktree for the repository. */
  main?: boolean;
}

/** Visual projection of pi global settings.json (safe fields only). */
export interface PiSettingsView {
  agentDir: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  defaultProjectTrust: "ask" | "always" | "never";
  theme?: string;
  compactionEnabled: boolean;
  retryEnabled: boolean;
  hideThinkingBlock: boolean;
  quietStartup: boolean;
  enableSkillCommands: boolean;
  availableThinkingLevels: string[];
}

/** Partial update for pi global settings (writes settings.json via SettingsManager). */
export type PiSettingsPatch = Partial<{
  defaultProvider: string;
  defaultModel: string;
  defaultThinkingLevel: string;
  defaultProjectTrust: "ask" | "always" | "never";
  theme: string;
  compactionEnabled: boolean;
  retryEnabled: boolean;
  hideThinkingBlock: boolean;
  quietStartup: boolean;
  enableSkillCommands: boolean;
}>;

export type HostCommand =
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.start";
      requestId: string;
      cwd: string;
      agentDir?: string;
      model?: { provider: string; id: string };
      tools?: string[];
      persistSession?: boolean;
      sessionFile?: string;
      /** Open most recent session for cwd when no sessionFile is given. */
      resumeRecent?: boolean;
      projectTrusted?: boolean;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "agent.prompt";
      requestId: string;
      message: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "session.list";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "session.new";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "session.switch";
      requestId: string;
      sessionPath: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "session.fork";
      requestId: string;
      /** When omitted, Host forks from the latest user message entry. */
      entryId?: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "trust.get";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "trust.set";
      requestId: string;
      trusted: boolean;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "model.list";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "model.set";
      requestId: string;
      provider: string;
      id: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "thinking.set";
      requestId: string;
      level: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "providers.list";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "providers.setApiKey";
      requestId: string;
      provider: string;
      apiKey: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "providers.clearAuth";
      requestId: string;
      provider: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "settings.get";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "settings.patch";
      requestId: string;
      patch: PiSettingsPatch;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.list";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.install";
      requestId: string;
      source: string;
      scope: "global" | "project";
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.remove";
      requestId: string;
      source: string;
      scope: "global" | "project";
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.update";
      requestId: string;
      source?: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "resources.list";
      requestId: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "m0.p07Probe";
      requestId: string;
      imagePath: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "extensionUi.respond";
      requestId: string;
      runtimeId: string;
      response: ExtensionUiResponse;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.snapshot" | "host.shutdown" | "agent.abort" | "m0.sequenceGap";
      requestId: string;
    };

export type HostEvent =
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.hello";
      hostPid: number;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.ready" | "runtime.snapshot";
      requestId?: string;
      snapshot: HostSnapshot;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "runtime.event";
      runtimeId: string;
      sequence: number;
      event: RuntimeEvent;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "extensionUi.request";
      runtimeId: string;
      requestId: string;
      method: ExtensionUiMethod;
      args: unknown;
      timeoutMs?: number;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "m0.p07Result";
      requestId: string;
      result: P07ProbeResult;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.crashed";
      hostId: string;
      runtimeId?: string;
      exitCode: number;
      message: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.restarted";
      hostId: string;
      previousRuntimeId: string;
      snapshot: HostSnapshot;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.stopped";
      requestId?: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "host.error";
      requestId?: string;
      code: string;
      message: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "session.list";
      requestId?: string;
      threads: SessionThreadSummary[];
      activeSessionId?: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "session.opened";
      requestId?: string;
      snapshot: HostSnapshot;
      threads: SessionThreadSummary[];
      history: SessionHistoryMessage[];
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.list";
      requestId?: string;
      packages: PackageSummary[];
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.changed";
      requestId?: string;
      packages: PackageSummary[];
      action: "install" | "remove" | "update";
      source?: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "packages.progress";
      requestId?: string;
      action: string;
      source: string;
      phase: "start" | "progress" | "complete" | "error";
      message?: string;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "resources.list";
      requestId?: string;
      resources: ResourceSummary[];
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "trust.info";
      requestId?: string;
      trust: ProjectTrustSummary;
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "model.list";
      requestId?: string;
      models: ModelSummary[];
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "providers.list";
      requestId?: string;
      providers: ProviderAuthSummary[];
    }
  | {
      protocolVersion: typeof IPC_PROTOCOL_VERSION;
      type: "settings.view";
      requestId?: string;
      settings: PiSettingsView;
    };

export interface PixDesktopApi {
  host: {
    start(options?: {
      cwd?: string;
      sessionFile?: string;
      resumeRecent?: boolean;
    }): Promise<HostSnapshot>;
    stop(): Promise<void>;
    snapshot(): Promise<HostSnapshot>;
    onEvent(listener: (event: HostEvent) => void): () => void;
  };
  workspace: {
    getCwd(): Promise<string | undefined>;
    listRecent(): Promise<string[]>;
    openPath(cwd: string, options?: { resumeRecent?: boolean }): Promise<HostSnapshot>;
    pickFolder(): Promise<string | undefined>;
    /** Remove a path from desktop recent list (does not delete files). */
    removeRecent(cwd: string): Promise<string[]>;
    /** Reveal path in Finder / Explorer. */
    revealInFolder(cwd: string): Promise<void>;
    /**
     * Detach from the active project (stop host, clear cwd).
     * Does not remove recent list. Next start requires an explicit openPath/cwd.
     */
    clearActive(): Promise<void>;
    /** Lightweight git branch / worktree labels for the composer chrome. */
    getGitContext(cwd?: string): Promise<GitContextInfo>;
    /** Local + remote branches (local first). */
    listGitBranches(cwd?: string): Promise<GitBranchInfo[]>;
    /** Checkout an existing branch in cwd. */
    checkoutGitBranch(branch: string, cwd?: string): Promise<GitContextInfo>;
    /** Create a branch and optionally check it out (default true). */
    createGitBranch(
      branch: string,
      options?: { checkout?: boolean; cwd?: string },
    ): Promise<GitContextInfo>;
    /** List worktrees for the repo containing cwd. */
    listGitWorktrees(cwd?: string): Promise<GitWorktreeInfo[]>;
    /**
     * Create a linked worktree at `path`.
     * - `newBranch`: create and check out a new branch in the worktree
     * - `branch`: check out an existing branch in the worktree
     */
    createGitWorktree(options: {
      path: string;
      branch?: string;
      newBranch?: string;
      cwd?: string;
    }): Promise<{ path: string; context: GitContextInfo }>;
  };
  trust: {
    get(): Promise<ProjectTrustSummary>;
    set(trusted: boolean): Promise<HostSnapshot>;
  };
  models: {
    list(): Promise<ModelSummary[]>;
    set(provider: string, id: string): Promise<HostSnapshot>;
  };
  thinking: {
    set(level: string): Promise<HostSnapshot>;
  };
  providers: {
    list(): Promise<ProviderAuthSummary[]>;
    /** Stores API key via pi ModelRuntime; never returned by list(). */
    setApiKey(provider: string, apiKey: string): Promise<ProviderAuthSummary[]>;
    clearAuth(provider: string): Promise<ProviderAuthSummary[]>;
  };
  /** Visual editor for pi settings.json (global). */
  settings: {
    get(): Promise<PiSettingsView>;
    patch(patch: PiSettingsPatch): Promise<PiSettingsView>;
  };
  agent: {
    prompt(message: string): Promise<HostSnapshot>;
    abort(): Promise<HostSnapshot>;
  };
  session: {
    list(): Promise<{ threads: SessionThreadSummary[]; activeSessionId?: string }>;
    /** List sessions for any project cwd without switching the live host runtime. */
    listForCwd(cwd: string): Promise<SessionThreadSummary[]>;
    create(): Promise<{
      snapshot: HostSnapshot;
      threads: SessionThreadSummary[];
      history: SessionHistoryMessage[];
    }>;
    switch(sessionPath: string): Promise<{
      snapshot: HostSnapshot;
      threads: SessionThreadSummary[];
      history: SessionHistoryMessage[];
    }>;
    fork(entryId?: string): Promise<{
      snapshot: HostSnapshot;
      threads: SessionThreadSummary[];
      history: SessionHistoryMessage[];
    }>;
  };
  packages: {
    list(): Promise<PackageSummary[]>;
    install(source: string, scope: "global" | "project"): Promise<PackageSummary[]>;
    remove(source: string, scope: "global" | "project"): Promise<PackageSummary[]>;
    update(source?: string): Promise<PackageSummary[]>;
  };
  resources: {
    list(): Promise<ResourceSummary[]>;
  };
  extensionUi: {
    respond(response: ExtensionUiResponse): Promise<void>;
  };
  m0: {
    crashHost(): Promise<void>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.protocolVersion === IPC_PROTOCOL_VERSION &&
    typeof value.type === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isModelSelector(value: unknown): boolean {
  return isRecord(value) && typeof value.provider === "string" && typeof value.id === "string";
}

function isExtensionUiMethod(value: unknown): value is ExtensionUiMethod {
  return (
    typeof value === "string" &&
    [
      "select",
      "confirm",
      "input",
      "editor",
      "notify",
      "setStatus",
      "setWorkingMessage",
      "setWorkingVisible",
      "setWorkingIndicator",
      "setHiddenThinkingLabel",
      "setWidget",
      "setTitle",
      "setEditorText",
      "unsupported",
    ].includes(value)
  );
}

function isResourceCounts(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["extensions", "skills", "prompts", "themes", "contextFiles"].every(
    (key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0,
  );
}

function isProjectTrustSummary(value: unknown): value is ProjectTrustSummary {
  return (
    isRecord(value) &&
    typeof value.required === "boolean" &&
    typeof value.trusted === "boolean" &&
    (value.savedDecision === null || typeof value.savedDecision === "boolean") &&
    (value.fallback === "ask" || value.fallback === "always" || value.fallback === "never")
  );
}

function isModelSummary(value: unknown): value is ModelSummary {
  return (
    isRecord(value) &&
    typeof value.provider === "string" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.reasoning === "boolean" &&
    (value.source === "builtin" || value.source === "custom")
  );
}

function isProviderAuthSummary(value: unknown): value is ProviderAuthSummary {
  if (!isRecord(value)) return false;
  if (typeof value.provider !== "string" || typeof value.displayName !== "string") return false;
  if (typeof value.configured !== "boolean" || typeof value.modelCount !== "number") return false;
  if (typeof value.oauthAvailable !== "boolean") return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;
  if (value.source !== undefined) {
    if (typeof value.source !== "string") return false;
    if (
      ![
        "stored",
        "runtime",
        "environment",
        "fallback",
        "models_json_key",
        "models_json_command",
      ].includes(value.source)
    ) {
      return false;
    }
  }
  // Reject accidental secret leakage in projection
  if ("key" in value || "apiKey" in value || "token" in value) return false;
  return true;
}

function isSessionUsageSummary(value: unknown): value is SessionUsageSummary {
  if (!isRecord(value) || !isRecord(value.tokens) || typeof value.cost !== "number") return false;
  const tokens = value.tokens;
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    if (typeof tokens[key] !== "number") return false;
  }
  if (value.context !== undefined) {
    if (!isRecord(value.context) || typeof value.context.contextWindow !== "number") return false;
    if (value.context.tokens !== null && typeof value.context.tokens !== "number") return false;
    if (value.context.percent !== null && typeof value.context.percent !== "number") return false;
  }
  return true;
}

function isHostSnapshot(value: unknown): value is HostSnapshot {
  if (!isRecord(value) || !isRecord(value.configuredPackages)) return false;
  return (
    typeof value.runtimeId === "string" &&
    typeof value.sequence === "number" &&
    typeof value.cwd === "string" &&
    typeof value.agentDir === "string" &&
    typeof value.sessionId === "string" &&
    (value.sessionFile === undefined || typeof value.sessionFile === "string") &&
    (value.model === undefined || isModelSelector(value.model)) &&
    (value.thinkingLevel === undefined || typeof value.thinkingLevel === "string") &&
    (value.availableThinkingLevels === undefined || isStringArray(value.availableThinkingLevels)) &&
    (value.usage === undefined || isSessionUsageSummary(value.usage)) &&
    isStringArray(value.activeTools) &&
    typeof value.projectTrusted === "boolean" &&
    (value.trust === undefined || isProjectTrustSummary(value.trust)) &&
    isResourceCounts(value.resources) &&
    typeof value.configuredPackages.global === "number" &&
    typeof value.configuredPackages.project === "number" &&
    Array.isArray(value.diagnostics)
  );
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "agent.started":
    case "agent.settled":
      return true;
    case "message.delta":
      return typeof value.delta === "string";
    case "message.completed":
      return value.reason === "stop" || value.reason === "length" || value.reason === "toolUse";
    case "message.failed":
      return (
        (value.reason === "aborted" || value.reason === "error") &&
        typeof value.message === "string"
      );
    case "tool.started":
      return typeof value.toolCallId === "string" && typeof value.toolName === "string";
    case "tool.completed":
      return (
        typeof value.toolCallId === "string" &&
        typeof value.toolName === "string" &&
        typeof value.output === "string" &&
        typeof value.isError === "boolean"
      );
    case "custom.message":
      return typeof value.customType === "string" && typeof value.content === "string";
    case "custom.entry":
      return typeof value.customType === "string";
    default:
      return false;
  }
}

export function isHostCommand(value: unknown): value is HostCommand {
  if (!hasEnvelope(value) || typeof value.requestId !== "string") return false;

  if (value.type === "host.start") {
    return (
      typeof value.cwd === "string" &&
      (value.agentDir === undefined || typeof value.agentDir === "string") &&
      (value.model === undefined || isModelSelector(value.model)) &&
      (value.tools === undefined || isStringArray(value.tools)) &&
      (value.persistSession === undefined || typeof value.persistSession === "boolean") &&
      (value.sessionFile === undefined || typeof value.sessionFile === "string") &&
      (value.resumeRecent === undefined || typeof value.resumeRecent === "boolean") &&
      (value.projectTrusted === undefined || typeof value.projectTrusted === "boolean")
    );
  }
  if (value.type === "agent.prompt") return typeof value.message === "string";
  if (value.type === "session.list" || value.type === "session.new") return true;
  if (value.type === "session.switch") return typeof value.sessionPath === "string";
  if (value.type === "session.fork") {
    return value.entryId === undefined || typeof value.entryId === "string";
  }
  if (value.type === "trust.get" || value.type === "model.list") return true;
  if (value.type === "trust.set") return typeof value.trusted === "boolean";
  if (value.type === "model.set") {
    return typeof value.provider === "string" && typeof value.id === "string";
  }
  if (value.type === "thinking.set") return typeof value.level === "string";
  if (value.type === "providers.list") return true;
  if (value.type === "providers.setApiKey") {
    return typeof value.provider === "string" && typeof value.apiKey === "string";
  }
  if (value.type === "providers.clearAuth") return typeof value.provider === "string";
  if (value.type === "settings.get") return true;
  if (value.type === "settings.patch") {
    return isRecord(value.patch);
  }
  if (value.type === "packages.list" || value.type === "resources.list") return true;
  if (value.type === "packages.install" || value.type === "packages.remove") {
    return (
      typeof value.source === "string" && (value.scope === "global" || value.scope === "project")
    );
  }
  if (value.type === "packages.update") {
    return value.source === undefined || typeof value.source === "string";
  }
  if (value.type === "m0.p07Probe") return typeof value.imagePath === "string";
  if (value.type === "extensionUi.respond") {
    return (
      typeof value.runtimeId === "string" &&
      isRecord(value.response) &&
      typeof value.response.runtimeId === "string" &&
      typeof value.response.requestId === "string" &&
      typeof value.response.ok === "boolean" &&
      (value.response.error === undefined || typeof value.response.error === "string")
    );
  }

  return (
    value.type === "host.snapshot" ||
    value.type === "host.shutdown" ||
    value.type === "agent.abort" ||
    value.type === "m0.sequenceGap"
  );
}

function isSessionThreadSummary(value: unknown): value is SessionThreadSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.cwd === "string" &&
    typeof value.title === "string" &&
    typeof value.modifiedAt === "string" &&
    typeof value.messageCount === "number" &&
    typeof value.active === "boolean"
  );
}

function isSessionHistoryMessage(value: unknown): value is SessionHistoryMessage {
  if (!isRecord(value) || typeof value.text !== "string") return false;
  if (!["user", "assistant", "tool", "system"].includes(String(value.role))) return false;
  if (value.toolName !== undefined && typeof value.toolName !== "string") return false;
  if (value.isError !== undefined && typeof value.isError !== "boolean") return false;
  if (value.entryId !== undefined && typeof value.entryId !== "string") return false;
  return true;
}

function isPackageSummary(value: unknown): value is PackageSummary {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    (value.scope === "global" || value.scope === "project") &&
    (value.kind === "npm" ||
      value.kind === "git" ||
      value.kind === "local" ||
      value.kind === "unknown") &&
    typeof value.filtered === "boolean" &&
    (value.installedPath === undefined || typeof value.installedPath === "string")
  );
}

function isResourceSummary(value: unknown): value is ResourceSummary {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.path === "string" &&
    ["extension", "skill", "prompt", "theme", "context"].includes(String(value.kind)) &&
    (value.source === undefined || typeof value.source === "string")
  );
}

export function isHostEvent(value: unknown): value is HostEvent {
  if (!hasEnvelope(value)) return false;

  switch (value.type) {
    case "host.hello":
      return typeof value.hostPid === "number";
    case "host.ready":
    case "runtime.snapshot":
      return isHostSnapshot(value.snapshot);
    case "runtime.event":
      return (
        typeof value.runtimeId === "string" &&
        typeof value.sequence === "number" &&
        isRuntimeEvent(value.event)
      );
    case "extensionUi.request":
      return (
        typeof value.runtimeId === "string" &&
        typeof value.requestId === "string" &&
        isExtensionUiMethod(value.method) &&
        value.args !== undefined &&
        (value.timeoutMs === undefined || typeof value.timeoutMs === "number")
      );
    case "m0.p07Result":
      return (
        typeof value.requestId === "string" &&
        isRecord(value.result) &&
        typeof value.result.extensions === "number" &&
        typeof value.result.extensionDiagnostics === "number" &&
        isRecord(value.result.input) &&
        typeof value.result.input.width === "number" &&
        typeof value.result.input.height === "number" &&
        isRecord(value.result.output) &&
        typeof value.result.output.width === "number" &&
        typeof value.result.output.height === "number" &&
        typeof value.result.output.bytes === "number"
      );
    case "host.crashed":
      return (
        typeof value.hostId === "string" &&
        (value.runtimeId === undefined || typeof value.runtimeId === "string") &&
        typeof value.exitCode === "number" &&
        typeof value.message === "string"
      );
    case "host.restarted":
      return (
        typeof value.hostId === "string" &&
        typeof value.previousRuntimeId === "string" &&
        isHostSnapshot(value.snapshot)
      );
    case "host.stopped":
      return value.requestId === undefined || typeof value.requestId === "string";
    case "host.error":
      return typeof value.code === "string" && typeof value.message === "string";
    case "session.list":
      return (
        Array.isArray(value.threads) &&
        value.threads.every(isSessionThreadSummary) &&
        (value.activeSessionId === undefined || typeof value.activeSessionId === "string")
      );
    case "session.opened":
      return (
        isHostSnapshot(value.snapshot) &&
        Array.isArray(value.threads) &&
        value.threads.every(isSessionThreadSummary) &&
        Array.isArray(value.history) &&
        value.history.every(isSessionHistoryMessage)
      );
    case "packages.list":
      return Array.isArray(value.packages) && value.packages.every(isPackageSummary);
    case "packages.changed":
      return (
        Array.isArray(value.packages) &&
        value.packages.every(isPackageSummary) &&
        (value.action === "install" || value.action === "remove" || value.action === "update") &&
        (value.source === undefined || typeof value.source === "string")
      );
    case "packages.progress":
      return (
        typeof value.action === "string" &&
        typeof value.source === "string" &&
        (value.phase === "start" ||
          value.phase === "progress" ||
          value.phase === "complete" ||
          value.phase === "error") &&
        (value.message === undefined || typeof value.message === "string")
      );
    case "resources.list":
      return Array.isArray(value.resources) && value.resources.every(isResourceSummary);
    case "trust.info":
      return isProjectTrustSummary(value.trust);
    case "model.list":
      return Array.isArray(value.models) && value.models.every(isModelSummary);
    case "providers.list":
      return Array.isArray(value.providers) && value.providers.every(isProviderAuthSummary);
    case "settings.view":
      return isPiSettingsView(value.settings);
    default:
      return false;
  }
}

function isPiSettingsView(value: unknown): value is PiSettingsView {
  if (!isRecord(value) || typeof value.agentDir !== "string") return false;
  if (
    value.defaultProjectTrust !== "ask" &&
    value.defaultProjectTrust !== "always" &&
    value.defaultProjectTrust !== "never"
  ) {
    return false;
  }
  return (
    typeof value.compactionEnabled === "boolean" &&
    typeof value.retryEnabled === "boolean" &&
    typeof value.hideThinkingBlock === "boolean" &&
    typeof value.quietStartup === "boolean" &&
    typeof value.enableSkillCommands === "boolean" &&
    Array.isArray(value.availableThinkingLevels) &&
    value.availableThinkingLevels.every((item) => typeof item === "string") &&
    (value.defaultProvider === undefined || typeof value.defaultProvider === "string") &&
    (value.defaultModel === undefined || typeof value.defaultModel === "string") &&
    (value.defaultThinkingLevel === undefined || typeof value.defaultThinkingLevel === "string") &&
    (value.theme === undefined || typeof value.theme === "string")
  );
}
