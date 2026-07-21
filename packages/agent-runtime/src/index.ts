import {
  type AgentSessionRuntime,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionError,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultPackageManager,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionUiResponse,
  HostSnapshot,
  ModelSummary,
  PackageSummary,
  PiSettingsPatch,
  PiSettingsView,
  ProjectTrustSummary,
  ProviderAuthSummary,
  ResourceSummary,
  SessionHistoryMessage,
  SessionThreadSummary,
} from "@pix/contracts";
import { basename } from "node:path";
import {
  createPortableExtensionUiBridge,
  type ExtensionUiRequestEvent,
} from "./extension-ui-bridge.ts";
import { resolvePixSessionDir } from "./session-dir.ts";

export { createPortableExtensionUiBridge } from "./extension-ui-bridge.ts";
export {
  projectCustomEntry,
  projectCustomMessage,
  projectToolPresentation,
  sanitizeSerializable,
} from "./generic-renderers.ts";
export {
  PIX_SESSION_DIR_ENV,
  resolvePixSessionDir,
  type ResolvedPixSessionDir,
  type ResolvePixSessionDirOptions,
  type SessionDirSource,
} from "./session-dir.ts";
import { randomUUID } from "node:crypto";

export interface CreatePixRuntimeOptions {
  cwd: string;
  /**
   * Defaults to pi `getAgentDir()` (`~/.pi/agent` or `PI_CODING_AGENT_DIR`).
   * Product path must omit this so the desktop shell shares CLI models/auth/settings.
   */
  agentDir?: string;
  /**
   * Optional model override. When omitted, uses pi registry default (same as CLI).
   */
  model?: {
    provider: string;
    id: string;
  };
  /**
   * Optional tool allow-list. When omitted, uses pi CLI defaults
   * (`read`, `bash`, `edit`, `write`, plus extensions/settings).
   * Smoke/e2e may pass a restricted list (e.g. `["read"]`).
   */
  tools?: string[];
  /**
   * Restrict tools the way CLI `--no-tools` does. Prefer omitting for product.
   */
  noTools?: "all" | "builtin";
  persistSession?: boolean;
  sessionFile?: string;
  /** Prefer continueRecent(cwd) when true and no sessionFile is set. */
  resumeRecent?: boolean;
  /**
   * Explicit session directory override (test/CLI only).
   * Product normal path must omit this so env/settings/default precedence applies.
   */
  sessionDir?: string;
  projectTrusted?: boolean;
  onExtensionUiRequest?: (request: ExtensionUiRequestEvent) => void;
}

export interface PixRuntimeHandle {
  readonly runtimeId: string;
  readonly runtime: AgentSessionRuntime;
  readonly sessionDirSource: ReturnType<typeof resolvePixSessionDir>["source"];
  snapshot(sequence?: number): HostSnapshot;
  respondExtensionUi(response: ExtensionUiResponse): boolean;
  /** Reload resources/extensions; cancels pending UI and clears portable state first. */
  reload(): Promise<void>;
  listSessions(): Promise<SessionThreadSummary[]>;
  historyMessages(): SessionHistoryMessage[];
  listPackages(): PackageSummary[];
  listResources(): ResourceSummary[];
  installPackage(
    source: string,
    scope: "global" | "project",
    onProgress?: (event: {
      action: string;
      source: string;
      phase: "start" | "progress" | "complete" | "error";
      message?: string;
    }) => void,
  ): Promise<PackageSummary[]>;
  removePackage(
    source: string,
    scope: "global" | "project",
    onProgress?: (event: {
      action: string;
      source: string;
      phase: "start" | "progress" | "complete" | "error";
      message?: string;
    }) => void,
  ): Promise<PackageSummary[]>;
  updatePackage(
    source?: string,
    onProgress?: (event: {
      action: string;
      source: string;
      phase: "start" | "progress" | "complete" | "error";
      message?: string;
    }) => void,
  ): Promise<PackageSummary[]>;
  /** Session replacement helpers that re-bind portable Extension UI after pi rebuilds the session. */
  newSession(
    options?: Parameters<AgentSessionRuntime["newSession"]>[0],
  ): Promise<Awaited<ReturnType<AgentSessionRuntime["newSession"]>>>;
  switchSession(
    sessionPath: string,
    options?: Parameters<AgentSessionRuntime["switchSession"]>[1],
  ): Promise<Awaited<ReturnType<AgentSessionRuntime["switchSession"]>>>;
  fork(
    entryId: string,
    options?: Parameters<AgentSessionRuntime["fork"]>[1],
  ): Promise<Awaited<ReturnType<AgentSessionRuntime["fork"]>>>;
  getTrust(): ProjectTrustSummary;
  setTrust(trusted: boolean): Promise<HostSnapshot>;
  listModels(): ModelSummary[];
  setModel(provider: string, id: string): Promise<HostSnapshot>;
  setThinkingLevel(level: string): HostSnapshot;
  listProviders(): ProviderAuthSummary[];
  setProviderApiKey(provider: string, apiKey: string): Promise<ProviderAuthSummary[]>;
  clearProviderAuth(provider: string): Promise<ProviderAuthSummary[]>;
  getPiSettings(): PiSettingsView;
  patchPiSettings(patch: PiSettingsPatch): PiSettingsView;
  /** One-shot completion that does not write into the session transcript. */
  completeText(
    prompt: string,
    options?: { systemPrompt?: string; model?: { provider: string; id: string } },
  ): Promise<string>;
  dispose(): Promise<void>;
}

export interface PixProjectTrust {
  required: boolean;
  trusted: boolean;
  savedDecision: boolean | null;
  fallback: "ask" | "always" | "never";
}

export type SnapshotDiagnostic = HostSnapshot["diagnostics"][number];

export function resolvePixProjectTrust(cwd: string, agentDir = getAgentDir()): PixProjectTrust {
  const required = hasTrustRequiringProjectResources(cwd);
  const savedDecision = new ProjectTrustStore(agentDir).get(cwd);
  const globalSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const fallback = globalSettings.getDefaultProjectTrust();
  return {
    required,
    savedDecision,
    fallback,
    trusted:
      !required || savedDecision === true || (savedDecision === null && fallback === "always"),
  };
}

function countPackages(settings: { packages?: unknown[] }): number {
  return Array.isArray(settings.packages) ? packagesLength(settings.packages) : 0;
}

function packagesLength(packages: unknown[]): number {
  return packages.length;
}

function redactDiagnosticMessage(message: string): string {
  return message
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .replace(
      /(["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*)(["']?)[^,"'\s]+/gi,
      "$1$2[redacted]",
    );
}

function collectConfigDiagnostics(services: AgentSessionServices): SnapshotDiagnostic[] {
  const diagnostics: SnapshotDiagnostic[] = [];

  for (const entry of services.settingsManager.drainErrors()) {
    diagnostics.push({
      type: "error",
      message: redactDiagnosticMessage(
        `Settings ${entry.scope} failed to load: ${entry.error.message}`,
      ),
    });
  }

  // pi 0.80.10+: auth/models load issues surface on ModelRuntime + services.diagnostics
  // (AuthStorage no longer exposes drainErrors on AgentSessionServices).
  for (const entry of services.diagnostics) {
    if (entry.type === "info") continue;
    diagnostics.push({
      type: entry.type === "warning" ? "warning" : "error",
      message: redactDiagnosticMessage(entry.message),
    });
  }

  const modelError = services.modelRuntime.getError();
  if (modelError) {
    diagnostics.push({
      type: "error",
      message: redactDiagnosticMessage(`Models failed to load: ${modelError}`),
    });
  }

  return diagnostics;
}

function formatExtensionError(error: ExtensionError): SnapshotDiagnostic {
  return {
    type: "error",
    message: redactDiagnosticMessage(
      `Extension ${basename(error.extensionPath)} error on ${error.event}: ${error.error}`,
    ),
  };
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function projectSessionHistory(
  messages: readonly unknown[],
  entryIds?: readonly (string | undefined)[],
): SessionHistoryMessage[] {
  const history: SessionHistoryMessage[] = [];
  let index = 0;
  for (const message of messages) {
    const entryId = entryIds?.[index];
    index += 1;
    if (!message || typeof message !== "object") continue;
    const row = message as {
      role?: string;
      content?: unknown;
      toolName?: string;
      isError?: boolean;
      customType?: string;
    };
    if (row.role === "user") {
      const text = textFromMessageContent(row.content).trim();
      if (text) {
        const item: SessionHistoryMessage = { role: "user", text };
        if (entryId) item.entryId = entryId;
        history.push(item);
      }
    } else if (row.role === "assistant") {
      const text = textFromMessageContent(row.content).trim();
      if (text) {
        const item: SessionHistoryMessage = { role: "assistant", text };
        if (entryId) item.entryId = entryId;
        history.push(item);
      }
    } else if (row.role === "toolResult") {
      const item: SessionHistoryMessage = {
        role: "tool",
        text: textFromMessageContent(row.content).trim() || "Tool result",
        toolName: typeof row.toolName === "string" ? row.toolName : "tool",
        isError: row.isError === true,
      };
      if (entryId) item.entryId = entryId;
      history.push(item);
    } else if (row.role === "custom") {
      const text = textFromMessageContent(row.content).trim();
      const item: SessionHistoryMessage = {
        role: "system",
        text: text ? `[${row.customType ?? "custom"}] ${text}` : `[${row.customType ?? "custom"}]`,
      };
      if (entryId) item.entryId = entryId;
      history.push(item);
    }
  }
  return history;
}

/** Build history from session tree entries so fork targets keep entry ids. */
export function projectHistoryFromSessionManager(sessionManager: {
  getEntries(): Array<{
    type: string;
    id: string;
    message?: {
      role?: string;
      content?: unknown;
      toolName?: string;
      isError?: boolean;
      customType?: string;
    };
  }>;
}): SessionHistoryMessage[] {
  const entries = sessionManager.getEntries().filter((entry) => entry.type === "message");
  return projectSessionHistory(
    entries.map((entry) => entry.message),
    entries.map((entry) => entry.id),
  );
}

function threadTitleFromSession(info: { name?: string; firstMessage: string; id: string }): string {
  if (info.name?.trim()) return info.name.trim();
  const first = info.firstMessage.trim().split(/\r?\n/)[0]?.trim();
  if (first) return first.length > 72 ? `${first.slice(0, 71)}…` : first;
  return `Thread ${info.id.slice(0, 8)}`;
}

/**
 * List pi sessions for any project cwd without switching the live runtime.
 * Used by the sidebar to show conversations under every expanded project.
 */
export async function listProjectSessions(
  cwd: string,
  options?: { agentDir?: string; activeSessionId?: string },
): Promise<SessionThreadSummary[]> {
  const resolved = resolvePixSessionDir({
    cwd,
    agentDir: options?.agentDir ?? getAgentDir(),
  });
  const listed = await SessionManager.list(cwd, resolved.sessionDir);
  return listed
    .map((item) => ({
      id: item.id,
      path: item.path,
      cwd: item.cwd,
      title: threadTitleFromSession(item),
      modifiedAt: item.modified.toISOString(),
      messageCount: item.messageCount,
      active: options?.activeSessionId ? item.id === options.activeSessionId : false,
    }))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export function packageKindFromSource(source: string): PackageSummary["kind"] {
  if (
    source.startsWith("git+") ||
    source.startsWith("git:") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://") ||
    source.includes("github.com:")
  ) {
    return "git";
  }
  if (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("file:") ||
    source.startsWith("~")
  ) {
    return "local";
  }
  if (source.startsWith("npm:") || source.includes("@") || /^[\w.-]+(\/[\w.-]+)?$/.test(source)) {
    return "npm";
  }
  return "unknown";
}

type PackageProgress = {
  action: string;
  source: string;
  phase: "start" | "progress" | "complete" | "error";
  message?: string;
};

function createPackageManager(services: AgentSessionServices): DefaultPackageManager {
  return new DefaultPackageManager({
    cwd: services.cwd,
    agentDir: services.agentDir,
    settingsManager: services.settingsManager,
  });
}

function bindPackageProgress(
  manager: DefaultPackageManager,
  onProgress?: (event: PackageProgress) => void,
): void {
  if (!onProgress) {
    manager.setProgressCallback(undefined);
    return;
  }
  manager.setProgressCallback((event) => {
    const phase =
      event.type === "start" ||
      event.type === "progress" ||
      event.type === "complete" ||
      event.type === "error"
        ? event.type
        : "progress";
    const payload: PackageProgress = {
      action: event.action,
      source: event.source,
      phase,
    };
    if (event.message) payload.message = event.message;
    onProgress(payload);
  });
}

export function listPackagesFromServices(services: AgentSessionServices): PackageSummary[] {
  const manager = createPackageManager(services);
  return manager.listConfiguredPackages().map((entry) => {
    const summary: PackageSummary = {
      source: entry.source,
      scope: entry.scope === "project" ? "project" : "global",
      kind: packageKindFromSource(entry.source),
      filtered: entry.filtered,
    };
    if (entry.installedPath) summary.installedPath = entry.installedPath;
    return summary;
  });
}

async function reloadResourcesAfterPackageChange(services: AgentSessionServices): Promise<void> {
  await services.resourceLoader.reload();
}

export function listResourcesFromServices(services: AgentSessionServices): ResourceSummary[] {
  const loader = services.resourceLoader;
  const resources: ResourceSummary[] = [];

  for (const extension of loader.getExtensions().extensions) {
    const row: ResourceSummary = {
      kind: "extension",
      name: basename(extension.path),
      path: extension.path,
    };
    if (extension.sourceInfo?.source) row.source = extension.sourceInfo.source;
    resources.push(row);
  }
  for (const skill of loader.getSkills().skills) {
    const row: ResourceSummary = {
      kind: "skill",
      name: skill.name,
      path: skill.filePath,
    };
    if (skill.sourceInfo?.source) row.source = skill.sourceInfo.source;
    resources.push(row);
  }
  for (const prompt of loader.getPrompts().prompts) {
    const row: ResourceSummary = {
      kind: "prompt",
      name: prompt.name,
      path: prompt.filePath,
    };
    if (prompt.sourceInfo?.source) row.source = prompt.sourceInfo.source;
    resources.push(row);
  }
  for (const theme of loader.getThemes().themes) {
    const themeRecord = theme as { name?: string; path?: string | undefined };
    resources.push({
      kind: "theme",
      name: themeRecord.name ?? "theme",
      path: themeRecord.path ?? "",
    });
  }
  for (const file of loader.getAgentsFiles().agentsFiles) {
    resources.push({
      kind: "context",
      name: basename(file.path),
      path: file.path,
    });
  }
  return resources;
}

function createSnapshot(
  runtimeId: string,
  runtime: AgentSessionRuntime,
  services: AgentSessionServices,
  sequence: number,
  extensionErrors: ExtensionError[],
  configDiagnostics: SnapshotDiagnostic[],
): HostSnapshot {
  const extensions = services.resourceLoader.getExtensions();
  const skills = services.resourceLoader.getSkills();
  const prompts = services.resourceLoader.getPrompts();
  const themes = services.resourceLoader.getThemes();
  const context = services.resourceLoader.getAgentsFiles();
  const globalSettings = services.settingsManager.getGlobalSettings();
  const projectSettings = services.settingsManager.getProjectSettings();
  const model = runtime.session.model;

  const resourceDiagnostics = [
    ...extensions.errors.map(({ path, error }) => ({
      type: "error" as const,
      message: `Extension ${basename(path)} failed to load: ${error}`,
    })),
    ...skills.diagnostics,
    ...prompts.diagnostics,
    ...themes.diagnostics,
  ].map(({ type, message }) => ({
    type: type === "collision" ? ("warning" as const) : type,
    message: redactDiagnosticMessage(message),
  }));

  const snapshot: HostSnapshot = {
    runtimeId,
    sequence,
    cwd: services.cwd,
    agentDir: services.agentDir,
    sessionId: runtime.session.sessionId,
    activeTools: runtime.session.getActiveToolNames(),
    projectTrusted: services.settingsManager.isProjectTrusted(),
    resources: {
      extensions: extensions.extensions.length,
      skills: skills.skills.length,
      prompts: prompts.prompts.length,
      themes: themes.themes.length,
      contextFiles: context.agentsFiles.length,
    },
    configuredPackages: {
      global: countPackages(globalSettings),
      project: countPackages(projectSettings),
    },
    diagnostics: [
      ...services.diagnostics.map(({ type, message }) => ({
        type,
        message: redactDiagnosticMessage(message),
      })),
      ...resourceDiagnostics,
      ...configDiagnostics,
      ...extensionErrors.map(formatExtensionError),
    ],
  };

  if (runtime.session.sessionFile) snapshot.sessionFile = runtime.session.sessionFile;
  if (model) snapshot.model = { provider: model.provider, id: model.id };
  snapshot.thinkingLevel = String(runtime.session.thinkingLevel);
  snapshot.availableThinkingLevels = runtime.session
    .getAvailableThinkingLevels()
    .map((level) => String(level));
  snapshot.trust = resolvePixProjectTrust(services.cwd, services.agentDir);

  const stats = runtime.session.getSessionStats();
  const contextUsage = runtime.session.getContextUsage() ?? stats.contextUsage;
  const usage: NonNullable<HostSnapshot["usage"]> = {
    tokens: {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      total: stats.tokens.total,
    },
    cost: stats.cost,
  };
  if (contextUsage) {
    usage.context = {
      tokens: contextUsage.tokens,
      contextWindow: contextUsage.contextWindow,
      percent: contextUsage.percent,
    };
  }
  snapshot.usage = usage;

  return snapshot;
}

export async function createPixRuntime(
  options: CreatePixRuntimeOptions,
): Promise<PixRuntimeHandle> {
  const agentDir = options.agentDir ?? getAgentDir();
  const projectTrusted =
    options.projectTrusted ?? resolvePixProjectTrust(options.cwd, agentDir).trusted;
  const runtimeId = randomUUID();
  const extensionErrors: ExtensionError[] = [];
  const configDiagnostics: SnapshotDiagnostic[] = [];
  const extensionUi = createPortableExtensionUiBridge({
    runtimeId,
    onRequest: (request) => {
      try {
        options.onExtensionUiRequest?.(request);
      } catch (error) {
        const recorded: ExtensionError = {
          extensionPath: "extension-ui-bridge",
          event: `ui.${request.method}`,
          error: error instanceof Error ? error.message : String(error),
        };
        if (error instanceof Error && error.stack) recorded.stack = error.stack;
        extensionErrors.push(recorded);
      }
    },
  });

  const resolvedSessionDir = resolvePixSessionDir({
    cwd: options.cwd,
    agentDir,
    ...(options.sessionDir !== undefined ? { explicit: options.sessionDir } : {}),
  });

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const services = await createAgentSessionServices({ cwd, agentDir, settingsManager });
    // Keep only the latest service-layer config diagnostics for this session instance.
    configDiagnostics.length = 0;
    configDiagnostics.push(...collectConfigDiagnostics(services));

    const sessionOptions: CreateAgentSessionFromServicesOptions = {
      services,
      sessionManager,
    };
    // Explicit model (e.g. PIX_MODEL_* / host start override) wins.
    // Otherwise leave model unset so createAgentSession → findInitialModel uses
    // settingsManager defaultProvider/defaultModel (same as CLI). Never force
    // getModels()[0] — that ignored "set as default" for every new session.
    if (options.model) {
      const model = services.modelRuntime.getModel(options.model.provider, options.model.id);
      if (!model) {
        throw new Error(
          `pi did not provide the requested model: ${options.model.provider}/${options.model.id}`,
        );
      }
      sessionOptions.model = model;
    }
    // Product = visual pi: omit tools/noTools so SDK uses CLI defaults
    // (read/bash/edit/write + settings exclusions). Only pass restrictions when asked.
    if (options.tools) sessionOptions.tools = options.tools;
    else if (options.noTools) sessionOptions.noTools = options.noTools;
    if (sessionStartEvent) sessionOptions.sessionStartEvent = sessionStartEvent;

    return {
      ...(await createAgentSessionFromServices(sessionOptions)),
      services,
      diagnostics: services.diagnostics,
    };
  };

  let sessionManager: SessionManager;
  if (options.sessionFile) {
    sessionManager = SessionManager.open(
      options.sessionFile,
      resolvedSessionDir.sessionDir,
      options.cwd,
    );
  } else if (options.resumeRecent) {
    try {
      sessionManager = SessionManager.continueRecent(options.cwd, resolvedSessionDir.sessionDir);
    } catch {
      sessionManager = options.persistSession
        ? SessionManager.create(options.cwd, resolvedSessionDir.sessionDir)
        : SessionManager.inMemory(options.cwd);
    }
  } else if (options.persistSession) {
    sessionManager = SessionManager.create(options.cwd, resolvedSessionDir.sessionDir);
  } else {
    sessionManager = SessionManager.inMemory(options.cwd);
  }
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: options.cwd,
    agentDir,
    sessionManager,
  });

  async function bindExtensionUi(): Promise<void> {
    await runtime.session.bindExtensions({
      uiContext: extensionUi.uiContext,
      mode: "rpc",
      onError: (error) => {
        extensionErrors.push(error);
      },
    });
  }

  runtime.setBeforeSessionInvalidate(() => {
    extensionUi.reload();
  });

  await bindExtensionUi();

  async function afterSessionReplacement<T>(operation: () => Promise<T>): Promise<T> {
    extensionUi.reload();
    const result = await operation();
    await bindExtensionUi();
    return result;
  }

  return {
    runtimeId,
    runtime,
    sessionDirSource: resolvedSessionDir.source,
    snapshot: (sequence = 0) =>
      createSnapshot(
        runtimeId,
        runtime,
        runtime.services,
        sequence,
        extensionErrors,
        configDiagnostics,
      ),
    respondExtensionUi: (response) => extensionUi.respond(response),
    async reload() {
      extensionUi.reload();
      await runtime.session.reload({
        beforeSessionStart: () => {
          extensionUi.reload();
        },
      });
      // Replace config diagnostics after reload so repaired files clear old errors.
      configDiagnostics.length = 0;
      await runtime.services.modelRuntime.reloadConfig();
      configDiagnostics.push(...collectConfigDiagnostics(runtime.services));
    },
    async listSessions() {
      return listProjectSessions(runtime.services.cwd, {
        agentDir: runtime.services.agentDir,
        activeSessionId: runtime.session.sessionId,
      });
    },
    historyMessages() {
      return projectHistoryFromSessionManager(runtime.session.sessionManager);
    },
    listPackages() {
      return listPackagesFromServices(runtime.services);
    },
    listResources() {
      return listResourcesFromServices(runtime.services);
    },
    async installPackage(source, scope, onProgress) {
      const manager = createPackageManager(runtime.services);
      bindPackageProgress(manager, onProgress);
      try {
        await manager.installAndPersist(source, { local: scope === "project" });
        await reloadResourcesAfterPackageChange(runtime.services);
        return listPackagesFromServices(runtime.services);
      } finally {
        manager.setProgressCallback(undefined);
      }
    },
    async removePackage(source, scope, onProgress) {
      const manager = createPackageManager(runtime.services);
      bindPackageProgress(manager, onProgress);
      try {
        // pi matches local package identity via absolute path for input keys.
        // Prefer installedPath so relative settings sources still remove correctly.
        const configured = manager.listConfiguredPackages();
        const match = configured.find(
          (entry) =>
            entry.source === source ||
            entry.installedPath === source ||
            ((scope === "project" ? entry.scope === "project" : entry.scope === "user") &&
              (entry.source.endsWith(source) || source.endsWith(entry.source))),
        );
        const removeSource = match?.installedPath ?? match?.source ?? source;
        const removed = await manager.removeAndPersist(removeSource, {
          local: scope === "project",
        });
        if (!removed) {
          throw new Error(`Package was not removed from settings: ${source}`);
        }
        await reloadResourcesAfterPackageChange(runtime.services);
        return listPackagesFromServices(runtime.services);
      } finally {
        manager.setProgressCallback(undefined);
      }
    },
    async updatePackage(source, onProgress) {
      const manager = createPackageManager(runtime.services);
      bindPackageProgress(manager, onProgress);
      try {
        await manager.update(source);
        await reloadResourcesAfterPackageChange(runtime.services);
        return listPackagesFromServices(runtime.services);
      } finally {
        manager.setProgressCallback(undefined);
      }
    },
    newSession: (sessionOptions) =>
      afterSessionReplacement(() => runtime.newSession(sessionOptions)),
    switchSession: (sessionPath, sessionOptions) =>
      afterSessionReplacement(() => runtime.switchSession(sessionPath, sessionOptions)),
    fork: (entryId, sessionOptions) =>
      afterSessionReplacement(() => runtime.fork(entryId, sessionOptions)),
    getTrust() {
      return resolvePixProjectTrust(runtime.services.cwd, runtime.services.agentDir);
    },
    async setTrust(trusted) {
      new ProjectTrustStore(runtime.services.agentDir).set(
        runtime.services.cwd,
        trusted ? true : false,
      );
      runtime.services.settingsManager.setProjectTrusted(trusted);
      await runtime.session.reload({
        beforeSessionStart: () => {
          extensionUi.reload();
        },
      });
      return createSnapshot(
        runtimeId,
        runtime,
        runtime.services,
        0,
        extensionErrors,
        configDiagnostics,
      );
    },
    listModels() {
      return runtime.services.modelRuntime.getModels().map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name ?? model.id,
        reasoning: Boolean(model.reasoning),
        source: classifyModelSource(model.provider, runtime.services),
      }));
    },
    async setModel(provider, id) {
      const model = runtime.services.modelRuntime.getModel(provider, id);
      if (!model) throw new Error(`Unknown model ${provider}/${id}`);
      await runtime.session.setModel(model);
      return createSnapshot(
        runtimeId,
        runtime,
        runtime.services,
        0,
        extensionErrors,
        configDiagnostics,
      );
    },
    setThinkingLevel(level) {
      const available = runtime.session.getAvailableThinkingLevels().map((item) => String(item));
      if (available.length > 0 && !available.includes(level)) {
        throw new Error(`Thinking level not available: ${level}`);
      }
      runtime.session.setThinkingLevel(level as never);
      return createSnapshot(
        runtimeId,
        runtime,
        runtime.services,
        0,
        extensionErrors,
        configDiagnostics,
      );
    },
    listProviders() {
      return listProviderAuthSummaries(runtime.services);
    },
    async setProviderApiKey(provider, apiKey) {
      const trimmed = apiKey.trim();
      if (!provider.trim()) throw new Error("Provider is required");
      if (!trimmed) throw new Error("API key is required");
      await runtime.services.modelRuntime.setRuntimeApiKey(provider, trimmed);
      return listProviderAuthSummaries(runtime.services);
    },
    async clearProviderAuth(provider) {
      if (!provider.trim()) throw new Error("Provider is required");
      try {
        await runtime.services.modelRuntime.logout(provider);
      } catch {
        // Provider may only have a runtime key.
      }
      await runtime.services.modelRuntime.removeRuntimeApiKey(provider);
      return listProviderAuthSummaries(runtime.services);
    },
    getPiSettings() {
      return projectPiSettings(runtime.services, runtime.session);
    },
    patchPiSettings(patch) {
      applyPiSettingsPatch(runtime.services.settingsManager, patch);
      return projectPiSettings(runtime.services, runtime.session);
    },
    async completeText(prompt, options) {
      const modelRuntime = runtime.services.modelRuntime;
      let model = runtime.session.model;
      if (options?.model?.provider && options.model.id) {
        model =
          modelRuntime.getModel(options.model.provider, options.model.id) ?? model;
      }
      if (!model) {
        const models = modelRuntime.getModels();
        model = models[0];
      }
      if (!model) throw new Error("没有可用模型，请先在设置中配置模型");
      const result = await modelRuntime.completeSimple(model, {
        systemPrompt:
          options?.systemPrompt ??
          "You are a helpful assistant. Reply with only the requested text.",
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      });
      const text = (result.content ?? [])
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      if (!text) throw new Error("模型未返回文本");
      return text;
    },
    async dispose() {
      extensionUi.dispose();
      await runtime.dispose();
    },
  };
}

function projectPiSettings(
  services: AgentSessionServices,
  session?: AgentSessionRuntime["session"],
): PiSettingsView {
  const sm = services.settingsManager;
  const thinking = sm.getDefaultThinkingLevel();
  const view: PiSettingsView = {
    agentDir: services.agentDir,
    defaultProjectTrust: sm.getDefaultProjectTrust(),
    compactionEnabled: sm.getCompactionEnabled(),
    retryEnabled: sm.getRetryEnabled(),
    hideThinkingBlock: sm.getHideThinkingBlock(),
    quietStartup: sm.getQuietStartup(),
    enableSkillCommands: sm.getEnableSkillCommands(),
    availableThinkingLevels: session
      ? session.getAvailableThinkingLevels().map((level) => String(level))
      : ["off", "minimal", "low", "medium", "high"],
  };
  const provider = sm.getDefaultProvider();
  const model = sm.getDefaultModel();
  const theme = sm.getTheme();
  if (provider) view.defaultProvider = provider;
  if (model) view.defaultModel = model;
  if (thinking) view.defaultThinkingLevel = String(thinking);
  if (theme) view.theme = theme;
  return view;
}

/**
 * pi-ai KnownProvider catalog. Providers outside this set (e.g. models.json
 * custom names, extension providers) are treated as user-defined.
 */
const PI_BUILTIN_PROVIDERS = new Set<string>([
  "amazon-bedrock",
  "ant-ling",
  "anthropic",
  "google",
  "google-vertex",
  "openai",
  "azure-openai-responses",
  "openai-codex",
  "radius",
  "nvidia",
  "deepseek",
  "github-copilot",
  "xai",
  "groq",
  "cerebras",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "zai-coding-cn",
  "mistral",
  "minimax",
  "minimax-cn",
  "moonshotai",
  "moonshotai-cn",
  "huggingface",
  "fireworks",
  "together",
  "opencode",
  "opencode-go",
  "kimi-coding",
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
]);

function classifyModelSource(
  provider: string,
  services: AgentSessionServices,
): "builtin" | "custom" {
  // Extension-registered providers are always custom, even if they reuse a known id.
  const extensionIds = services.modelRuntime.getRegisteredProviderIds();
  if (extensionIds.includes(provider)) return "custom";
  return PI_BUILTIN_PROVIDERS.has(provider) ? "builtin" : "custom";
}

function applyPiSettingsPatch(sm: SettingsManager, patch: PiSettingsPatch): void {
  if (patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
    sm.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
  } else {
    if (patch.defaultProvider !== undefined) sm.setDefaultProvider(patch.defaultProvider);
    if (patch.defaultModel !== undefined) sm.setDefaultModel(patch.defaultModel);
  }
  if (patch.defaultThinkingLevel !== undefined) {
    sm.setDefaultThinkingLevel(patch.defaultThinkingLevel as never);
  }
  if (patch.defaultProjectTrust !== undefined) {
    sm.setDefaultProjectTrust(patch.defaultProjectTrust);
  }
  if (patch.theme !== undefined) sm.setTheme(patch.theme);
  if (patch.compactionEnabled !== undefined) sm.setCompactionEnabled(patch.compactionEnabled);
  if (patch.retryEnabled !== undefined) sm.setRetryEnabled(patch.retryEnabled);
  if (patch.hideThinkingBlock !== undefined) sm.setHideThinkingBlock(patch.hideThinkingBlock);
  if (patch.quietStartup !== undefined) sm.setQuietStartup(patch.quietStartup);
  if (patch.enableSkillCommands !== undefined) sm.setEnableSkillCommands(patch.enableSkillCommands);
}

export function listProviderAuthSummaries(services: AgentSessionServices): ProviderAuthSummary[] {
  const models = services.modelRuntime.getModels();
  const byProvider = new Map<string, number>();
  for (const model of models) {
    byProvider.set(model.provider, (byProvider.get(model.provider) ?? 0) + 1);
  }
  const providers = [...byProvider.keys()].sort((left, right) => left.localeCompare(right));
  return providers.map((provider) => {
    const status = services.modelRuntime.getProviderAuthStatus(provider);
    const meta = services.modelRuntime.getProvider(provider);
    const summary: ProviderAuthSummary = {
      provider,
      displayName: meta?.name || provider,
      configured: status.configured,
      modelCount: byProvider.get(provider) ?? 0,
      oauthAvailable: services.modelRuntime.isUsingOAuth(provider),
    };
    if (status.source) summary.source = status.source;
    if (status.label) summary.label = status.label;
    return summary;
  });
}
