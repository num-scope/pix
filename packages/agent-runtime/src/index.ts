import {
  type AgentSessionRuntime,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionError,
  type PackageSource,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultPackageManager,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  resolveModelScopeWithDiagnostics,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionUiResponse,
  HostSnapshot,
  ModelSummary,
  ModelsJsonConfigView,
  PackageSummary,
  PiSettingsPatch,
  PiSettingsView,
  ProjectTrustSummary,
  ProviderAuthSummary,
  ProviderUsageSnapshot,
  ResourceSummary,
  ScopedModelView,
  SessionBashResult,
  SessionExportResult,
  SessionHistoryMessage,
  SessionInfoView,
  SessionShareResult,
  SessionThreadSummary,
  SessionTreeView,
  UpsertCustomProviderInput,
} from "@pix/contracts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, win32 } from "node:path";
import {
  createPortableExtensionUiBridge,
  type ExtensionUiRequestEvent,
} from "./extension-ui-bridge.ts";
import { deleteProviderCredential, persistProviderApiKey } from "./auth-json.ts";
import {
  readModelsJsonConfig,
  removeCustomProviderFromModelsJson,
  upsertCustomProviderInModelsJson,
} from "./models-json.ts";
import { listProviderUsage } from "./provider-usage.ts";
import { resolvePixSessionDir } from "./session-dir.ts";
import {
  listBuiltinSlashCommands,
  projectSessionTree,
  type TreeNodeLike,
} from "./session-parity.ts";

export { createPortableExtensionUiBridge } from "./extension-ui-bridge.ts";
export {
  projectCustomEntry,
  projectCustomMessage,
  projectToolPresentation,
  sanitizeSerializable,
} from "./generic-renderers.ts";
export { authJsonPath, deleteProviderCredential, persistProviderApiKey } from "./auth-json.ts";
export {
  ensureModelsJsonTemplate,
  modelsJsonPath,
  readModelsJsonConfig,
  removeCustomProviderFromModelsJson,
  upsertCustomProviderInModelsJson,
} from "./models-json.ts";
export {
  PIX_SESSION_DIR_ENV,
  resolvePixSessionDir,
  type ResolvedPixSessionDir,
  type ResolvePixSessionDirOptions,
  type SessionDirSource,
} from "./session-dir.ts";
export {
  listBuiltinSlashCommands,
  mergeSlashCatalog,
  parseShellInjection,
  projectSessionTree,
} from "./session-parity.ts";

const MACOS_GITHUB_CLI_PATHS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"] as const;

export function resolveGitHubCliCommand(
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): string {
  if (platform === "darwin") {
    const installed = MACOS_GITHUB_CLI_PATHS.find((path) => pathExists(path));
    if (installed) return installed;
  }
  return "gh";
}

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
    options?: { temporary?: boolean },
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
  setPackageEnabled(
    source: string,
    scope: "global" | "project",
    enabled: boolean,
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
  listProviderUsage(): Promise<ProviderUsageSnapshot[]>;
  setProviderApiKey(provider: string, apiKey: string): Promise<ProviderAuthSummary[]>;
  clearProviderAuth(provider: string): Promise<ProviderAuthSummary[]>;
  getModelsJsonConfig(): Promise<ModelsJsonConfigView>;
  upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelsJsonConfigView>;
  removeCustomProvider(provider: string): Promise<ModelsJsonConfigView>;
  getPiSettings(): PiSettingsView;
  patchPiSettings(patch: PiSettingsPatch): PiSettingsView | Promise<PiSettingsView>;
  getSessionTree(): SessionTreeView;
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string },
  ): Promise<{ cancelled: boolean; snapshot: HostSnapshot; editorText?: string }>;
  compact(instructions?: string): Promise<HostSnapshot>;
  setSessionName(name: string): HostSnapshot;
  getSessionName(): string | undefined;
  cloneSession(): Promise<{ cancelled: boolean }>;
  getSessionInfo(): SessionInfoView;
  exportSession(format: "html" | "jsonl", outputPath?: string): Promise<SessionExportResult>;
  importSession(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }>;
  /** Share session as secret gist via `gh` (same as pi `/share`). */
  shareSession(): Promise<SessionShareResult>;
  executeBash(
    command: string,
    options?: { excludeFromContext?: boolean },
  ): Promise<{ result: SessionBashResult; snapshot: HostSnapshot }>;
  getLastAssistantText(): string | undefined;
  listScopedModels(): ScopedModelView[];
  refreshModelCatalog(): Promise<ModelSummary[]>;
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

function assistantContentParts(
  content: unknown,
): Array<{ role: "assistant" | "thinking"; text: string }> {
  if (typeof content === "string")
    return content.trim() ? [{ role: "assistant", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: Array<{ role: "assistant" | "thinking"; text: string }> = [];
  for (const part of content) {
    let role: "assistant" | "thinking" | undefined;
    let text = "";
    if (typeof part === "string") {
      role = "assistant";
      text = part;
    } else if (typeof part === "object" && part !== null && "type" in part) {
      if (part.type === "text" && "text" in part && typeof part.text === "string") {
        role = "assistant";
        text = part.text;
      } else if (
        part.type === "thinking" &&
        "thinking" in part &&
        typeof part.thinking === "string"
      ) {
        role = "thinking";
        text = part.thinking;
      }
    }
    if (!role || !text.trim()) continue;
    const previous = parts.at(-1);
    if (previous?.role === role) previous.text += text;
    else parts.push({ role, text });
  }
  return parts;
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
      command?: string;
      output?: string;
      exitCode?: number;
      excludeFromContext?: boolean;
    };
    if (row.role === "user") {
      const text = textFromMessageContent(row.content).trim();
      if (text) {
        const item: SessionHistoryMessage = { role: "user", text };
        if (entryId) item.entryId = entryId;
        history.push(item);
      }
    } else if (row.role === "assistant") {
      for (const part of assistantContentParts(row.content)) {
        const item: SessionHistoryMessage = { role: part.role, text: part.text.trim() };
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
    } else if (row.role === "bashExecution") {
      const item: SessionHistoryMessage = {
        role: "shell",
        text: typeof row.output === "string" ? row.output : "",
        command: typeof row.command === "string" ? row.command : "",
        exitCode: typeof row.exitCode === "number" ? row.exitCode : 0,
        excludeFromContext: row.excludeFromContext === true,
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

type SessionHistoryEntryLike = {
  type: string;
  id: string;
  timestamp?: string;
  summary?: string;
  message?: {
    role?: string;
    content?: unknown;
    toolName?: string;
    isError?: boolean;
    customType?: string;
  };
};

/**
 * Build timeline history from the active branch (root → leaf).
 * Prefer getBranch() so navigateTree / edit-resend hide abandoned siblings;
 * fall back to getEntries() for simple test doubles.
 */
export function projectHistoryFromSessionManager(sessionManager: {
  getEntries(): SessionHistoryEntryLike[];
  /** When present, project only the active path (pi SessionManager.getBranch). */
  getBranch?: (fromId?: string) => SessionHistoryEntryLike[];
}): SessionHistoryMessage[] {
  const history: SessionHistoryMessage[] = [];
  const entries =
    typeof sessionManager.getBranch === "function"
      ? sessionManager.getBranch()
      : sessionManager.getEntries();
  for (const entry of entries) {
    if (entry.type === "message") {
      const projected = projectSessionHistory([entry.message], [entry.id]);
      for (const item of projected) {
        if (entry.timestamp) item.timestamp = entry.timestamp;
        history.push(item);
      }
      continue;
    }
    if (entry.type === "compaction" && typeof entry.summary === "string") {
      const item: SessionHistoryMessage = {
        role: "system",
        title: "Compaction",
        text: entry.summary,
        entryId: entry.id,
      };
      if (entry.timestamp) item.timestamp = entry.timestamp;
      history.push(item);
    }
  }
  return history;
}

function threadTitleFromSession(info: { name?: string; firstMessage: string; id: string }): string {
  if (info.name?.trim()) return info.name.trim();
  const first = info.firstMessage.trim().split(/\r?\n/)[0]?.trim();
  if (first) return first.length > 72 ? `${first.slice(0, 71)}…` : first;
  return `Thread ${info.id.slice(0, 8)}`;
}

/**
 * Within one cwd list, append ` (2)`, ` (3)`, … when multiple sessions share the
 * same base title (common after fork: pi inherits `session_info` name).
 * Oldest by createdAt (fallback modifiedAt) keeps the bare title.
 * Pure helper — does not rewrite session files (pi does not auto-number forks).
 */
export function disambiguateSessionTitles(threads: SessionThreadSummary[]): SessionThreadSummary[] {
  if (threads.length < 2) return threads;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < threads.length; i++) {
    const base = (threads[i]?.titleBase ?? threads[i]?.title ?? "").trim() || threads[i]!.title;
    const list = groups.get(base);
    if (list) list.push(i);
    else groups.set(base, [i]);
  }
  const next = threads.map((t) => ({ ...t }));
  for (const [base, indices] of groups) {
    if (indices.length < 2 || !base) continue;
    indices.sort((a, b) => {
      const left = next[a]!;
      const right = next[b]!;
      const leftKey = left.createdAt ?? left.modifiedAt;
      const rightKey = right.createdAt ?? right.modifiedAt;
      const cmp = leftKey.localeCompare(rightKey);
      if (cmp !== 0) return cmp;
      return left.id.localeCompare(right.id);
    });
    for (let rank = 0; rank < indices.length; rank++) {
      const idx = indices[rank]!;
      const row = next[idx]!;
      row.titleBase = base;
      row.title = rank === 0 ? base : `${base} (${rank + 1})`;
    }
  }
  return next;
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
  const mapped = listed.map((item) => {
    const titleBase = threadTitleFromSession(item);
    const row: SessionThreadSummary = {
      id: item.id,
      path: item.path,
      cwd: item.cwd,
      title: titleBase,
      titleBase,
      modifiedAt: item.modified.toISOString(),
      messageCount: item.messageCount,
      active: options?.activeSessionId ? item.id === options.activeSessionId : false,
    };
    if (item.created instanceof Date && !Number.isNaN(item.created.getTime())) {
      row.createdAt = item.created.toISOString();
    }
    if (typeof item.parentSessionPath === "string" && item.parentSessionPath.trim()) {
      row.parentSessionPath = item.parentSessionPath;
    }
    return row;
  });
  return disambiguateSessionTitles(mapped).sort((left, right) =>
    right.modifiedAt.localeCompare(left.modifiedAt),
  );
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
    isAbsolute(source) ||
    win32.isAbsolute(source) ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\") ||
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

function packageSourceString(pkg: unknown): string {
  if (typeof pkg === "string") return pkg;
  if (pkg && typeof pkg === "object" && "source" in pkg) {
    const source = (pkg as { source?: unknown }).source;
    if (typeof source === "string") return source;
  }
  return "";
}

function packageEntryEnabled(pkg: unknown): boolean {
  if (typeof pkg === "string") return true;
  if (pkg && typeof pkg === "object") {
    const entry = pkg as {
      autoload?: unknown;
      extensions?: unknown;
      skills?: unknown;
      prompts?: unknown;
      themes?: unknown;
    };
    if (entry.autoload !== false) return true;
    return (
      [entry.extensions, entry.skills, entry.prompts, entry.themes].some(
        (patterns) => Array.isArray(patterns) && patterns.length > 0,
      ) && !disabledPackageFilters(entry)
    );
  }
  return true;
}

const DISABLED_PACKAGE_FILTER_PREFIX = "__pix_disabled_filters__/";

function disabledPackageFilters(entry: object): PackageSource | undefined {
  const extensions = (entry as { extensions?: unknown }).extensions;
  if (!Array.isArray(extensions)) return undefined;
  const marker = extensions.find(
    (value): value is string =>
      typeof value === "string" && value.startsWith(DISABLED_PACKAGE_FILTER_PREFIX),
  );
  if (!marker) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(marker.slice(DISABLED_PACKAGE_FILTER_PREFIX.length), "base64url").toString(
        "utf8",
      ),
    ) as unknown;
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("source" in decoded) ||
      typeof decoded.source !== "string"
    ) {
      return undefined;
    }
    return decoded as PackageSource;
  } catch {
    return undefined;
  }
}

function disablePackageEntry(entry: unknown, source: string): PackageSource {
  if (typeof entry === "string") return { source: entry, autoload: false };
  if (!entry || typeof entry !== "object") return { source, autoload: false };
  const record: Record<string, unknown> = { ...(entry as Record<string, unknown>), source };
  if (disabledPackageFilters(record)) return record as PackageSource;
  const encoded = Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
  return {
    source,
    autoload: false,
    extensions: [`${DISABLED_PACKAGE_FILTER_PREFIX}${encoded}`],
  };
}

function enablePackageEntry(entry: unknown, source: string): PackageSource {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return source;
  const restored = disabledPackageFilters(entry);
  if (restored) return restored;
  const record: Record<string, unknown> = { ...(entry as Record<string, unknown>), source };
  delete record.autoload;
  const keys = Object.keys(record).filter((key) => key !== "source");
  return keys.length === 0 ? source : (record as PackageSource);
}

function findPackageEntry(
  packages: unknown[],
  source: string,
): { index: number; entry: unknown } | undefined {
  const needle = source.replace(/\\/g, "/").replace(/\/+$/, "");
  for (let index = 0; index < packages.length; index += 1) {
    const entry = packages[index];
    const candidate = packageSourceString(entry).replace(/\\/g, "/").replace(/\/+$/, "");
    if (!candidate) continue;
    if (
      candidate === needle ||
      candidate.endsWith(needle) ||
      needle.endsWith(candidate) ||
      candidate === source ||
      packageSourceString(entry) === source
    ) {
      return { index, entry };
    }
  }
  return undefined;
}

export function listPackagesFromServices(services: AgentSessionServices): PackageSummary[] {
  const manager = createPackageManager(services);
  const globalPackages = services.settingsManager.getGlobalSettings().packages ?? [];
  const projectPackages = services.settingsManager.getProjectSettings().packages ?? [];
  return manager.listConfiguredPackages().map((entry) => {
    const pool = entry.scope === "project" ? projectPackages : globalPackages;
    const match = findPackageEntry(pool, entry.source);
    const summary: PackageSummary = {
      source: entry.source,
      scope: entry.scope === "project" ? "project" : "global",
      kind: packageKindFromSource(entry.source),
      filtered: entry.filtered,
      enabled: match ? packageEntryEnabled(match.entry) : true,
    };
    if (entry.installedPath) summary.installedPath = entry.installedPath;
    return summary;
  });
}

/**
 * Toggle a configured package without letting explicit filters bypass `autoload: false`.
 * Filtered entries are encoded into a no-match pattern while disabled so they can be restored.
 */
export function setPackageEnabledInSettings(
  services: AgentSessionServices,
  source: string,
  scope: "global" | "project",
  enabled: boolean,
): PackageSummary[] {
  const isProject = scope === "project";
  const current = isProject
    ? [...(services.settingsManager.getProjectSettings().packages ?? [])]
    : [...(services.settingsManager.getGlobalSettings().packages ?? [])];
  const found = findPackageEntry(current, source);
  if (!found) {
    throw new Error(`Package not found in ${scope} settings: ${source}`);
  }
  const sourceStr = packageSourceString(found.entry) || source;
  const nextEntry = enabled
    ? enablePackageEntry(found.entry, sourceStr)
    : disablePackageEntry(found.entry, sourceStr);
  const next = [...current];
  next[found.index] = nextEntry as (typeof current)[number];
  if (isProject) {
    services.settingsManager.setProjectPackages(next as never);
  } else {
    services.settingsManager.setPackages(next as never);
  }
  return listPackagesFromServices(services);
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
  const systemPromptPaths = [
    {
      path: join(services.cwd, ".pi", "SYSTEM.md"),
      source: "project",
      trusted: services.settingsManager.isProjectTrusted(),
    },
    { path: join(services.agentDir, "SYSTEM.md"), source: "global", trusted: true },
  ];
  const appendSystemPromptPaths = [
    {
      path: join(services.cwd, ".pi", "APPEND_SYSTEM.md"),
      source: "project",
      trusted: services.settingsManager.isProjectTrusted(),
    },
    { path: join(services.agentDir, "APPEND_SYSTEM.md"), source: "global", trusted: true },
  ];
  for (const candidates of [systemPromptPaths, appendSystemPromptPaths]) {
    const selected = candidates.find(
      (candidate) => candidate.trusted && existsSync(candidate.path),
    );
    if (selected) {
      resources.push({
        kind: "system",
        name: basename(selected.path),
        path: selected.path,
        source: selected.source,
      });
    }
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
  const slashCommands: HostSnapshot["slashCommands"] = [];
  const commandNames = new Set<string>();

  for (const command of runtime.session.extensionRunner.getRegisteredCommands()) {
    if (!command.invocationName || commandNames.has(command.invocationName)) continue;
    commandNames.add(command.invocationName);
    slashCommands.push({
      name: command.invocationName,
      description: command.description ?? "Extension command",
      source: "extension",
    });
  }
  for (const prompt of runtime.session.promptTemplates) {
    if (!prompt.name || commandNames.has(prompt.name)) continue;
    commandNames.add(prompt.name);
    const command: HostSnapshot["slashCommands"][number] = {
      name: prompt.name,
      description: prompt.description,
      source: "prompt",
    };
    if (prompt.argumentHint) command.argumentHint = prompt.argumentHint;
    slashCommands.push(command);
  }
  if (services.settingsManager.getEnableSkillCommands()) {
    for (const skill of skills.skills) {
      const name = `skill:${skill.name}`;
      if (commandNames.has(name)) continue;
      commandNames.add(name);
      slashCommands.push({
        name,
        description: skill.description,
        source: "skill",
      });
    }
  }

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
    slashCommands,
    queuedMessages: {
      steering: [...runtime.session.getSteeringMessages()],
      followUp: [...runtime.session.getFollowUpMessages()],
    },
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
  const sessionName =
    runtime.session.sessionName ?? runtime.session.sessionManager.getSessionName();
  if (sessionName) snapshot.sessionName = sessionName;
  if (model) snapshot.model = { provider: model.provider, id: model.id };
  snapshot.thinkingLevel = String(runtime.session.thinkingLevel);
  snapshot.availableThinkingLevels = runtime.session
    .getAvailableThinkingLevels()
    .map((level) => String(level));
  snapshot.trust = resolvePixProjectTrust(services.cwd, services.agentDir);
  snapshot.builtinSlashCommands = listBuiltinSlashCommands();
  snapshot.steeringMode = runtime.session.steeringMode;
  snapshot.followUpMode = runtime.session.followUpMode;
  snapshot.hideThinkingBlock = services.settingsManager.getHideThinkingBlock();
  snapshot.doubleEscapeAction = services.settingsManager.getDoubleEscapeAction();

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
  const temporaryExtensionPaths: string[] = [];
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
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      resourceLoaderOptions: { additionalExtensionPaths: temporaryExtensionPaths },
    });
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

  async function reloadSessionResources(): Promise<void> {
    extensionUi.reload();
    await runtime.session.reload({
      beforeSessionStart: () => {
        extensionUi.reload();
      },
    });
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
      await reloadSessionResources();
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
    async installPackage(source, scope, onProgress, options) {
      const manager = createPackageManager(runtime.services);
      bindPackageProgress(manager, onProgress);
      try {
        if (options?.temporary) {
          // pi `-e` style: resolve into temporary scope, do not write settings.json.
          const resolved = await manager.resolveExtensionSources([source], { temporary: true });
          for (const extension of resolved.extensions) {
            if (extension.enabled && !temporaryExtensionPaths.includes(extension.path)) {
              temporaryExtensionPaths.push(extension.path);
            }
          }
          await reloadSessionResources();
          return listPackagesFromServices(runtime.services);
        }
        await manager.installAndPersist(source, { local: scope === "project" });
        await reloadSessionResources();
        return listPackagesFromServices(runtime.services);
      } finally {
        manager.setProgressCallback(undefined);
      }
    },
    async setPackageEnabled(source, scope, enabled) {
      setPackageEnabledInSettings(runtime.services, source, scope, enabled);
      await reloadSessionResources();
      return listPackagesFromServices(runtime.services);
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
        await reloadSessionResources();
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
        await reloadSessionResources();
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
      // Full pi ThinkingLevel set (settings/rpc/usage + thinkingLevelMap keys).
      const known = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
      const normalized = String(level).trim().toLowerCase();
      if (!known.has(normalized)) {
        throw new Error(`Unknown thinking level: ${level}`);
      }
      // Allow full pi ThinkingLevel set even when the model reports a narrow subset
      // (common for custom providers with reasoning:true but incomplete thinkingLevelMap).
      try {
        runtime.session.setThinkingLevel(normalized as never);
      } catch (error) {
        const available = runtime.session.getAvailableThinkingLevels().map((item) => String(item));
        throw new Error(
          available.length > 0
            ? `Thinking level not available for this model: ${normalized} (supports: ${available.join(", ")})`
            : error instanceof Error
              ? error.message
              : `Failed to set thinking level: ${normalized}`,
        );
      }
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
    listProviderUsage() {
      return listProviderUsage(runtime.services);
    },
    async setProviderApiKey(provider, apiKey) {
      const providerId = provider.trim();
      const trimmed = apiKey.trim();
      if (!providerId) throw new Error("Provider is required");
      if (!trimmed) throw new Error("API key is required");
      // Durable write first — setRuntimeApiKey alone is memory-only (RuntimeCredentials).
      await persistProviderApiKey(runtime.services.agentDir, providerId, trimmed);
      await runtime.services.modelRuntime.setRuntimeApiKey(providerId, trimmed);
      return listProviderAuthSummaries(runtime.services);
    },
    async clearProviderAuth(provider) {
      const providerId = provider.trim();
      if (!providerId) throw new Error("Provider is required");
      try {
        await runtime.services.modelRuntime.logout(providerId);
      } catch {
        // Provider may only have a runtime key.
      }
      await runtime.services.modelRuntime.removeRuntimeApiKey(providerId);
      await deleteProviderCredential(runtime.services.agentDir, providerId);
      return listProviderAuthSummaries(runtime.services);
    },
    async getModelsJsonConfig() {
      return readModelsJsonConfig(runtime.services.agentDir);
    },
    async upsertCustomProvider(input) {
      const providerId = input.provider.trim();
      const previousProvider = input.previousProvider?.trim();
      const config = await upsertCustomProviderInModelsJson(runtime.services.agentDir, input);
      const apiKey = input.apiKey?.trim();
      if (apiKey) {
        await persistProviderApiKey(runtime.services.agentDir, providerId, apiKey);
      }
      // If the provider id was renamed, drop the old credential slot.
      if (previousProvider && previousProvider !== providerId) {
        await deleteProviderCredential(runtime.services.agentDir, previousProvider);
        try {
          await runtime.services.modelRuntime.removeRuntimeApiKey(previousProvider);
        } catch {
          // ignore
        }
      }
      await runtime.services.modelRuntime.reloadConfig();
      // Keep current process configured even if AuthStorage has not re-read auth.json yet.
      if (apiKey) {
        await runtime.services.modelRuntime.setRuntimeApiKey(providerId, apiKey);
      }
      return config;
    },
    async removeCustomProvider(provider) {
      const providerId = provider.trim();
      const config = await removeCustomProviderFromModelsJson(
        runtime.services.agentDir,
        providerId,
      );
      await deleteProviderCredential(runtime.services.agentDir, providerId);
      try {
        await runtime.services.modelRuntime.removeRuntimeApiKey(providerId);
      } catch {
        // ignore
      }
      await runtime.services.modelRuntime.reloadConfig();
      return config;
    },
    getPiSettings() {
      return projectPiSettings(runtime.services, runtime.session);
    },
    async patchPiSettings(patch) {
      await applyPiSettingsPatch(runtime.services, patch, runtime.session);
      return projectPiSettings(runtime.services, runtime.session);
    },
    getSessionTree() {
      const sm = runtime.session.sessionManager;
      const filterMode = runtime.services.settingsManager.getTreeFilterMode();
      const roots = sm.getTree() as unknown as TreeNodeLike[];
      const leafId = sm.getLeafId();
      return projectSessionTree({
        sessionId: runtime.session.sessionId,
        ...(runtime.session.sessionFile ? { sessionFile: runtime.session.sessionFile } : {}),
        ...(leafId ? { leafId } : {}),
        filterMode,
        roots,
      });
    },
    async navigateTree(targetId, options) {
      const result = await runtime.session.navigateTree(targetId, {
        ...(options?.summarize !== undefined ? { summarize: options.summarize } : {}),
        ...(options?.customInstructions ? { customInstructions: options.customInstructions } : {}),
      });
      return {
        cancelled: result.cancelled,
        snapshot: createSnapshot(
          runtimeId,
          runtime,
          runtime.services,
          0,
          extensionErrors,
          configDiagnostics,
        ),
        // pi: navigating to a user message rewinds to its parent and returns text for the editor
        ...(typeof result.editorText === "string" ? { editorText: result.editorText } : {}),
      };
    },
    async compact(instructions) {
      await runtime.session.compact(instructions);
      return createSnapshot(
        runtimeId,
        runtime,
        runtime.services,
        0,
        extensionErrors,
        configDiagnostics,
      );
    },
    setSessionName(name) {
      runtime.session.setSessionName(name);
      return createSnapshot(
        runtimeId,
        runtime,
        runtime.services,
        0,
        extensionErrors,
        configDiagnostics,
      );
    },
    getSessionName() {
      return runtime.session.sessionName ?? runtime.session.sessionManager.getSessionName();
    },
    async cloneSession() {
      // pi RPC clone = fork at current leaf (same file branch copied to new session file).
      const leafId = runtime.session.sessionManager.getLeafId();
      if (!leafId) throw new Error("Cannot clone session: no current entry selected");
      return afterSessionReplacement(() => runtime.fork(leafId, { position: "at" }));
    },
    getSessionInfo() {
      const stats = runtime.session.getSessionStats();
      const contextUsage = runtime.session.getContextUsage() ?? stats.contextUsage;
      const info: SessionInfoView = {
        sessionId: runtime.session.sessionId,
        messageCount: stats.totalMessages,
        tokens: {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
        },
        cost: stats.cost,
      };
      if (runtime.session.sessionFile) {
        info.sessionFile = runtime.session.sessionFile;
        info.path = runtime.session.sessionFile;
      }
      const name = runtime.session.sessionName ?? runtime.session.sessionManager.getSessionName();
      if (name) info.sessionName = name;
      if (contextUsage) {
        info.context = {
          tokens: contextUsage.tokens,
          contextWindow: contextUsage.contextWindow,
          percent: contextUsage.percent,
        };
      }
      return info;
    },
    async exportSession(format, outputPath) {
      if (format === "html") {
        const path = await runtime.session.exportToHtml(outputPath);
        return { format, path };
      }
      const path = runtime.session.exportToJsonl(outputPath);
      return { format, path };
    },
    async shareSession() {
      // Same strategy as pi interactive `/share`: export HTML → `gh gist create --public=false`.
      const dir = await mkdtemp(join(tmpdir(), "pix-share-"));
      const htmlPath = join(dir, "session.html");
      try {
        await runtime.session.exportToHtml(htmlPath);
        const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
          (resolve, reject) => {
            const proc = spawn(
              resolveGitHubCliCommand(),
              ["gist", "create", "--public=false", htmlPath],
              {
                env: process.env,
              },
            );
            let stdout = "";
            let stderr = "";
            proc.stdout?.on("data", (chunk: Buffer | string) => {
              stdout += String(chunk);
            });
            proc.stderr?.on("data", (chunk: Buffer | string) => {
              stderr += String(chunk);
            });
            proc.on("error", (error) => {
              reject(
                new Error(
                  error instanceof Error &&
                    "code" in error &&
                    (error as NodeJS.ErrnoException).code === "ENOENT"
                    ? "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and run `gh auth login`."
                    : error instanceof Error
                      ? error.message
                      : String(error),
                ),
              );
            });
            proc.on("close", (code) => resolve({ stdout, stderr, code }));
          },
        );
        if (result.code !== 0) {
          const detail = result.stderr.trim() || result.stdout.trim() || "Unknown error";
          throw new Error(`Failed to create gist: ${detail}`);
        }
        const gistUrl =
          result.stdout
            .trim()
            .split(/\s+/)
            .find((line) => line.includes("gist.github.com")) ?? result.stdout.trim();
        const gistId = gistUrl.split("/").filter(Boolean).pop();
        if (!gistId) {
          throw new Error("Failed to parse gist ID from gh output");
        }
        // Same viewer base as pi config.getShareViewerUrl (not re-exported from package root).
        const baseUrl = process.env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/";
        const url = `${baseUrl}#${gistId}`;
        return { url, gistUrl, gistId };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async importSession(inputPath, cwdOverride) {
      return afterSessionReplacement(() => runtime.importFromJsonl(inputPath, cwdOverride));
    },
    async executeBash(command, options) {
      const excludeFromContext = options?.excludeFromContext === true;
      const bashResult = await runtime.session.executeBash(command, undefined, {
        excludeFromContext,
      });
      let output = "";
      let exitCode = 0;
      if (typeof bashResult === "object" && bashResult) {
        const record = bashResult as { output?: unknown; exitCode?: unknown; text?: unknown };
        if (typeof record.output === "string") output = record.output;
        else if (typeof record.text === "string") output = record.text;
        if (typeof record.exitCode === "number") exitCode = record.exitCode;
      } else if (typeof bashResult === "string") {
        output = bashResult;
      }
      return {
        result: {
          command,
          output,
          exitCode,
          excludeFromContext,
        },
        snapshot: createSnapshot(
          runtimeId,
          runtime,
          runtime.services,
          0,
          extensionErrors,
          configDiagnostics,
        ),
      };
    },
    getLastAssistantText() {
      return runtime.session.getLastAssistantText();
    },
    listScopedModels() {
      return runtime.session.scopedModels.map((item) => {
        const model = item.model;
        const view: ScopedModelView = {
          provider: model.provider,
          id: model.id,
        };
        if (model.name) view.name = model.name;
        return view;
      });
    },
    async refreshModelCatalog() {
      await runtime.services.modelRuntime.reloadConfig();
      return runtime.services.modelRuntime.getModels().map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name ?? model.id,
        reasoning: Boolean(model.reasoning),
        source: classifyModelSource(model.provider, runtime.services),
      }));
    },
    async completeText(prompt, options) {
      const modelRuntime = runtime.services.modelRuntime;
      let model = runtime.session.model;
      if (options?.model?.provider && options.model.id) {
        model = modelRuntime.getModel(options.model.provider, options.model.id) ?? model;
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

/** Pix product default: 60 minutes (pi upstream default is 5 minutes / 300_000). */
export const PIX_DEFAULT_HTTP_IDLE_TIMEOUT_MS = 3_600_000;

/**
 * Pix product defaults for network/telemetry when the user never set them.
 * pi defaults enableInstallTelemetry to true; Pix keeps both reporting switches off.
 */
export const PIX_DEFAULT_ENABLE_INSTALL_TELEMETRY = false;
export const PIX_DEFAULT_ENABLE_ANALYTICS = false;

function projectPiSettings(
  services: AgentSessionServices,
  _session?: AgentSessionRuntime["session"],
): PiSettingsView {
  const sm = services.settingsManager;
  // Promote product defaults only when the key was never written (do not override user choice).
  const globalSnap = sm.getGlobalSettings() as {
    httpIdleTimeoutMs?: unknown;
    enableInstallTelemetry?: unknown;
    enableAnalytics?: unknown;
  };
  if (globalSnap.httpIdleTimeoutMs === undefined || globalSnap.httpIdleTimeoutMs === null) {
    try {
      sm.setHttpIdleTimeoutMs(PIX_DEFAULT_HTTP_IDLE_TIMEOUT_MS);
    } catch {
      // Ignore if SettingsManager rejects (should not for a valid ms value).
    }
  }
  if (globalSnap.enableInstallTelemetry === undefined) {
    try {
      sm.setEnableInstallTelemetry(PIX_DEFAULT_ENABLE_INSTALL_TELEMETRY);
    } catch {
      // Ignore write failures (settings may be read-only in tests).
    }
  }
  if (globalSnap.enableAnalytics === undefined) {
    try {
      sm.setEnableAnalytics(PIX_DEFAULT_ENABLE_ANALYTICS);
    } catch {
      // Ignore write failures (settings may be read-only in tests).
    }
  }
  const thinking = sm.getDefaultThinkingLevel();
  const compaction = sm.getCompactionSettings();
  const retry = sm.getRetrySettings();
  const thinkingBudgets = sm.getThinkingBudgets();
  const view: PiSettingsView = {
    agentDir: services.agentDir,
    defaultProjectTrust: sm.getDefaultProjectTrust(),
    compactionEnabled: sm.getCompactionEnabled(),
    compactionReserveTokens: compaction.reserveTokens,
    compactionKeepRecentTokens: compaction.keepRecentTokens,
    retryEnabled: sm.getRetryEnabled(),
    retryMaxRetries: retry.maxRetries,
    retryBaseDelayMs: retry.baseDelayMs,
    hideThinkingBlock: sm.getHideThinkingBlock(),
    quietStartup: sm.getQuietStartup(),
    enableSkillCommands: sm.getEnableSkillCommands(),
    // Global settings UI needs the full pi ThinkingLevel set (incl. max).
    // Session-model subsets (often just "off") are on HostSnapshot for the composer only.
    availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    steeringMode: sm.getSteeringMode(),
    followUpMode: sm.getFollowUpMode(),
    doubleEscapeAction: sm.getDoubleEscapeAction(),
    treeFilterMode: sm.getTreeFilterMode(),
    enableInstallTelemetry: sm.getEnableInstallTelemetry(),
    enableAnalytics: sm.getEnableAnalytics(),
    httpIdleTimeoutMs: sm.getHttpIdleTimeoutMs(),
    enabledModels: [...(sm.getEnabledModels() ?? [])],
    inventory: projectSettingsInventory(sm),
    // Nested compaction/retry thresholds are writable via SettingsManager private save path.
    readOnlyFields: ["thinkingBudgets"],
    // Stable keys for desktop i18n (piSettings.degraded.*). Do not localize here.
    // gist is no longer degraded once /share is wired; llama/sandbox/tui remain.
    degradedCapabilities: ["tui", "sandbox", "llama"],
  };
  const provider = sm.getDefaultProvider();
  const model = sm.getDefaultModel();
  const theme = sm.getTheme();
  if (provider) view.defaultProvider = provider;
  if (model) view.defaultModel = model;
  if (thinking) view.defaultThinkingLevel = String(thinking);
  if (theme) view.theme = theme;
  if (thinkingBudgets) view.thinkingBudgets = { ...thinkingBudgets };
  return view;
}

const KNOWN_PI_SETTING_KEYS = [
  "lastChangelogVersion",
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "transport",
  "steeringMode",
  "followUpMode",
  "theme",
  "compaction",
  "branchSummary",
  "retry",
  "hideThinkingBlock",
  "showCacheMissNotices",
  "externalEditor",
  "shellPath",
  "quietStartup",
  "defaultProjectTrust",
  "shellCommandPrefix",
  "npmCommand",
  "collapseChangelog",
  "enableInstallTelemetry",
  "enableAnalytics",
  "trackingId",
  "packages",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "enableSkillCommands",
  "terminal",
  "images",
  "enabledModels",
  "doubleEscapeAction",
  "treeFilterMode",
  "thinkingBudgets",
  "editorPaddingX",
  "outputPad",
  "autocompleteMaxVisible",
  "showHardwareCursor",
  "markdown",
  "warnings",
  "sessionDir",
  "httpProxy",
  "httpIdleTimeoutMs",
  "websocketConnectTimeoutMs",
] as const;

const WRITABLE_PI_SETTING_KEYS = new Set([
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "defaultProjectTrust",
  "theme",
  "compaction",
  "retry",
  "hideThinkingBlock",
  "quietStartup",
  "enableSkillCommands",
  "steeringMode",
  "followUpMode",
  "doubleEscapeAction",
  "treeFilterMode",
  "enableInstallTelemetry",
  "enableAnalytics",
  "httpIdleTimeoutMs",
  "enabledModels",
]);

function isPlainSettingObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSettingValue(globalValue: unknown, projectValue: unknown): unknown {
  if (!isPlainSettingObject(globalValue) || !isPlainSettingObject(projectValue)) {
    return projectValue;
  }
  const merged: Record<string, unknown> = { ...globalValue };
  for (const [key, value] of Object.entries(projectValue)) {
    merged[key] = mergeSettingValue(globalValue[key], value);
  }
  return merged;
}

function formatSettingValue(key: string, value: unknown): string {
  if (value === undefined) return "pi default";
  if (key === "trackingId" || key === "httpProxy") return value ? "configured" : "not configured";
  if (typeof value === "string") return value || '""';
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return `[${typeof value}]`;
  }
  if (serialized === undefined) return `[${typeof value}]`;
  return serialized.length > 360 ? `${serialized.slice(0, 357)}...` : serialized;
}

function projectSettingsInventory(
  settingsManager: AgentSessionServices["settingsManager"],
): PiSettingsView["inventory"] {
  const globalSettings = settingsManager.getGlobalSettings() as Record<string, unknown>;
  const projectSettings = settingsManager.getProjectSettings() as Record<string, unknown>;
  const keys = new Set<string>([
    ...KNOWN_PI_SETTING_KEYS,
    ...Object.keys(globalSettings),
    ...Object.keys(projectSettings),
  ]);
  return [...keys].sort().map((key) => {
    const hasGlobal = Object.hasOwn(globalSettings, key);
    const hasProject = Object.hasOwn(projectSettings, key);
    const globalValue = globalSettings[key];
    const projectValue = projectSettings[key];
    const bothObjects =
      hasGlobal &&
      hasProject &&
      isPlainSettingObject(globalValue) &&
      isPlainSettingObject(projectValue);
    const effective = hasProject
      ? hasGlobal
        ? mergeSettingValue(globalValue, projectValue)
        : projectValue
      : globalValue;
    return {
      key,
      value: formatSettingValue(key, effective),
      source: bothObjects ? "merged" : hasProject ? "project" : hasGlobal ? "global" : "default",
      configuredScopes: [
        ...(hasGlobal ? (["global"] as const) : []),
        ...(hasProject ? (["project"] as const) : []),
      ],
      writable: WRITABLE_PI_SETTING_KEYS.has(key),
    };
  });
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

/**
 * pi SettingsManager exposes setCompactionEnabled / setRetryEnabled but not nested
 * reserveTokens / maxRetries setters. Mirror those setters' save path via the same
 * private fields so nested keys persist into settings.json.
 */
function asWritableSettingsManager(sm: SettingsManager): {
  globalSettings: Record<string, unknown>;
  markModified: (field: string, nestedKey?: string) => void;
  save: () => void;
} {
  return sm as unknown as {
    globalSettings: Record<string, unknown>;
    markModified: (field: string, nestedKey?: string) => void;
    save: () => void;
  };
}

function ensureNestedObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function patchNestedCompaction(
  sm: SettingsManager,
  patch: { reserveTokens?: number; keepRecentTokens?: number },
): void {
  const writable = asWritableSettingsManager(sm);
  const compaction = ensureNestedObject(writable.globalSettings, "compaction");
  if (patch.reserveTokens !== undefined) {
    compaction.reserveTokens = Math.max(1024, Math.floor(patch.reserveTokens));
    writable.markModified("compaction", "reserveTokens");
  }
  if (patch.keepRecentTokens !== undefined) {
    compaction.keepRecentTokens = Math.max(1024, Math.floor(patch.keepRecentTokens));
    writable.markModified("compaction", "keepRecentTokens");
  }
  writable.save();
}

function patchNestedRetry(
  sm: SettingsManager,
  patch: { maxRetries?: number; baseDelayMs?: number },
): void {
  const writable = asWritableSettingsManager(sm);
  const retry = ensureNestedObject(writable.globalSettings, "retry");
  if (patch.maxRetries !== undefined) {
    retry.maxRetries = Math.max(0, Math.min(20, Math.floor(patch.maxRetries)));
    writable.markModified("retry", "maxRetries");
  }
  if (patch.baseDelayMs !== undefined) {
    retry.baseDelayMs = Math.max(0, Math.min(60_000, Math.floor(patch.baseDelayMs)));
    writable.markModified("retry", "baseDelayMs");
  }
  writable.save();
}

async function applyPiSettingsPatch(
  services: AgentSessionServices,
  patch: PiSettingsPatch,
  session?: AgentSessionRuntime["session"],
): Promise<void> {
  const sm = services.settingsManager;
  if (patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
    sm.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
  } else {
    if (patch.defaultProvider !== undefined) sm.setDefaultProvider(patch.defaultProvider);
    if (patch.defaultModel !== undefined) sm.setDefaultModel(patch.defaultModel);
  }
  if (patch.defaultThinkingLevel !== undefined) {
    const level = String(patch.defaultThinkingLevel).trim().toLowerCase();
    sm.setDefaultThinkingLevel(level as never);
    // Sync current session so composer thinking chrome updates immediately.
    if (session) {
      try {
        session.setThinkingLevel(level as never);
      } catch {
        // Model may reject the level; default remains saved for new sessions.
      }
    }
  }
  if (patch.defaultProjectTrust !== undefined) {
    sm.setDefaultProjectTrust(patch.defaultProjectTrust);
  }
  if (patch.theme !== undefined) sm.setTheme(patch.theme);
  if (patch.compactionEnabled !== undefined) sm.setCompactionEnabled(patch.compactionEnabled);
  if (
    patch.compactionReserveTokens !== undefined ||
    patch.compactionKeepRecentTokens !== undefined
  ) {
    patchNestedCompaction(sm, {
      ...(patch.compactionReserveTokens !== undefined
        ? { reserveTokens: patch.compactionReserveTokens }
        : {}),
      ...(patch.compactionKeepRecentTokens !== undefined
        ? { keepRecentTokens: patch.compactionKeepRecentTokens }
        : {}),
    });
  }
  if (patch.retryEnabled !== undefined) sm.setRetryEnabled(patch.retryEnabled);
  if (patch.retryMaxRetries !== undefined || patch.retryBaseDelayMs !== undefined) {
    patchNestedRetry(sm, {
      ...(patch.retryMaxRetries !== undefined ? { maxRetries: patch.retryMaxRetries } : {}),
      ...(patch.retryBaseDelayMs !== undefined ? { baseDelayMs: patch.retryBaseDelayMs } : {}),
    });
  }
  if (patch.hideThinkingBlock !== undefined) sm.setHideThinkingBlock(patch.hideThinkingBlock);
  if (patch.quietStartup !== undefined) sm.setQuietStartup(patch.quietStartup);
  if (patch.enableSkillCommands !== undefined) sm.setEnableSkillCommands(patch.enableSkillCommands);
  if (patch.steeringMode !== undefined) {
    sm.setSteeringMode(patch.steeringMode);
    session?.setSteeringMode(patch.steeringMode);
  }
  if (patch.followUpMode !== undefined) {
    sm.setFollowUpMode(patch.followUpMode);
    session?.setFollowUpMode(patch.followUpMode);
  }
  if (patch.doubleEscapeAction !== undefined) {
    sm.setDoubleEscapeAction(patch.doubleEscapeAction);
  }
  if (patch.treeFilterMode !== undefined) {
    sm.setTreeFilterMode(patch.treeFilterMode);
  }
  if (patch.enableInstallTelemetry !== undefined) {
    sm.setEnableInstallTelemetry(patch.enableInstallTelemetry);
  }
  if (patch.enableAnalytics !== undefined) {
    sm.setEnableAnalytics(patch.enableAnalytics);
  }
  if (patch.httpIdleTimeoutMs !== undefined) {
    sm.setHttpIdleTimeoutMs(patch.httpIdleTimeoutMs);
  }
  if (patch.enabledModels !== undefined) {
    const patterns = patch.enabledModels
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    // Empty list clears scope (same as pi when no --models / enabledModels).
    sm.setEnabledModels(patterns.length > 0 ? patterns : undefined);
    if (session) {
      if (patterns.length === 0) {
        session.setScopedModels([]);
      } else {
        const { scopedModels } = await resolveModelScopeWithDiagnostics(
          patterns,
          services.modelRuntime,
        );
        session.setScopedModels(
          scopedModels.map((item) => ({
            model: item.model,
            ...(item.thinkingLevel !== undefined ? { thinkingLevel: item.thinkingLevel } : {}),
          })),
        );
      }
    }
  }
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
      oauthSupported: Boolean(meta?.auth.oauth),
      oauthActive: services.modelRuntime.isUsingOAuth(provider),
    };
    if (status.source) summary.source = status.source;
    if (status.label) summary.label = status.label;
    return summary;
  });
}
