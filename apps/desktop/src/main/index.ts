import {
  IPC_PROTOCOL_VERSION,
  type ExtensionUiResponse,
  type GitBranchInfo,
  type GitContextInfo,
  type GitWorktreeInfo,
  type HostCommand,
  type HostEvent,
  type HostSnapshot,
  type ModelSummary,
  type PhotonProbeResult,
  type PackageSummary,
  type PiSettingsPatch,
  type PiSettingsView,
  type ProjectTrustSummary,
  type ProviderAuthSummary,
  type ResourceSummary,
  type SessionHistoryMessage,
  type SessionThreadSummary,
  isHostEvent,
} from "@pix/contracts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const HOST_EVENT_CHANNEL = "pix:host:event";

/** Best-effort branch / worktree labels for composer chrome (no git binary required). */
function readGitContext(cwd: string | undefined): GitContextInfo {
  if (!cwd || !existsSync(cwd)) return {};
  try {
    const gitEntry = join(cwd, ".git");
    if (!existsSync(gitEntry)) return {};
    let gitDir = gitEntry;
    let isMainWorktree = true;
    let worktree = "本地";
    let mainWorktreePath = cwd;
    const stat = lstatSync(gitEntry);
    if (stat.isFile()) {
      // Linked worktree: `.git` is a file `gitdir: /path/to/main/.git/worktrees/name`
      const raw = readFileSync(gitEntry, "utf8").trim();
      const match = /^gitdir:\s*(.+)$/m.exec(raw);
      if (match?.[1]) {
        gitDir = resolve(cwd, match[1].trim());
        isMainWorktree = false;
        worktree = basename(gitDir) || "工作树";
        // .../.git/worktrees/<name> → main git dir is .../.git → main root is parent of .git
        const mainGitDir = resolve(gitDir, "../..");
        mainWorktreePath = dirname(mainGitDir);
      }
    }
    const headPath = join(gitDir, "HEAD");
    if (!existsSync(headPath)) {
      return {
        worktree,
        isMainWorktree,
        mainWorktreePath,
        worktreePath: cwd,
      };
    }
    const head = readFileSync(headPath, "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    const branch = ref?.[1]?.trim() || (head.length >= 7 ? head.slice(0, 7) : head) || undefined;
    return {
      ...(branch ? { branch } : {}),
      worktree,
      isMainWorktree,
      mainWorktreePath,
      worktreePath: cwd,
    };
  } catch {
    return {};
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const err = String(stderr ?? "").trim();
  // git writes some progress to stderr; only treat as failure when exit would have thrown.
  void err;
  return String(stdout ?? "");
}

function resolveWorkspaceCwd(cwd: string | undefined, fallback?: string): string {
  const path = (typeof cwd === "string" && cwd.trim() ? cwd : fallback)?.trim();
  if (!path || !existsSync(path)) throw new Error("工作区路径无效");
  return path;
}

async function listGitBranches(cwd: string): Promise<GitBranchInfo[]> {
  // Local branches
  const localOut = await runGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%00%(HEAD)",
    "refs/heads",
  ]);
  const remoteOut = await runGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%00%(HEAD)",
    "refs/remotes",
  ]);
  const seen = new Set<string>();
  const branches: GitBranchInfo[] = [];
  for (const [block, remote] of [
    [localOut, false],
    [remoteOut, true],
  ] as const) {
    for (const line of block.split("\n")) {
      const raw = line.trim();
      if (!raw) continue;
      const [name, headMark] = raw.split("\0");
      if (!name || name.endsWith("/HEAD")) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      branches.push({
        name,
        current: headMark === "*",
        ...(remote ? { remote: true } : {}),
      });
    }
  }
  // Prefer current first, then local alpha, then remote alpha.
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (Boolean(a.remote) !== Boolean(b.remote)) return a.remote ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return branches;
}

async function checkoutGitBranch(cwd: string, branch: string): Promise<GitContextInfo> {
  const name = branch.trim();
  if (!name) throw new Error("分支名不能为空");
  // Remote-tracking: origin/foo → create/switch local foo tracking it when needed.
  if (name.includes("/") && !existsSync(join(cwd, ".git"))) {
    // still fine — git handles it
  }
  try {
    await runGit(cwd, ["checkout", name]);
  } catch (error) {
    // origin/feature → checkout -b feature --track origin/feature
    if (name.includes("/")) {
      const short = name.replace(/^[^/]+\//, "");
      await runGit(cwd, ["checkout", "-B", short, "--track", name]);
    } else {
      throw error;
    }
  }
  return readGitContext(cwd);
}

async function createGitBranch(
  cwd: string,
  branch: string,
  checkout = true,
): Promise<GitContextInfo> {
  const name = branch.trim();
  if (!name) throw new Error("分支名不能为空");
  if (checkout) await runGit(cwd, ["checkout", "-b", name]);
  else await runGit(cwd, ["branch", name]);
  return readGitContext(cwd);
}

async function listGitWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
  const out = await runGit(cwd, ["worktree", "list", "--porcelain"]);
  const items: GitWorktreeInfo[] = [];
  let current: Partial<GitWorktreeInfo> = {};
  const flush = () => {
    if (!current.path) return;
    const item: GitWorktreeInfo = {
      path: current.path,
      main: items.length === 0,
    };
    if (current.branch) item.branch = current.branch;
    if (current.bare) item.bare = true;
    items.push(item);
    current = {};
  };
  for (const line of out.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      flush();
      continue;
    }
    if (trimmed.startsWith("worktree ")) {
      if (current.path) flush();
      current.path = trimmed.slice("worktree ".length).trim();
    } else if (trimmed.startsWith("branch ")) {
      const ref = trimmed.slice("branch ".length).trim();
      current.branch = ref.replace(/^refs\/heads\//, "");
    } else if (trimmed === "bare") {
      current.bare = true;
    }
  }
  flush();
  return items;
}

async function createGitWorktree(
  cwd: string,
  options: { path: string; branch?: string; newBranch?: string },
): Promise<{ path: string; context: GitContextInfo }> {
  const target = options.path.trim();
  if (!target) throw new Error("工作树路径不能为空");
  const args = ["worktree", "add"];
  if (options.newBranch?.trim()) {
    args.push("-b", options.newBranch.trim(), target);
    if (options.branch?.trim()) args.push(options.branch.trim());
  } else if (options.branch?.trim()) {
    args.push(target, options.branch.trim());
  } else {
    args.push(target);
  }
  await runGit(cwd, args);
  return { path: target, context: readGitContext(target) };
}

interface DesktopPrefs {
  recentWorkspaces: string[];
  lastWorkspace?: string;
}

function prefsPath(): string {
  return join(app.getPath("userData"), "pix-desktop.json");
}

function isEphemeralWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/tmp/") ||
    normalized.includes("/var/folders/") ||
    normalized.includes("/pix-e2e-") ||
    normalized.includes("/pix-fake-") ||
    normalized.includes("/pix-test-") ||
    normalized.includes("/pix-p0") ||
    normalized.includes("/fork-probe") ||
    normalized.includes("/recent-ws-") ||
    normalized.includes("/other-workspace") ||
    /\/t\/pix-/.test(normalized)
  );
}

function durableWorkspacePath(cwd: string | undefined): string | undefined {
  if (!cwd || typeof cwd !== "string") return undefined;
  if (isEphemeralWorkspacePath(cwd)) return undefined;
  try {
    if (!existsSync(cwd)) return undefined;
  } catch {
    return undefined;
  }
  return cwd;
}

function saveDesktopPrefs(prefs: DesktopPrefs): void {
  const path = prefsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

/**
 * Load prefs and scrub fixture/temp paths left by older smoke launches.
 * If lastWorkspace is dead, fall back to the first durable recent project.
 */
function loadDesktopPrefs(): DesktopPrefs {
  try {
    const path = prefsPath();
    if (!existsSync(path)) return { recentWorkspaces: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DesktopPrefs;
    const rawRecent = Array.isArray(parsed.recentWorkspaces)
      ? parsed.recentWorkspaces.filter((item) => typeof item === "string")
      : [];
    const recentWorkspaces = rawRecent
      .map((item) => durableWorkspacePath(item))
      .filter((item): item is string => Boolean(item))
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, 8);
    const lastWorkspace =
      durableWorkspacePath(
        typeof parsed.lastWorkspace === "string" ? parsed.lastWorkspace : undefined,
      ) ?? recentWorkspaces[0];
    const cleaned: DesktopPrefs = {
      recentWorkspaces,
      ...(lastWorkspace ? { lastWorkspace } : {}),
    };
    // Persist scrub so a deleted /tmp workspace cannot keep blocking send/start.
    const dirty =
      JSON.stringify(parsed.recentWorkspaces ?? []) !== JSON.stringify(recentWorkspaces) ||
      parsed.lastWorkspace !== lastWorkspace;
    if (dirty) saveDesktopPrefs(cleaned);
    return cleaned;
  } catch {
    return { recentWorkspaces: [] };
  }
}

function rememberWorkspace(cwd: string): void {
  const prefs = loadDesktopPrefs();
  // Keep lastWorkspace for resume; only grow "recent" with durable project paths.
  const cleaned = prefs.recentWorkspaces.filter(
    (item) => item !== cwd && !isEphemeralWorkspacePath(item),
  );
  // Fixture / temp dirs must not become the cold-start resume target.
  if (isEphemeralWorkspacePath(cwd)) {
    const last = durableWorkspacePath(prefs.lastWorkspace) ?? cleaned[0];
    saveDesktopPrefs({
      recentWorkspaces: cleaned.slice(0, 8),
      ...(last ? { lastWorkspace: last } : {}),
    });
    return;
  }
  saveDesktopPrefs({ recentWorkspaces: [cwd, ...cleaned].slice(0, 8), lastWorkspace: cwd });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

interface ActiveHost {
  child: UtilityProcess;
  hostId: string;
  hello: Deferred<void>;
  exit: Deferred<number>;
  ignoreMessages: boolean;
  stopping: boolean;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

class HostSupervisor {
  #host: ActiveHost | undefined;
  #snapshot: HostSnapshot | undefined;
  #startPromise: Promise<HostSnapshot> | undefined;
  #previousRuntimeId: string | undefined;
  #sessionFile: string | undefined;
  #workspaceCwd: string | undefined;
  /**
   * When true, host.start() will not fall back to prefs.lastWorkspace.
   * Used for global "新建任务" blank state — user must pick a project first.
   */
  #requireExplicitWorkspace = false;
  #resumeRecent = false;
  #lastSequence = 0;
  #crashOnEvent: string | undefined;
  #eventCounts = new Map<string, number>();
  #pending = new Map<
    string,
    {
      resolve: (event: HostEvent) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private readonly window: BrowserWindow) {
    const prefs = loadDesktopPrefs();
    // Env fixture wins for smoke/e2e. Otherwise restore last durable workspace
    // (loadDesktopPrefs already falls back to first recent real project).
    this.#workspaceCwd =
      process.env.PIX_WORKSPACE ?? durableWorkspacePath(prefs.lastWorkspace) ?? undefined;
  }

  getWorkspaceCwd(): string | undefined {
    return this.#workspaceCwd;
  }

  removeRecentWorkspace(cwd: string): string[] {
    const prefs = loadDesktopPrefs();
    const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const recent = prefs.recentWorkspaces.filter(
      (item) => item.replace(/\\/g, "/").replace(/\/+$/, "") !== normalized,
    );
    const lastWorkspace =
      prefs.lastWorkspace?.replace(/\\/g, "/").replace(/\/+$/, "") === normalized
        ? undefined
        : prefs.lastWorkspace;
    saveDesktopPrefs({
      recentWorkspaces: recent,
      ...(lastWorkspace ? { lastWorkspace } : {}),
    });
    return recent;
  }

  listRecentWorkspaces(): string[] {
    const prefs = loadDesktopPrefs();
    // Only hide the *live* open project (active host cwd). Never hide lastWorkspace when
    // the user starts a global blank session — otherwise the project vanishes from the
    // sidebar (it used to only appear as "current", not in recent).
    const active = this.#workspaceCwd?.replace(/\\/g, "/").replace(/\/+$/, "");
    return prefs.recentWorkspaces
      .filter((item) => {
        if (typeof item !== "string" || isEphemeralWorkspacePath(item)) return false;
        if (!active) return true;
        const path = item.replace(/\\/g, "/").replace(/\/+$/, "");
        return path !== active;
      })
      .slice(0, 12);
  }

  start(options?: {
    cwd?: string;
    sessionFile?: string;
    resumeRecent?: boolean;
    force?: boolean;
  }): Promise<HostSnapshot> {
    if (options?.cwd) {
      this.#workspaceCwd = options.cwd;
      this.#requireExplicitWorkspace = false;
      // Workspace change invalidates a pinned session unless the caller supplies one.
      if (options.sessionFile === undefined) this.#sessionFile = undefined;
    }
    if (options?.sessionFile !== undefined) this.#sessionFile = options.sessionFile;
    if (options?.resumeRecent !== undefined) this.#resumeRecent = options.resumeRecent;
    if (!options?.force && this.#snapshot && !options?.cwd && options?.sessionFile === undefined) {
      return Promise.resolve(this.#snapshot);
    }
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#start(Boolean(options?.force || options?.cwd)).finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async openWorkspace(cwd: string, options?: { resumeRecent?: boolean }): Promise<HostSnapshot> {
    rememberWorkspace(cwd);
    this.#workspaceCwd = cwd;
    this.#requireExplicitWorkspace = false;
    // Drop any pinned session before stop; exit handler must not resurrect it for the new cwd.
    this.#sessionFile = undefined;
    this.#resumeRecent = options?.resumeRecent === true;
    await this.stop().catch(() => undefined);
    // stop()'s child exit path may have run after our pre-clear; re-assert intent.
    this.#sessionFile = undefined;
    this.#snapshot = undefined;
    this.#host = undefined;
    this.#resumeRecent = options?.resumeRecent === true;
    return this.start({
      cwd,
      resumeRecent: options?.resumeRecent === true,
      force: true,
    });
  }

  /**
   * Global "新建会话": detach from the live project session.
   * - Product: clear cwd so the next start requires an explicit project pick.
   * - Isolated/e2e (`PIX_WORKSPACE`): keep the fixture cwd for subsequent session.create.
   * Keeps the project on the recent list so it stays visible in the sidebar groups.
   */
  async clearActiveWorkspace(): Promise<void> {
    const previous = this.#workspaceCwd;
    await this.stop().catch(() => undefined);
    this.#sessionFile = undefined;
    this.#snapshot = undefined;
    this.#host = undefined;
    this.#resumeRecent = false;
    const fixture = process.env.PIX_WORKSPACE;
    if (fixture) {
      this.#workspaceCwd = fixture;
      this.#requireExplicitWorkspace = false;
    } else {
      this.#workspaceCwd = undefined;
      this.#requireExplicitWorkspace = true;
      // Ensure the project remains in recent (was often only shown as "current").
      if (previous && !isEphemeralWorkspacePath(previous)) {
        rememberWorkspace(previous);
      }
    }
  }

  async #start(forceSpawn = false): Promise<HostSnapshot> {
    if (forceSpawn && this.#host) {
      this.#host.stopping = true;
      this.#host.ignoreMessages = true;
      this.#host.child.kill();
      await this.#host.exit.promise.catch(() => undefined);
      this.#host = undefined;
      this.#snapshot = undefined;
    }
    const host = this.#host ?? this.#spawn();
    await Promise.race([
      host.hello.promise,
      delay(5_000).then(() => {
        throw new Error("Agent Host handshake timed out");
      }),
    ]);

    const cwd =
      process.env.PIX_WORKSPACE ??
      this.#workspaceCwd ??
      (this.#requireExplicitWorkspace
        ? undefined
        : durableWorkspacePath(loadDesktopPrefs().lastWorkspace));
    if (!cwd) {
      throw new Error("未选择工作区，请先从侧边栏打开文件夹");
    }
    this.#workspaceCwd = cwd;
    rememberWorkspace(cwd);
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "host.start",
      requestId: randomUUID(),
      cwd,
    };
    // Share CLI config: only override agentDir/model/tools when explicitly set
    // (isolated smoke/e2e). Product omits them → pi getAgentDir() + default tools/models.
    if (process.env.PI_CODING_AGENT_DIR) command.agentDir = process.env.PI_CODING_AGENT_DIR;
    const modelProvider = process.env.PIX_MODEL_PROVIDER;
    const modelId = process.env.PIX_MODEL_ID;
    if (modelProvider && modelId) command.model = { provider: modelProvider, id: modelId };
    if (process.env.PIX_TOOLS) {
      command.tools = process.env.PIX_TOOLS.split(",").map((tool) => tool.trim());
    }
    if (this.#sessionFile) command.sessionFile = this.#sessionFile;
    // Persist sessions like the CLI unless explicitly disabled.
    else if (process.env.PIX_PERSIST_SESSION !== "0") command.persistSession = true;
    if (this.#resumeRecent && !this.#sessionFile) command.resumeRecent = true;

    const event = await this.#request(command);
    if (event.type !== "host.ready")
      throw new Error("Agent Host returned an unexpected start response");
    this.#acceptSnapshot(event.snapshot);
    this.#resumeRecent = false;

    if (this.#previousRuntimeId) {
      const restarted: HostEvent = {
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "host.restarted",
        hostId: host.hostId,
        previousRuntimeId: this.#previousRuntimeId,
        snapshot: event.snapshot,
      };
      this.#previousRuntimeId = undefined;
      this.#emit(restarted);
    }
    return event.snapshot;
  }

  async snapshot(): Promise<HostSnapshot> {
    if (!this.#host) return this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "host.snapshot",
      requestId: randomUUID(),
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected snapshot response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async prompt(message: string): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "agent.prompt",
      requestId: randomUUID(),
      message,
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected prompt response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async abort(): Promise<HostSnapshot> {
    if (!this.#host) throw new Error("Agent Host is not running");
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "agent.abort",
      requestId: randomUUID(),
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected abort response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async listSessions(): Promise<{ threads: SessionThreadSummary[]; activeSessionId?: string }> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.list",
      requestId: randomUUID(),
    });
    if (event.type !== "session.list")
      throw new Error("Agent Host returned an unexpected session list response");
    const result: { threads: SessionThreadSummary[]; activeSessionId?: string } = {
      threads: event.threads,
    };
    if (event.activeSessionId !== undefined) result.activeSessionId = event.activeSessionId;
    return result;
  }

  async newSession(): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.new",
      requestId: randomUUID(),
    });
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.new response");
    this.#acceptSnapshot(event.snapshot);
    return { snapshot: event.snapshot, threads: event.threads, history: event.history };
  }

  async switchSession(sessionPath: string): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.switch",
      requestId: randomUUID(),
      sessionPath,
    });
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.switch response");
    this.#acceptSnapshot(event.snapshot);
    return { snapshot: event.snapshot, threads: event.threads, history: event.history };
  }

  async forkSession(entryId?: string): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.fork",
      requestId: randomUUID(),
    };
    if (entryId !== undefined) command.entryId = entryId;
    const event = await this.#request(command);
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.fork response");
    this.#acceptSnapshot(event.snapshot);
    return { snapshot: event.snapshot, threads: event.threads, history: event.history };
  }

  async listPackages(): Promise<PackageSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "packages.list",
      requestId: randomUUID(),
    });
    if (event.type !== "packages.list")
      throw new Error("Agent Host returned an unexpected packages.list response");
    return event.packages;
  }

  async installPackage(source: string, scope: "global" | "project"): Promise<PackageSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "packages.install",
      requestId: randomUUID(),
      source,
      scope,
    });
    if (event.type !== "packages.changed")
      throw new Error("Agent Host returned an unexpected packages.install response");
    return event.packages;
  }

  async removePackage(source: string, scope: "global" | "project"): Promise<PackageSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "packages.remove",
      requestId: randomUUID(),
      source,
      scope,
    });
    if (event.type !== "packages.changed")
      throw new Error("Agent Host returned an unexpected packages.remove response");
    return event.packages;
  }

  async updatePackage(source?: string): Promise<PackageSummary[]> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "packages.update",
      requestId: randomUUID(),
    };
    if (source !== undefined) command.source = source;
    const event = await this.#request(command);
    if (event.type !== "packages.changed")
      throw new Error("Agent Host returned an unexpected packages.update response");
    return event.packages;
  }

  async listResources(): Promise<ResourceSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "resources.list",
      requestId: randomUUID(),
    });
    if (event.type !== "resources.list")
      throw new Error("Agent Host returned an unexpected resources.list response");
    return event.resources;
  }

  async getTrust(): Promise<ProjectTrustSummary> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "trust.get",
      requestId: randomUUID(),
    });
    if (event.type !== "trust.info")
      throw new Error("Agent Host returned an unexpected trust.get response");
    return event.trust;
  }

  async setTrust(trusted: boolean): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "trust.set",
      requestId: randomUUID(),
      trusted,
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected trust.set response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async listModels(): Promise<ModelSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "model.list",
      requestId: randomUUID(),
    });
    if (event.type !== "model.list")
      throw new Error("Agent Host returned an unexpected model.list response");
    return event.models;
  }

  async setModel(provider: string, id: string): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "model.set",
      requestId: randomUUID(),
      provider,
      id,
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected model.set response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async setThinkingLevel(level: string): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "thinking.set",
      requestId: randomUUID(),
      level,
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected thinking.set response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async listProviders(): Promise<ProviderAuthSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.list",
      requestId: randomUUID(),
    });
    if (event.type !== "providers.list")
      throw new Error("Agent Host returned an unexpected providers.list response");
    return event.providers;
  }

  async setProviderApiKey(provider: string, apiKey: string): Promise<ProviderAuthSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.setApiKey",
      requestId: randomUUID(),
      provider,
      apiKey,
    });
    if (event.type !== "providers.list")
      throw new Error("Agent Host returned an unexpected providers.setApiKey response");
    return event.providers;
  }

  async clearProviderAuth(provider: string): Promise<ProviderAuthSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.clearAuth",
      requestId: randomUUID(),
      provider,
    });
    if (event.type !== "providers.list")
      throw new Error("Agent Host returned an unexpected providers.clearAuth response");
    return event.providers;
  }

  async getPiSettings(): Promise<PiSettingsView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "settings.get",
      requestId: randomUUID(),
    });
    if (event.type !== "settings.view")
      throw new Error("Agent Host returned an unexpected settings.get response");
    return event.settings;
  }

  async patchPiSettings(patch: PiSettingsPatch): Promise<PiSettingsView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "settings.patch",
      requestId: randomUUID(),
      patch,
    });
    if (event.type !== "settings.view")
      throw new Error("Agent Host returned an unexpected settings.patch response");
    return event.settings;
  }

  eventCounts(): Record<string, number> {
    return Object.fromEntries(this.#eventCounts);
  }

  armCrashOnEvent(eventType: string): void {
    if (process.env.PIX_ENABLE_TEST_COMMANDS !== "1") {
      throw new Error("Test crash commands are disabled");
    }
    this.#crashOnEvent = eventType;
  }

  async extensionUiRespond(response: ExtensionUiResponse): Promise<void> {
    const host = this.#host;
    if (!host || host.ignoreMessages || response.runtimeId !== this.#snapshot?.runtimeId) {
      throw new Error("Rejected stale Extension UI response");
    }
    host.child.postMessage({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "extensionUi.respond",
      requestId: randomUUID(),
      runtimeId: response.runtimeId,
      response,
    } satisfies HostCommand);
  }

  async photonProbe(imagePath: string): Promise<PhotonProbeResult> {
    if (process.env.PIX_ENABLE_TEST_COMMANDS !== "1") {
      throw new Error("Photon probe command is disabled");
    }
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "test.photonProbe",
      requestId: randomUUID(),
      imagePath,
    });
    if (event.type !== "test.photonResult") {
      throw new Error("Agent Host returned an unexpected photon probe response");
    }
    return event.result;
  }

  async probeSequenceGap(): Promise<HostSnapshot> {
    if (process.env.PIX_ENABLE_TEST_COMMANDS !== "1") {
      throw new Error("Sequence gap command is disabled");
    }
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "test.sequenceGap",
      requestId: randomUUID(),
    });
    if (event.type !== "runtime.snapshot") {
      throw new Error("Agent Host returned an unexpected sequence gap response");
    }
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async crashHost(): Promise<void> {
    if (process.env.PIX_ENABLE_TEST_COMMANDS !== "1") {
      throw new Error("Test crash commands are disabled");
    }
    const host = this.#host;
    if (!host) throw new Error("Agent Host is not running");
    host.ignoreMessages = true;
    host.child.kill();
    await host.exit.promise;
  }

  async stop(): Promise<void> {
    const host = this.#host;
    if (!host) return;
    host.stopping = true;
    try {
      await this.#request({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "host.shutdown",
        requestId: randomUUID(),
      });
    } finally {
      host.ignoreMessages = true;
      host.child.kill();
      await host.exit.promise;
      this.#snapshot = undefined;
      this.#rejectPending(new Error("Agent Host stopped"));
    }
  }

  #spawn(): ActiveHost {
    const hostEntry = join(currentDirectory, "..", "agent-host", "agent-host.mjs");
    const child = utilityProcess.fork(hostEntry, [], {
      env: processEnvironment(),
      serviceName: "Pix Agent Host",
      stdio: "pipe",
    });
    const host: ActiveHost = {
      child,
      hostId: randomUUID(),
      hello: deferred<void>(),
      exit: deferred<number>(),
      ignoreMessages: false,
      stopping: false,
    };
    this.#host = host;

    child.on("message", (message) => {
      if (this.#host !== host || host.ignoreMessages || !isHostEvent(message)) return;
      if (message.type === "host.hello") host.hello.resolve();
      if (message.type === "host.ready" || message.type === "runtime.snapshot") {
        this.#acceptSnapshot(message.snapshot);
      }
      if (message.type === "runtime.event") {
        if (this.#snapshot && message.runtimeId !== this.#snapshot.runtimeId) return;
        if (message.sequence !== this.#lastSequence + 1) {
          this.#count("runtime.gap");
          void this.snapshot().catch(() => undefined);
          return;
        }
        this.#lastSequence = message.sequence;
        this.#count(message.event.type);
      }
      if (message.type === "extensionUi.request") {
        this.#count("extensionUi.request");
        if (process.env.PIX_AUTO_EXTENSION_UI === "1") {
          const args =
            typeof message.args === "object" && message.args !== null
              ? (message.args as Record<string, unknown>)
              : {};
          const value =
            message.method === "confirm"
              ? true
              : message.method === "select" && Array.isArray(args.options)
                ? args.options[0]
                : message.method === "input" || message.method === "editor"
                  ? "pix-test-input"
                  : undefined;
          host.child.postMessage({
            protocolVersion: IPC_PROTOCOL_VERSION,
            type: "extensionUi.respond",
            requestId: randomUUID(),
            runtimeId: message.runtimeId,
            response: {
              runtimeId: message.runtimeId,
              requestId: message.requestId,
              ok: true,
              value,
            },
          } satisfies HostCommand);
        }
      }
      this.#emit(message, false);
      // Progress events share the parent requestId but are not the final response.
      if (message.type !== "packages.progress") {
        this.#resolvePending(message);
      }

      if (message.type === "runtime.event" && message.event.type === this.#crashOnEvent) {
        this.#crashOnEvent = undefined;
        host.ignoreMessages = true;
        host.child.kill();
      }
    });

    child.on("exit", (code) => {
      const exitCode = code ?? -1;
      host.exit.resolve(exitCode);
      if (this.#host !== host) return;
      this.#host = undefined;
      const runtimeId = this.#snapshot?.runtimeId;
      // Crash recovery may continue the same session file. Intentional stop / workspace
      // switch must not re-pin the previous session onto the next start.
      if (!host.stopping && this.#snapshot?.sessionFile) {
        this.#sessionFile = this.#snapshot.sessionFile;
      }
      this.#snapshot = undefined;
      this.#lastSequence = 0;
      const error = new Error(`Agent Host exited with code ${exitCode}`);
      host.hello.reject(error);
      this.#rejectPending(error);

      if (!host.stopping) {
        if (runtimeId) this.#previousRuntimeId = runtimeId;
        const crashed: HostEvent = {
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "host.crashed",
          hostId: host.hostId,
          exitCode,
          message: `Agent Host exited unexpectedly with code ${exitCode}`,
        };
        if (runtimeId) crashed.runtimeId = runtimeId;
        this.#emit(crashed);
      }
    });
    return host;
  }

  #acceptSnapshot(snapshot: HostSnapshot): void {
    this.#snapshot = snapshot;
    this.#lastSequence = snapshot.sequence;
    if (snapshot.sessionFile) this.#sessionFile = snapshot.sessionFile;
  }

  #request(command: HostCommand): Promise<HostEvent> {
    const host = this.#host;
    if (!host || host.ignoreMessages) return Promise.reject(new Error("Agent Host is not running"));

    return new Promise((resolve, reject) => {
      const timeoutMs =
        command.type === "agent.prompt"
          ? 300_000
          : command.type === "packages.install" ||
              command.type === "packages.remove" ||
              command.type === "packages.update"
            ? 180_000
            : 15_000;
      const timeout = setTimeout(() => {
        this.#pending.delete(command.requestId);
        reject(new Error(`Agent Host timed out handling ${command.type}`));
      }, timeoutMs);
      this.#pending.set(command.requestId, { resolve, reject, timeout });
      host.child.postMessage(command);
    });
  }

  #resolvePending(message: HostEvent): void {
    if (!("requestId" in message) || !message.requestId) return;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(message.requestId);
    if (message.type === "host.error") pending.reject(new Error(message.message));
    else pending.resolve(message);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #emit(event: HostEvent, count = true): void {
    if (count) this.#count(event.type);
    if (!this.window.isDestroyed()) this.window.webContents.send(HOST_EVENT_CHANNEL, event);
  }

  #count(type: string): void {
    this.#eventCounts.set(type, (this.#eventCounts.get(type) ?? 0) + 1);
  }
}

let mainWindow: BrowserWindow | undefined;
let supervisor: HostSupervisor | undefined;

async function waitForEventCount(
  hostSupervisor: HostSupervisor,
  eventType: string,
  minimum: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while ((hostSupervisor.eventCounts()[eventType] ?? 0) < minimum) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${eventType}`);
    await delay(10);
  }
}

async function expectRejected(operation: Promise<unknown>): Promise<boolean> {
  try {
    await operation;
    return false;
  } catch {
    return true;
  }
}

async function runCrashRecoveryProbe(
  hostSupervisor: HostSupervisor,
  initial: HostSnapshot,
): Promise<void> {
  const snapshots = [initial];

  await hostSupervisor.crashHost();
  snapshots.push(await hostSupervisor.start());

  const nextDelta = (hostSupervisor.eventCounts()["message.delta"] ?? 0) + 1;
  const messageOperation = hostSupervisor.prompt("ABORT while the host is streaming a message.");
  await waitForEventCount(hostSupervisor, "message.delta", nextDelta);
  await hostSupervisor.crashHost();
  const messagePendingRejected = await expectRejected(messageOperation);
  snapshots.push(await hostSupervisor.start());

  hostSupervisor.armCrashOnEvent("tool.started");
  const toolPendingRejected = await expectRejected(
    hostSupervisor.prompt("Use the read tool and crash during tool execution."),
  );
  snapshots.push(await hostSupervisor.start());
  const gapSnapshot = await hostSupervisor.probeSequenceGap();

  const runtimeIds = snapshots.map((snapshot) => snapshot.runtimeId);
  const sessionFiles = snapshots.map((snapshot) => snapshot.sessionFile);
  const report = {
    type: "pix.smoke.recovery",
    runtimeIds,
    runtimeIdsUnique: new Set(runtimeIds).size === runtimeIds.length,
    sessionIdsStable: new Set(snapshots.map((snapshot) => snapshot.sessionId)).size === 1,
    sessionFileStable:
      sessionFiles.every((sessionFile) => typeof sessionFile === "string") &&
      new Set(sessionFiles).size === 1,
    sessionFile: snapshots.at(-1)?.sessionFile,
    messagePendingRejected,
    toolPendingRejected,
    gapRecovered:
      gapSnapshot.runtimeId === snapshots.at(-1)?.runtimeId &&
      hostSupervisor.eventCounts()["runtime.gap"] === 1,
    windowAlive: !mainWindow?.isDestroyed(),
    eventCounts: hostSupervisor.eventCounts(),
  };
  if (
    !report.runtimeIdsUnique ||
    !report.sessionIdsStable ||
    !report.sessionFileStable ||
    !report.messagePendingRejected ||
    !report.toolPendingRejected ||
    !report.gapRecovered ||
    !report.windowAlive ||
    report.eventCounts["host.crashed"] !== 3 ||
    report.eventCounts["host.restarted"] !== 3
  ) {
    throw new Error("Crash recovery invariants failed");
  }
  console.log(JSON.stringify(report));
}

async function createWindow(): Promise<void> {
  // Keep in sync with apps/desktop/src/renderer/lib/desktop-chrome.ts (Synara-aligned).
  const titlebarHeight = 46;
  const trafficDotRadius = 7;
  const trafficLightPosition = {
    x: 16,
    y: Math.round(titlebarHeight / 2 - trafficDotRadius),
  };

  // Packaged: electron-builder embeds the app icon. Dev: load from build resources.
  const iconPath = existsSync(join(currentDirectory, "../../build/icon.png"))
    ? join(currentDirectory, "../../build/icon.png")
    : existsSync(join(currentDirectory, "../../../build/icon.png"))
      ? join(currentDirectory, "../../../build/icon.png")
      : undefined;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    title: "Pix",
    ...(iconPath && process.platform !== "darwin" ? { icon: iconPath } : {}),
    // macOS: traffic lights sit in the sidebar titlebar row (Synara/Codex style).
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition,
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "..", "preload", "preload.cjs"),
    },
  });
  supervisor = new HostSupervisor(mainWindow);
  await mainWindow.loadFile(join(currentDirectory, "..", "renderer", "index.html"));
}

void app
  .whenReady()
  .then(async () => {
    await createWindow();

    ipcMain.handle(
      "pix:host:start",
      (_event, options?: { cwd?: string; sessionFile?: string; resumeRecent?: boolean }) =>
        supervisor?.start(options),
    );
    ipcMain.handle("pix:host:snapshot", () => supervisor?.snapshot());
    ipcMain.handle("pix:host:stop", () => supervisor?.stop());
    ipcMain.handle("pix:workspace:get-cwd", () => supervisor?.getWorkspaceCwd());
    ipcMain.handle("pix:workspace:list-recent", () => supervisor?.listRecentWorkspaces());
    ipcMain.handle(
      "pix:workspace:open-path",
      (_event, cwd: string, options?: { resumeRecent?: boolean }) =>
        supervisor?.openWorkspace(cwd, options),
    );
    ipcMain.handle("pix:workspace:remove-recent", (_event, cwd: string) =>
      supervisor?.removeRecentWorkspace(cwd),
    );
    ipcMain.handle("pix:workspace:clear-active", () => supervisor?.clearActiveWorkspace());
    ipcMain.handle("pix:workspace:get-git-context", (_event, cwd?: string) => {
      const path =
        typeof cwd === "string" && cwd.trim() ? cwd : (supervisor?.getWorkspaceCwd() ?? undefined);
      return readGitContext(path);
    });
    ipcMain.handle("pix:workspace:list-git-branches", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return listGitBranches(path);
    });
    ipcMain.handle(
      "pix:workspace:checkout-git-branch",
      async (_event, branch: string, cwd?: string) => {
        const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
        return checkoutGitBranch(path, branch);
      },
    );
    ipcMain.handle(
      "pix:workspace:create-git-branch",
      async (_event, branch: string, options?: { checkout?: boolean; cwd?: string }) => {
        const path = resolveWorkspaceCwd(options?.cwd, supervisor?.getWorkspaceCwd());
        return createGitBranch(path, branch, options?.checkout !== false);
      },
    );
    ipcMain.handle("pix:workspace:list-git-worktrees", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return listGitWorktrees(path);
    });
    ipcMain.handle(
      "pix:workspace:create-git-worktree",
      async (
        _event,
        options: { path: string; branch?: string; newBranch?: string; cwd?: string },
      ) => {
        const path = resolveWorkspaceCwd(options?.cwd, supervisor?.getWorkspaceCwd());
        return createGitWorktree(path, options);
      },
    );
    ipcMain.handle("pix:workspace:reveal-in-folder", (_event, cwd: string) => {
      if (typeof cwd === "string" && cwd.trim()) shell.showItemInFolder(cwd);
    });
    ipcMain.handle("pix:workspace:pick-folder", async () => {
      if (!mainWindow) return undefined;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return undefined;
      return result.filePaths[0];
    });
    ipcMain.handle("pix:trust:get", () => supervisor?.getTrust());
    ipcMain.handle("pix:trust:set", (_event, trusted: boolean) => supervisor?.setTrust(trusted));
    ipcMain.handle("pix:models:list", () => supervisor?.listModels());
    ipcMain.handle("pix:models:set", (_event, provider: string, id: string) =>
      supervisor?.setModel(provider, id),
    );
    ipcMain.handle("pix:thinking:set", (_event, level: string) =>
      supervisor?.setThinkingLevel(level),
    );
    ipcMain.handle("pix:providers:list", () => supervisor?.listProviders());
    ipcMain.handle("pix:providers:set-api-key", (_event, provider: string, apiKey: string) =>
      supervisor?.setProviderApiKey(provider, apiKey),
    );
    ipcMain.handle("pix:providers:clear-auth", (_event, provider: string) =>
      supervisor?.clearProviderAuth(provider),
    );
    ipcMain.handle("pix:settings:get", () => supervisor?.getPiSettings());
    ipcMain.handle("pix:settings:patch", (_event, patch: PiSettingsPatch) =>
      supervisor?.patchPiSettings(patch),
    );
    ipcMain.handle("pix:agent:prompt", (_event, message: string) => supervisor?.prompt(message));
    ipcMain.handle("pix:agent:abort", () => supervisor?.abort());
    ipcMain.handle("pix:session:list", () => supervisor?.listSessions());
    ipcMain.handle("pix:session:list-for-cwd", async (_event, cwd: string) => {
      if (typeof cwd !== "string" || !cwd.trim()) return [];
      // Import agent-runtime (pi stays external in the main bundle — see vite.main.config).
      const { listProjectSessions } = await import("@pix/agent-runtime");
      let activeSessionId: string | undefined;
      try {
        const current = supervisor?.getWorkspaceCwd();
        if (current && current.replace(/\\/g, "/") === cwd.replace(/\\/g, "/")) {
          const listed = await supervisor?.listSessions();
          activeSessionId = listed?.activeSessionId;
        }
      } catch {
        // host may be stopped
      }
      return listProjectSessions(cwd, activeSessionId ? { activeSessionId } : undefined);
    });
    ipcMain.handle("pix:session:new", () => supervisor?.newSession());
    ipcMain.handle("pix:session:switch", (_event, sessionPath: string) =>
      supervisor?.switchSession(sessionPath),
    );
    ipcMain.handle("pix:session:fork", (_event, entryId?: string) =>
      supervisor?.forkSession(entryId),
    );
    ipcMain.handle("pix:packages:list", () => supervisor?.listPackages());
    ipcMain.handle("pix:packages:install", (_event, source: string, scope: "global" | "project") =>
      supervisor?.installPackage(source, scope),
    );
    ipcMain.handle("pix:packages:remove", (_event, source: string, scope: "global" | "project") =>
      supervisor?.removePackage(source, scope),
    );
    ipcMain.handle("pix:packages:update", (_event, source?: string) =>
      supervisor?.updatePackage(source),
    );
    ipcMain.handle("pix:resources:list", () => supervisor?.listResources());
    ipcMain.handle("pix:extension-ui:respond", (_event, response: ExtensionUiResponse) =>
      supervisor?.extensionUiRespond(response),
    );
    if (process.env.PIX_ENABLE_TEST_COMMANDS === "1") {
      ipcMain.handle("pix:test:crash-host", () => supervisor?.crashHost());
    }

    if (process.env.PIX_AUTO_START === "1") {
      const snapshot = await supervisor?.start();
      console.log(
        JSON.stringify({
          type: "pix.smoke.ready",
          runtimeId: snapshot?.runtimeId,
          resourceCounts: snapshot?.resources,
        }),
      );

      if (process.env.PIX_PHOTON_PROBE_IMAGE && supervisor) {
        const result = await supervisor.photonProbe(process.env.PIX_PHOTON_PROBE_IMAGE);
        if (
          result.extensions !== 1 ||
          result.extensionDiagnostics !== 0 ||
          result.input.width !== 2 ||
          result.input.height !== 2 ||
          result.output.width !== 1 ||
          result.output.height !== 1 ||
          result.output.bytes <= 0
        ) {
          throw new Error("Photon probe invariants failed");
        }
        console.log(JSON.stringify({ type: "pix.smoke.photon", ...result }));
      }

      if (process.env.PIX_AUTO_PROMPT && supervisor) {
        let completed = await supervisor.prompt(process.env.PIX_AUTO_PROMPT);

        if (process.env.PIX_AUTO_ABORT === "1") {
          const nextDelta = (supervisor.eventCounts()["message.delta"] ?? 0) + 1;
          const abortPrompt = supervisor.prompt("ABORT this response after its first delta.");
          await waitForEventCount(supervisor, "message.delta", nextDelta);
          await supervisor.abort();
          completed = await abortPrompt;
        }

        console.log(
          JSON.stringify({
            type: "pix.smoke.runtime",
            sequence: completed.sequence,
            eventCounts: supervisor.eventCounts(),
          }),
        );

        if (process.env.PIX_AUTO_CRASH_PROBE === "1")
          await runCrashRecoveryProbe(supervisor, completed);
      }
    } else if (process.env.PIX_NO_AUTO_RESUME !== "1" && supervisor) {
      // Product cold start: restore last durable workspace and continue recent pi session.
      // Skip ephemeral fixture paths and missing directories.
      const cwd = durableWorkspacePath(supervisor.getWorkspaceCwd());
      if (cwd) {
        try {
          const snapshot = await supervisor.start({
            cwd,
            resumeRecent: true,
            force: true,
          });
          console.log(
            JSON.stringify({
              type: "pix.m2.auto_resume",
              cwd: snapshot.cwd,
              sessionId: snapshot.sessionId,
              sessionFile: snapshot.sessionFile,
            }),
          );
        } catch (error) {
          console.warn("Pix auto-resume skipped", error);
        }
      }
    }

    const autoCloseMs = Number.parseInt(process.env.PIX_AUTO_CLOSE_MS ?? "", 10);
    if (Number.isFinite(autoCloseMs) && autoCloseMs > 0) setTimeout(() => app.quit(), autoCloseMs);
  })
  .catch((error: unknown) => {
    console.error("Pix failed to initialize", error);
    app.exit(1);
  });

app.on("before-quit", (event) => {
  if (!supervisor) return;
  event.preventDefault();
  const activeSupervisor = supervisor;
  supervisor = undefined;
  void activeSupervisor.stop().finally(() => app.exit(0));
});

app.on("window-all-closed", () => app.quit());
