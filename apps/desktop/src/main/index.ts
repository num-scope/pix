import {
  IPC_PROTOCOL_VERSION,
  type ExtensionUiResponse,
  type CatalogPackage,
  type DetectedApp,
  type GitBranchInfo,
  type GitChangeItem,
  type GitContextInfo,
  type GitStatusSummary,
  type GitWorktreeInfo,
  type HostCommand,
  type HostEvent,
  type HostSnapshot,
  type ModelSummary,
  type ModelsJsonConfigView,
  type PhotonProbeResult,
  type PackageSummary,
  type PiSettingsPatch,
  type PiSettingsPatchResult,
  type PiSettingsView,
  type ProjectTrustSummary,
  type ProviderAuthSummary,
  type ProviderUsageSnapshot,
  type ResourceSummary,
  type ScopedModelView,
  type SessionBashResult,
  type SessionExportResult,
  type SessionHistoryMessage,
  type SessionInfoView,
  type SessionShareResult,
  type SessionThreadSummary,
  type SessionTreeView,
  type UpsertCustomProviderInput,
  isHostEvent,
} from "@pix/contracts";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  utilityProcess,
  type NativeImage,
  type UtilityProcess,
} from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ensurePiCli, type PiCliProgressEvent } from "./pi-cli-ensure.ts";

const execFileAsync = promisify(execFile);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const HOST_EVENT_CHANNEL = "pix:host:event";
const PI_PROGRESS_CHANNEL = "pix:pi:progress";

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

const WORKSPACE_SEARCH_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "release",
]);

/**
 * Paths for the `@` mention menu: prefer `git ls-files`, fall back to a shallow walk.
 */
async function searchWorkspacePaths(
  cwd: string,
  query: string,
  limit = 24,
): Promise<Array<{ path: string; relative: string; kind: "file" | "folder" }>> {
  if (!cwd || !existsSync(cwd)) return [];
  const needle = query.trim().toLocaleLowerCase();
  const cap = Math.max(1, Math.min(limit, 80));

  let candidates: string[] = [];
  try {
    const tracked = await runGit(cwd, ["ls-files", "-z"]);
    const others = await runGit(cwd, ["ls-files", "-z", "--others", "--exclude-standard"]);
    const seen = new Set<string>();
    for (const block of [tracked, others]) {
      for (const rel of block.split("\0")) {
        const r = rel.trim().replace(/\\/g, "/");
        if (!r || seen.has(r)) continue;
        seen.add(r);
        candidates.push(r);
      }
    }
  } catch {
    candidates = [];
  }

  if (candidates.length === 0) {
    // Shallow fallback walk (depth-limited).
    const walk = (dir: string, prefix: string, depth: number) => {
      if (depth > 4 || candidates.length >= 2000) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name.startsWith(".") || WORKSPACE_SEARCH_SKIP.has(name)) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        const abs = join(dir, name);
        let isDir = false;
        try {
          isDir = lstatSync(abs).isDirectory();
        } catch {
          continue;
        }
        candidates.push(rel.replace(/\\/g, "/"));
        if (isDir) walk(abs, rel.replace(/\\/g, "/"), depth + 1);
      }
    };
    walk(cwd, "", 0);
  }

  const scored = candidates
    .filter((rel) => {
      if (!needle) return true;
      return rel.toLocaleLowerCase().includes(needle);
    })
    .map((rel) => {
      const base = rel.split("/").pop() ?? rel;
      const lower = rel.toLocaleLowerCase();
      const baseLower = base.toLocaleLowerCase();
      let score = 2;
      if (needle) {
        if (baseLower.startsWith(needle)) score = 0;
        else if (baseLower.includes(needle)) score = 1;
        else if (lower.includes(needle)) score = 2;
      }
      return { rel, score, base };
    })
    .sort((a, b) => a.score - b.score || a.rel.localeCompare(b.rel))
    .slice(0, cap);

  const out: Array<{ path: string; relative: string; kind: "file" | "folder" }> = [];
  for (const item of scored) {
    const abs = resolve(cwd, item.rel);
    if (!existsSync(abs)) continue;
    let kind: "file" | "folder" = "file";
    try {
      kind = lstatSync(abs).isDirectory() ? "folder" : "file";
    } catch {
      continue;
    }
    out.push({ path: abs, relative: item.rel, kind });
  }
  return out;
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
  const name = applyBranchPrefix(branch);
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

function defaultWorktreeRootForRepo(repoCwd: string): string {
  const repoName = basename(repoCwd.replace(/\\/g, "/").replace(/\/+$/, "")) || "repo";
  return join(app.getPath("documents"), "Pix", "worktrees", repoName);
}

function resolveWorktreeRoot(repoCwd: string, configured?: string): string {
  const custom = configured?.trim();
  if (custom) return custom;
  return defaultWorktreeRootForRepo(repoCwd);
}

function uniqueWorktreePath(root: string, baseName: string): string {
  mkdirSync(root, { recursive: true });
  const safe = baseName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || localDateFolderName();
  let path = join(root, safe);
  if (!existsSync(path)) return path;
  let n = 2;
  while (existsSync(join(root, `${safe}-${n}`))) n += 1;
  return join(root, `${safe}-${n}`);
}

function getWorktreePrefsView(repoCwd?: string): WorktreePrefs {
  const prefs = loadDesktopPrefs();
  const configured = prefs.worktreeRoot?.trim() ?? "";
  const sampleCwd = repoCwd?.trim() || app.getPath("documents");
  const defaultRoot = defaultWorktreeRootForRepo(sampleCwd);
  const limit =
    typeof prefs.worktreeAutoDeleteLimit === "number" &&
    Number.isFinite(prefs.worktreeAutoDeleteLimit)
      ? Math.min(100, Math.max(1, Math.floor(prefs.worktreeAutoDeleteLimit)))
      : 10;
  return {
    root: resolveWorktreeRoot(sampleCwd, configured),
    rootConfigured: configured,
    // Default ON (recommended) when never set.
    autoDelete: prefs.worktreeAutoDelete !== false,
    autoDeleteLimit: limit,
    defaultRoot,
  };
}

function setWorktreePrefs(patch: {
  rootConfigured?: string;
  autoDelete?: boolean;
  autoDeleteLimit?: number;
}): WorktreePrefs {
  const prefs = loadDesktopPrefs();
  if (patch.rootConfigured !== undefined) {
    const v = patch.rootConfigured.trim();
    if (v) prefs.worktreeRoot = v;
    else delete prefs.worktreeRoot;
  }
  if (patch.autoDelete !== undefined) prefs.worktreeAutoDelete = patch.autoDelete;
  if (patch.autoDeleteLimit !== undefined) {
    prefs.worktreeAutoDeleteLimit = Math.min(100, Math.max(1, Math.floor(patch.autoDeleteLimit)));
  }
  saveDesktopPrefs(prefs);
  return getWorktreePrefsView();
}

function getGitPrefs(): GitPrefs {
  const prefs = loadDesktopPrefs();
  return {
    branchPrefix: prefs.gitBranchPrefix?.trim() || "pix/",
    pullMode: prefs.gitPullMode === "squash" ? "squash" : "merge",
    forcePush: prefs.gitForcePush === true,
    draftPr: prefs.gitDraftPr === true,
    customCommitCommand: prefs.gitCustomCommitCommand?.trim() ?? "",
    customPrCommand: prefs.gitCustomPrCommand?.trim() ?? "",
    modelProvider: prefs.gitModelProvider?.trim() ?? "",
    modelId: prefs.gitModelId?.trim() ?? "",
  };
}

function setGitPrefs(patch: Partial<GitPrefs>): GitPrefs {
  const prefs = loadDesktopPrefs();
  if (patch.branchPrefix !== undefined) {
    const v = patch.branchPrefix.trim();
    if (v) prefs.gitBranchPrefix = v;
    else delete prefs.gitBranchPrefix;
  }
  if (patch.pullMode !== undefined) {
    prefs.gitPullMode = patch.pullMode === "squash" ? "squash" : "merge";
  }
  if (patch.forcePush !== undefined) prefs.gitForcePush = patch.forcePush;
  if (patch.draftPr !== undefined) prefs.gitDraftPr = patch.draftPr;
  if (patch.customCommitCommand !== undefined) {
    const v = patch.customCommitCommand.trim();
    if (v) prefs.gitCustomCommitCommand = v;
    else delete prefs.gitCustomCommitCommand;
  }
  if (patch.customPrCommand !== undefined) {
    const v = patch.customPrCommand.trim();
    if (v) prefs.gitCustomPrCommand = v;
    else delete prefs.gitCustomPrCommand;
  }
  if (patch.modelProvider !== undefined || patch.modelId !== undefined) {
    const provider = (patch.modelProvider ?? prefs.gitModelProvider ?? "").trim();
    const id = (patch.modelId ?? prefs.gitModelId ?? "").trim();
    if (provider && id) {
      prefs.gitModelProvider = provider;
      prefs.gitModelId = id;
    } else {
      delete prefs.gitModelProvider;
      delete prefs.gitModelId;
    }
  }
  saveDesktopPrefs(prefs);
  return getGitPrefs();
}

function applyBranchPrefix(name: string): string {
  const raw = name.trim();
  if (!raw) return raw;
  const prefix = getGitPrefs().branchPrefix;
  if (!prefix) return raw;
  if (raw.startsWith(prefix)) return raw;
  return `${prefix}${raw}`;
}

/** Remove oldest managed linked worktrees under root until count <= limit. Never removes main. */
async function pruneManagedWorktrees(repoCwd: string): Promise<void> {
  const prefs = loadDesktopPrefs();
  // Default ON when unset; only skip when user explicitly disabled.
  if (prefs.worktreeAutoDelete === false) return;
  const limit =
    typeof prefs.worktreeAutoDeleteLimit === "number" &&
    Number.isFinite(prefs.worktreeAutoDeleteLimit)
      ? Math.min(100, Math.max(1, Math.floor(prefs.worktreeAutoDeleteLimit)))
      : 10;
  const root = resolveWorktreeRoot(repoCwd, prefs.worktreeRoot).replace(/\\/g, "/");
  const items = await listGitWorktrees(repoCwd);
  const managed = items
    .filter((w) => !w.main && !w.bare)
    .map((w) => ({
      path: w.path,
      key: w.path.replace(/\\/g, "/").replace(/\/+$/, ""),
    }))
    .filter((w) => w.key === root || w.key.startsWith(`${root}/`));
  if (managed.length <= limit) return;
  // Prefer removing oldest by directory mtime when available.
  const ranked = managed
    .map((w) => {
      let mtime = 0;
      try {
        mtime = lstatSync(w.path).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { ...w, mtime };
    })
    .sort((a, b) => a.mtime - b.mtime);
  const toRemove = ranked.slice(0, Math.max(0, ranked.length - limit));
  for (const item of toRemove) {
    try {
      await runGit(repoCwd, ["worktree", "remove", "--force", item.path]);
    } catch {
      // best-effort
    }
  }
}

async function createGitWorktree(
  cwd: string,
  options: { path?: string; branch?: string; newBranch?: string },
): Promise<{ path: string; context: GitContextInfo }> {
  const prefs = loadDesktopPrefs();
  let target = options.path?.trim() ?? "";
  if (!target) {
    const root = resolveWorktreeRoot(cwd, prefs.worktreeRoot);
    const base = options.newBranch?.trim() || options.branch?.trim() || localDateFolderName();
    target = uniqueWorktreePath(root, base);
  }
  if (!target) throw new Error("工作树路径不能为空");
  mkdirSync(dirname(target), { recursive: true });
  const args = ["worktree", "add"];
  if (options.newBranch?.trim()) {
    args.push("-b", applyBranchPrefix(options.newBranch), target);
    if (options.branch?.trim()) args.push(options.branch.trim());
  } else if (options.branch?.trim()) {
    args.push(target, options.branch.trim());
  } else {
    args.push(target);
  }
  await runGit(cwd, args);
  await pruneManagedWorktrees(cwd);
  return { path: target, context: readGitContext(target) };
}

async function gitStatus(cwd: string): Promise<GitStatusSummary> {
  const branchOut = (
    await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")
  ).trim();
  const porcelain = await runGit(cwd, ["status", "--porcelain", "-b"]).catch(() => "");
  const lines = porcelain.split("\n").filter(Boolean);
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  const changes: GitChangeItem[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      // ## main...origin/main [ahead 1, behind 2]
      const head = line.slice(3);
      const dots = head.indexOf("...");
      const branchPart = dots >= 0 ? head.slice(0, dots) : head.split(" ")[0];
      void branchPart;
      if (dots >= 0) {
        const rest = head.slice(dots + 3);
        const up = rest.split(/[\s[]/)[0]?.trim();
        if (up) upstream = up;
      }
      const aheadM = /ahead (\d+)/.exec(head);
      const behindM = /behind (\d+)/.exec(head);
      if (aheadM) ahead = Number(aheadM[1]);
      if (behindM) behind = Number(behindM[1]);
      continue;
    }
    // XY path  or XY orig -> path
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    const staged = code[0] !== " " && code[0] !== "?";
    const status =
      code.trim() === "??"
        ? "??"
        : code[0] !== " " && code[0] !== "?"
          ? code[0]
          : code[1] || code[0];
    changes.push({ path, status: status || "M", staged });
  }
  let insertions = 0;
  let deletions = 0;
  try {
    const numstat = await runGit(cwd, ["diff", "--numstat", "HEAD"]);
    for (const line of numstat.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const a = parts[0] === "-" ? 0 : Number(parts[0]);
      const d = parts[1] === "-" ? 0 : Number(parts[1]);
      if (Number.isFinite(a)) insertions += a;
      if (Number.isFinite(d)) deletions += d;
    }
    // Untracked files not in HEAD diff — count roughly as additions via status ??
    const untracked = changes.filter((c) => c.status === "??").length;
    if (untracked > 0 && insertions === 0 && deletions === 0) {
      // leave zeros; file list still shows under expanded changes
    }
  } catch {
    // no commits yet or not a repo
  }

  const summary: GitStatusSummary = {
    ahead,
    behind,
    changes,
    clean: changes.length === 0,
    insertions,
    deletions,
  };
  if (branchOut && branchOut !== "HEAD") summary.branch = branchOut;
  if (upstream) summary.upstream = upstream;
  return summary;
}

const DEFAULT_COMMIT_INSTRUCTION =
  "Write a concise git commit message for the changes below. Prefer conventional commits when appropriate. Output only the commit message text — no quotes, markdown fences, or commentary.";

async function generateCommitMessage(cwd: string): Promise<string> {
  if (!supervisor) throw new Error("Agent Host is not ready");
  const git = getGitPrefs();
  const instruction = git.customCommitCommand.trim() || DEFAULT_COMMIT_INSTRUCTION;
  const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
  const status = await gitStatus(cwd);
  const fileList =
    status.changes.length > 0
      ? status.changes.map((c) => `${c.status} ${c.path}`).join("\n")
      : "(no listed changes)";
  // Prefer unstaged+staged combined view; keep size bounded for the model.
  const diff =
    (await runGit(cwd, ["diff", "HEAD"]).catch(async () =>
      runGit(cwd, ["diff"]).catch(() => ""),
    )) || "";
  const truncatedDiff = diff.length > 14_000 ? `${diff.slice(0, 14_000)}\n…(truncated)` : diff;
  const prompt = [
    instruction,
    "",
    `Repository: ${cwd}`,
    `Branch: ${branch || "(unknown)"}`,
    "",
    "Changed files:",
    fileList,
    "",
    "Diff:",
    truncatedDiff || "(empty diff)",
    "",
    "Reply with ONLY the commit message.",
  ].join("\n");

  const text = await supervisor.completeText(prompt, {
    systemPrompt:
      "You write git commit messages. Follow the user instruction carefully. Output only the commit message text.",
    ...(git.modelProvider && git.modelId
      ? { model: { provider: git.modelProvider, id: git.modelId } }
      : {}),
  });
  // Strip accidental fences / quotes
  return text
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

async function gitCommit(cwd: string, message: string): Promise<GitStatusSummary> {
  let msg = message.trim();
  if (!msg) {
    msg = await generateCommitMessage(cwd);
  }
  if (!msg) throw new Error("无法生成提交说明");
  await runGit(cwd, ["add", "-A"]);
  await runGit(cwd, ["commit", "-m", msg]);
  return gitStatus(cwd);
}

async function gitPull(cwd: string): Promise<GitStatusSummary> {
  const mode = getGitPrefs().pullMode;
  if (mode === "squash") {
    await runGit(cwd, ["pull", "--squash"]);
  } else {
    // Merge strategy (allow non-ff merges).
    await runGit(cwd, ["pull", "--no-rebase", "--no-ff"]);
  }
  return gitStatus(cwd);
}

async function gitPush(cwd: string): Promise<GitStatusSummary> {
  const force = getGitPrefs().forcePush;
  if (force) {
    await runGit(cwd, ["push", "--force", "-u", "HEAD"]);
  } else {
    await runGit(cwd, ["push", "-u", "HEAD"]);
  }
  return gitStatus(cwd);
}

async function gitCommitAndPush(cwd: string, message: string): Promise<GitStatusSummary> {
  await gitCommit(cwd, message);
  return gitPush(cwd);
}

async function openCreatePullRequest(cwd: string): Promise<void> {
  const git = getGitPrefs();
  const remote = (await runGit(cwd, ["remote", "get-url", "origin"]).catch(() => "")).trim();
  const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
  // customPrCommand is an AI prompt for PR helpers — not a shell command.
  if (!remote) throw new Error("未配置 origin 远程");
  let url = remote;
  if (url.startsWith("git@")) {
    // git@github.com:org/repo.git
    url = url.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
  } else {
    url = url.replace(/\.git$/, "");
  }
  if (url.includes("github.com") && branch) {
    const draft = git.draftPr ? "&draft=true" : "";
    url = `${url}/compare/${encodeURIComponent(branch)}?expand=1${draft}`;
  } else if (url.includes("gitlab") && branch) {
    const draft = git.draftPr ? "&merge_request[draft]=true" : "";
    url = `${url}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}${draft}`;
  }
  await shell.openExternal(url);
}

/** Resolve a macOS .app bundle path (Applications + System Utilities + ~/Applications). */
function resolveMacAppPath(appName: string): string | undefined {
  const names = [appName];
  // Common aliases
  if (appName === "iTerm") names.push("iTerm2");
  if (appName === "iTerm2") names.push("iTerm");
  const roots = [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
    join(homedir(), "Applications"),
  ];
  for (const root of roots) {
    for (const name of names) {
      const p = join(root, `${name}.app`);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

function isUsableIconDataUrl(data: string | undefined): data is string {
  // Reject empty / tiny payloads (broken extract) so UI can fall back to lucide icons.
  return Boolean(data && data.startsWith("data:image/") && data.length > 200);
}

function nativeImageToPngDataUrl(img: NativeImage): string | undefined {
  if (img.isEmpty()) return undefined;
  try {
    const size = img.getSize();
    if (!size.width || !size.height) return undefined;
    // Normalize chip size — some ICNS frames are huge / multi-resolution.
    let out = img;
    if (size.width > 64 || size.height > 64) {
      out = img.resize({ width: 64, height: 64, quality: "best" });
    } else if (size.width > 0 && size.width < 32) {
      out = img.resize({ width: 32, height: 32, quality: "best" });
    }
    const png = out.toPNG();
    if (!png?.length) {
      const url = out.toDataURL();
      return isUsableIconDataUrl(url) ? url : undefined;
    }
    const data = `data:image/png;base64,${png.toString("base64")}`;
    return isUsableIconDataUrl(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

async function fileIconDataUrl(filePath: string): Promise<string | undefined> {
  try {
    // Prefer large size for crisp 20px chips after downscale.
    const img = await app.getFileIcon(filePath, { size: "large" });
    return nativeImageToPngDataUrl(img);
  } catch {
    return undefined;
  }
}

/** Convert .icns/.png via macOS `sips` — more reliable than nativeImage for some ICNS. */
async function sipsIconDataUrl(iconPath: string): Promise<string | undefined> {
  const out = join(tmpdir(), `pix-icon-${randomUUID()}.png`);
  try {
    await execFileAsync("sips", ["-s", "format", "png", "-z", "64", "64", iconPath, "--out", out], {
      windowsHide: true,
      timeout: 4_000,
    });
    if (!existsSync(out)) return undefined;
    const buf = readFileSync(out);
    if (!buf.length) return undefined;
    const data = `data:image/png;base64,${buf.toString("base64")}`;
    return isUsableIconDataUrl(data) ? data : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      unlinkSync(out);
    } catch {
      // ignore
    }
  }
}

/** Read CFBundleIconFile / CFBundleIconName from a macOS .app Info.plist. */
async function macBundleIconBaseName(appPath: string): Promise<string | undefined> {
  const plist = join(appPath, "Contents", "Info.plist");
  if (!existsSync(plist)) return undefined;
  for (const key of ["CFBundleIconFile", "CFBundleIconName"] as const) {
    try {
      const { stdout } = await execFileAsync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
        windowsHide: true,
      });
      const name = stdout.trim();
      if (name) return name;
    } catch {
      // key missing
    }
  }
  return undefined;
}

function resolveMacIcnsPath(appPath: string, iconBase: string): string | undefined {
  const resources = join(appPath, "Contents", "Resources");
  const base = iconBase.replace(/\.icns$/i, "");
  const candidates = [
    join(resources, iconBase),
    join(resources, `${base}.icns`),
    join(resources, `${base}.png`),
    join(resources, `${base}.ico`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Prefer the largest .icns under Contents/Resources (real app art, not generic). */
function findLargestMacIcns(appPath: string): string | undefined {
  const resources = join(appPath, "Contents", "Resources");
  if (!existsSync(resources)) return undefined;
  let best: { path: string; size: number } | undefined;
  try {
    for (const name of readdirSync(resources)) {
      if (!name.toLowerCase().endsWith(".icns")) continue;
      const p = join(resources, name);
      try {
        const st = lstatSync(p);
        if (!st.isFile()) continue;
        if (!best || st.size > best.size) best = { path: p, size: st.size };
      } catch {
        // skip
      }
    }
  } catch {
    return undefined;
  }
  return best?.path;
}

/** Successful icon data URLs only — never cache failures forever. */
const macAppIconCache = new Map<string, string>();

/**
 * Quick Look thumbnail of the .app (works for asset-catalog icons that have no loose .icns).
 * Hard-capped: never block the env panel for seconds per app.
 */
async function qlmanageAppIconDataUrl(appPath: string): Promise<string | undefined> {
  const outDir = join(tmpdir(), "pix-app-icons");
  try {
    mkdirSync(outDir, { recursive: true });
    await execFileAsync("qlmanage", ["-t", "-s", "64", "-o", outDir, appPath], {
      windowsHide: true,
      timeout: 2_500,
    });
    const expected = join(outDir, `${basename(appPath)}.png`);
    let pngPath = existsSync(expected) ? expected : undefined;
    if (!pngPath) {
      const stem = basename(appPath, ".app").toLowerCase();
      const hit = readdirSync(outDir).find(
        (f) => f.toLowerCase().includes(stem) && f.endsWith(".png"),
      );
      if (hit) pngPath = join(outDir, hit);
    }
    if (!pngPath || !existsSync(pngPath)) return undefined;
    // Prefer raw file bytes (reliable) over nativeImage re-encode.
    const buf = readFileSync(pngPath);
    if (!buf.length) return undefined;
    const data = `data:image/png;base64,${buf.toString("base64")}`;
    return isUsableIconDataUrl(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

async function iconFromFilePath(iconPath: string): Promise<string | undefined> {
  // 1) Electron nativeImage
  const fromNi = nativeImageToPngDataUrl(nativeImage.createFromPath(iconPath));
  if (fromNi) return fromNi;
  // 2) sips re-encode (handles many ICNS cases nativeImage mishandles)
  return sipsIconDataUrl(iconPath);
}

/**
 * Real macOS app icons for "Open in…".
 * Order: ICNS/sips → getFileIcon(.app) → Quick Look.
 */
async function macAppIconDataUrl(appPath: string): Promise<string | undefined> {
  if (!appPath || !existsSync(appPath)) return undefined;
  const cached = macAppIconCache.get(appPath);
  if (cached) return cached;

  try {
    // 1) Info.plist → Resources icon file
    const iconBase = await macBundleIconBaseName(appPath);
    const fromPlist = iconBase ? resolveMacIcnsPath(appPath, iconBase) : undefined;
    if (fromPlist) {
      const data = await iconFromFilePath(fromPlist);
      if (data) {
        macAppIconCache.set(appPath, data);
        return data;
      }
    }

    // 2) Largest loose .icns (skip tiny utility icons when possible)
    const largest = findLargestMacIcns(appPath);
    if (largest && largest !== fromPlist) {
      const data = await iconFromFilePath(largest);
      if (data) {
        macAppIconCache.set(appPath, data);
        return data;
      }
    }

    // 3) OS icon for the .app bundle (correct for most modern apps)
    const fromOs = await fileIconDataUrl(appPath);
    if (fromOs) {
      macAppIconCache.set(appPath, fromOs);
      return fromOs;
    }

    // 4) Quick Look fallback
    const ql = await qlmanageAppIconDataUrl(appPath);
    if (ql) {
      macAppIconCache.set(appPath, ql);
      return ql;
    }
  } catch {
    // leave uncached so a later call can retry
  }
  return undefined;
}

async function listOpenTargets(cwd: string): Promise<DetectedApp[]> {
  const apps: DetectedApp[] = [];
  const push = (item: DetectedApp) => {
    if (!apps.some((a) => a.id === item.id)) apps.push(item);
  };

  if (process.platform === "darwin") {
    type Cand = {
      id: string;
      name: string;
      kind: DetectedApp["kind"];
      app: string;
      appPath: string;
    };
    const pending: Cand[] = [];

    const finderPath = resolveMacAppPath("Finder") ?? "/System/Library/CoreServices/Finder.app";
    if (existsSync(finderPath)) {
      pending.push({
        id: "finder",
        name: "Finder",
        kind: "finder",
        app: "Finder",
        appPath: finderPath,
      });
    }

    const candidates: Array<{
      id: string;
      name: string;
      kind: DetectedApp["kind"];
      app: string;
    }> = [
      { id: "cursor", name: "Cursor", kind: "ide", app: "Cursor" },
      { id: "vscode", name: "Visual Studio Code", kind: "ide", app: "Visual Studio Code" },
      {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        kind: "ide",
        app: "Visual Studio Code - Insiders",
      },
      { id: "zed", name: "Zed", kind: "ide", app: "Zed" },
      { id: "webstorm", name: "WebStorm", kind: "ide", app: "WebStorm" },
      { id: "intellij", name: "IntelliJ IDEA", kind: "ide", app: "IntelliJ IDEA" },
      { id: "terminal", name: "Terminal", kind: "terminal", app: "Terminal" },
      { id: "iterm", name: "iTerm", kind: "terminal", app: "iTerm" },
      { id: "iterm2", name: "iTerm2", kind: "terminal", app: "iTerm2" },
      { id: "warp", name: "Warp", kind: "terminal", app: "Warp" },
      { id: "ghostty", name: "Ghostty", kind: "terminal", app: "Ghostty" },
      { id: "alacritty", name: "Alacritty", kind: "terminal", app: "Alacritty" },
      { id: "kitty", name: "Kitty", kind: "terminal", app: "kitty" },
      { id: "hyper", name: "Hyper", kind: "terminal", app: "Hyper" },
      { id: "wezterm", name: "WezTerm", kind: "terminal", app: "WezTerm" },
    ];

    const seenBundles = new Set<string>();
    for (const c of candidates) {
      const appPath = resolveMacAppPath(c.app);
      if (!appPath) continue;
      const bundleKey = appPath.replace(/\\/g, "/").toLowerCase();
      if (seenBundles.has(bundleKey)) continue;
      seenBundles.add(bundleKey);
      pending.push({ ...c, appPath });
    }

    // Resolve icons in parallel; isolate failures so one app cannot blank all icons.
    const resolved = await Promise.all(
      pending.map(async (c) => {
        let iconDataUrl: string | undefined;
        try {
          iconDataUrl = await macAppIconDataUrl(c.appPath);
        } catch {
          iconDataUrl = undefined;
        }
        const launchName = basename(c.appPath, ".app");
        const item: DetectedApp = {
          id: c.id,
          name: c.name === "iTerm2" || c.name === "iTerm" ? launchName : c.name,
          kind: c.kind,
          target: c.kind === "finder" ? "Finder" : launchName,
          ...(iconDataUrl ? { iconDataUrl } : {}),
        };
        return item;
      }),
    );
    for (const item of resolved) push(item);
  } else if (process.platform === "win32") {
    push({ id: "explorer", name: "Explorer", kind: "finder", target: "explorer" });
    // Only list apps that resolve on PATH or known install dirs (do not advertise missing IDEs).
    const winCandidates: Array<{
      id: string;
      name: string;
      kind: DetectedApp["kind"];
      target: string;
      /** Extra absolute paths to check when `where` fails (e.g. Cursor not on PATH). */
      extraPaths?: string[];
    }> = [
      {
        id: "cursor",
        name: "Cursor",
        kind: "ide",
        target: "cursor",
        extraPaths: [
          join(homedir(), "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
          join(homedir(), "AppData", "Local", "cursor", "Cursor.exe"),
          "C:\\Program Files\\Cursor\\Cursor.exe",
        ],
      },
      {
        id: "vscode",
        name: "Visual Studio Code",
        kind: "ide",
        target: "code",
        extraPaths: [
          join(homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe"),
          "C:\\Program Files\\Microsoft VS Code\\Code.exe",
          "C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd",
        ],
      },
      {
        id: "goland",
        name: "GoLand",
        kind: "ide",
        target: "goland",
        extraPaths: [
          join(homedir(), "AppData", "Local", "Programs", "GoLand", "bin", "goland64.exe"),
        ],
      },
      {
        id: "pycharm",
        name: "PyCharm",
        kind: "ide",
        target: "pycharm",
        extraPaths: [
          join(homedir(), "AppData", "Local", "Programs", "PyCharm", "bin", "pycharm64.exe"),
        ],
      },
      { id: "wt", name: "Windows Terminal", kind: "terminal", target: "wt" },
      { id: "cmd", name: "Command Prompt", kind: "terminal", target: "cmd" },
      { id: "powershell", name: "PowerShell", kind: "terminal", target: "powershell" },
    ];

    await Promise.all(
      winCandidates.map(async (c) => {
        let exe: string | undefined;
        try {
          const { stdout } = await execFileAsync("where.exe", [c.target], {
            windowsHide: true,
            timeout: 8_000,
            maxBuffer: 1024 * 1024,
          });
          exe = stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .find((line) => line.length > 0 && existsSync(line));
        } catch {
          exe = undefined;
        }
        if (!exe) {
          exe = (c.extraPaths ?? []).find((p) => existsSync(p));
        }
        if (!exe) return; // not installed — omit from menu
        let iconDataUrl: string | undefined;
        try {
          iconDataUrl = await fileIconDataUrl(exe);
        } catch {
          iconDataUrl = undefined;
        }
        // Prefer resolved absolute path so open works even when the shim is not on PATH.
        push({
          id: c.id,
          name: c.name,
          kind: c.kind,
          target: exe,
          ...(iconDataUrl ? { iconDataUrl } : {}),
        });
      }),
    );
  } else {
    push({ id: "files", name: "Files", kind: "finder", target: "xdg-open" });
    await Promise.all(
      [
        { id: "cursor", name: "Cursor", kind: "ide" as const, target: "cursor" },
        { id: "vscode", name: "Visual Studio Code", kind: "ide" as const, target: "code" },
        {
          id: "terminal",
          name: "Terminal",
          kind: "terminal" as const,
          target: "x-terminal-emulator",
        },
        {
          id: "gnome-terminal",
          name: "GNOME Terminal",
          kind: "terminal" as const,
          target: "gnome-terminal",
        },
        { id: "konsole", name: "Konsole", kind: "terminal" as const, target: "konsole" },
      ].map(async (c) => {
        try {
          await execFileAsync("which", [c.target], { timeout: 5_000, maxBuffer: 256 * 1024 });
          push({ ...c });
        } catch {
          // not installed
        }
      }),
    );
  }

  void cwd;
  return apps;
}

/** Official gallery: npm registry search for keyword `pi-package` (same as pi.dev/packages). */
async function searchPiPackageCatalog(
  query?: string,
  size = 20,
  from = 0,
): Promise<{ packages: CatalogPackage[]; total: number }> {
  const q = query?.trim() ?? "";
  const text = q ? `keywords:pi-package ${q}` : "keywords:pi-package";
  const limit = Math.min(100, Math.max(1, Math.floor(size)));
  const offset = Math.max(0, Math.floor(from));
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${limit}&from=${offset}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "pix-desktop" },
  });
  if (!res.ok) {
    throw new Error(`插件目录请求失败 (${res.status})`);
  }
  const data = (await res.json()) as {
    total?: number;
    objects?: Array<{
      package?: {
        name?: string;
        description?: string;
        version?: string;
        date?: string;
        keywords?: string[];
        publisher?: { username?: string };
      };
      downloads?: { weekly?: number };
    }>;
  };
  const items: CatalogPackage[] = [];
  for (const obj of data.objects ?? []) {
    const pkg = obj.package;
    if (!pkg?.name) continue;
    const entry: CatalogPackage = {
      name: pkg.name,
      description: pkg.description?.trim() || "",
      version: pkg.version || "latest",
      source: `npm:${pkg.name}`,
    };
    if (pkg.publisher?.username) entry.publisher = pkg.publisher.username;
    if (typeof obj.downloads?.weekly === "number") entry.weeklyDownloads = obj.downloads.weekly;
    if (pkg.date) entry.updatedAt = pkg.date;
    if (Array.isArray(pkg.keywords))
      entry.keywords = pkg.keywords.filter((k) => typeof k === "string");
    items.push(entry);
  }
  const total =
    typeof data.total === "number" && Number.isFinite(data.total)
      ? Math.max(data.total, items.length + offset)
      : offset + items.length;
  return { packages: items, total };
}

async function openInApp(appId: string, cwd: string): Promise<void> {
  const apps = await listOpenTargets(cwd);
  const found = apps.find((a) => a.id === appId);
  if (!found) throw new Error(`未找到应用: ${appId}`);

  if (found.kind === "finder") {
    // Open folder itself (not "reveal file") for project roots.
    if (process.platform === "darwin") {
      await execFileAsync("open", [cwd], { windowsHide: true });
      return;
    }
    if (process.platform === "win32") {
      await execFileAsync("explorer", [cwd], { windowsHide: true });
      return;
    }
    await execFileAsync("xdg-open", [cwd], { windowsHide: true });
    return;
  }

  if (process.platform === "darwin") {
    // Terminal apps: open with working directory
    if (found.kind === "terminal") {
      if (found.id === "terminal") {
        // Apple Terminal via AppleScript so cwd is applied.
        const script = `tell application "Terminal" to do script "cd ${cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        await execFileAsync("osascript", ["-e", script], { windowsHide: true });
        return;
      }
      if (found.id === "iterm" || found.id === "iterm2") {
        const script = `tell application "iTerm"
  activate
  try
    tell current window
      create tab with default profile
      tell current session
        write text "cd ${cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
      end tell
    end tell
  on error
    create window with default profile
    tell current session of current window
      write text "cd ${cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
    end tell
  end try
end tell`;
        await execFileAsync("osascript", ["-e", script], { windowsHide: true });
        return;
      }
    }
    await execFileAsync("open", ["-a", found.target, cwd], { windowsHide: true });
    return;
  }
  if (process.platform === "win32") {
    if (found.id === "wt") {
      await execFileAsync("wt", ["-d", cwd], { windowsHide: true, shell: true });
      return;
    }
    if (found.id === "cmd") {
      await execFileAsync("cmd", ["/c", "start", "cmd", "/k", `cd /d ${cwd}`], {
        windowsHide: true,
        shell: true,
      });
      return;
    }
    if (found.id === "powershell") {
      await execFileAsync(
        "powershell",
        ["-NoExit", "-Command", `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'`],
        { windowsHide: true, shell: true },
      );
      return;
    }
    await execFileAsync(found.target, [cwd], { windowsHide: true, shell: true });
    return;
  }
  if (found.kind === "terminal") {
    await execFileAsync(found.target, ["--working-directory", cwd], { windowsHide: true }).catch(
      async () => {
        await execFileAsync(found.target, [cwd], { windowsHide: true });
      },
    );
    return;
  }
  await execFileAsync(found.target, [cwd], { windowsHide: true });
}

/** Restored BrowserWindow geometry (userData/pix-desktop.json). */
interface WindowBoundsPrefs {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

interface DesktopPrefs {
  recentWorkspaces: string[];
  lastWorkspace?: string;
  /** Last main window position / size. */
  window?: WindowBoundsPrefs;
  /** Absolute root for new git worktrees; empty/undefined = Documents/Pix/worktrees/<repo>. */
  worktreeRoot?: string;
  /** When false, disable auto-prune. Default / unset = enabled (recommended). */
  worktreeAutoDelete?: boolean;
  /** Max managed worktrees to keep when auto-delete is on (default 10). */
  worktreeAutoDeleteLimit?: number;
  /** Prefixed onto new branch names when not already present. */
  gitBranchPrefix?: string;
  /** How `git pull` merges remote changes. */
  gitPullMode?: "merge" | "squash";
  /** Always force-push (uses --force). */
  gitForcePush?: boolean;
  /** Open create-PR links as draft when supported. */
  gitDraftPr?: boolean;
  /**
   * AI prompt for commit-message helpers (not a shell command).
   * Empty = default AI / manual message strategy.
   */
  gitCustomCommitCommand?: string;
  /**
   * AI prompt for PR title/body helpers (not a shell command).
   * Empty = default AI / browser create-PR flow.
   */
  gitCustomPrCommand?: string;
  /** Model used for AI-assisted git ops (commit message / PR helpers). Empty = session default. */
  gitModelProvider?: string;
  gitModelId?: string;
}

const WINDOW_MIN_WIDTH = 760;
const WINDOW_MIN_HEIGHT = 560;
const WINDOW_DEFAULT_WIDTH = 1440;
const WINDOW_DEFAULT_HEIGHT = 900;

export type WorktreePrefs = {
  root: string;
  /** Empty string means default. */
  rootConfigured: string;
  autoDelete: boolean;
  autoDeleteLimit: number;
  defaultRoot: string;
};

export type GitPrefs = {
  branchPrefix: string;
  pullMode: "merge" | "squash";
  forcePush: boolean;
  draftPr: boolean;
  customCommitCommand: string;
  customPrCommand: string;
  /** Empty provider/id = use current session / pi default model. */
  modelProvider: string;
  modelId: string;
};

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

/**
 * Auto scratch from ensureDefault: …/Pix/YYYY-MM-DD[ -N].
 * Not a user project — must not land in recent/last or the sidebar 项目 list.
 */
function isAutoDefaultWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /\/Pix\/\d{4}-\d{2}-\d{2}(-\d+)?$/i.test(normalized);
}

/** Pure-conversation home: …/Pix/conversations[/…] — never a sidebar project. */
function isConversationWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /\/Pix\/conversations(?:\/|$)/i.test(normalized);
}

function isNonProjectWorkspacePath(path: string): boolean {
  return (
    isEphemeralWorkspacePath(path) ||
    isAutoDefaultWorkspacePath(path) ||
    isConversationWorkspacePath(path)
  );
}

function durableWorkspacePath(cwd: string | undefined): string | undefined {
  if (!cwd || typeof cwd !== "string") return undefined;
  if (isNonProjectWorkspacePath(cwd)) return undefined;
  try {
    if (!existsSync(cwd)) return undefined;
  } catch {
    return undefined;
  }
  return cwd;
}

/** Local calendar date as YYYY-MM-DD (no timezone suffix). */
function localDateFolderName(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Default project root: Documents/Pix/<YYYY-MM-DD>.
 * Reuses today's folder when it already exists as a directory.
 */
function ensureDefaultWorkspacePath(): string {
  const root = join(app.getPath("documents"), "Pix");
  mkdirSync(root, { recursive: true });
  const base = localDateFolderName();
  const path = join(root, base);
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    return path;
  }
  try {
    if (lstatSync(path).isDirectory()) return path;
  } catch {
    // fall through to a unique suffix
  }
  let n = 2;
  while (existsSync(join(root, `${base}-${n}`))) n += 1;
  const unique = join(root, `${base}-${n}`);
  mkdirSync(unique, { recursive: true });
  return unique;
}

/**
 * Global「新建会话」home — pure conversations, never listed as a project.
 * Documents/Pix/conversations
 */
function ensureConversationWorkspacePath(): string {
  const path = join(app.getPath("documents"), "Pix", "conversations");
  mkdirSync(path, { recursive: true });
  return path;
}

function saveDesktopPrefs(prefs: DesktopPrefs): void {
  const path = prefsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

/**
 * Load prefs and scrub fixture/temp paths left by older smoke launches.
 * If lastWorkspace is dead, fall back to the first durable recent project.
 * Preserves unrelated fields (git, window bounds, worktree, …).
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
    const windowBounds = normalizeWindowBoundsPrefs(parsed.window);
    const cleaned: DesktopPrefs = {
      ...parsed,
      recentWorkspaces,
      ...(lastWorkspace ? { lastWorkspace } : {}),
      ...(windowBounds ? { window: windowBounds } : {}),
    };
    if (!lastWorkspace) delete cleaned.lastWorkspace;
    if (!windowBounds) delete cleaned.window;
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
    (item) => item !== cwd && !isNonProjectWorkspacePath(item),
  );
  // Fixture / temp / auto date folders must not become the cold-start resume target
  // or pollute the sidebar 项目 list (e.g. Documents/Pix/2026-07-21).
  if (isNonProjectWorkspacePath(cwd)) {
    const last = durableWorkspacePath(prefs.lastWorkspace) ?? cleaned[0];
    const next: DesktopPrefs = {
      ...prefs,
      recentWorkspaces: cleaned.slice(0, 8),
    };
    if (last) next.lastWorkspace = last;
    else delete next.lastWorkspace;
    saveDesktopPrefs(next);
    return;
  }
  saveDesktopPrefs({
    ...prefs,
    recentWorkspaces: [cwd, ...cleaned].slice(0, 8),
    lastWorkspace: cwd,
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate stored window geometry; drop off-screen / nonsense values. */
function normalizeWindowBoundsPrefs(raw: unknown): WindowBoundsPrefs | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(o.x) ||
    !isFiniteNumber(o.y) ||
    !isFiniteNumber(o.width) ||
    !isFiniteNumber(o.height)
  ) {
    return undefined;
  }
  const width = Math.max(WINDOW_MIN_WIDTH, Math.round(o.width));
  const height = Math.max(WINDOW_MIN_HEIGHT, Math.round(o.height));
  const x = Math.round(o.x);
  const y = Math.round(o.y);
  return {
    x,
    y,
    width,
    height,
    ...(o.isMaximized === true ? { isMaximized: true } : {}),
  };
}

/**
 * Ensure saved bounds still intersect some display (monitor unplugged, resolution change).
 * Returns options suitable for BrowserWindow constructor (+ optional maximize after show).
 */
function resolveWindowCreateOptions(saved: WindowBoundsPrefs | undefined): {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
} {
  const width = saved?.width ?? WINDOW_DEFAULT_WIDTH;
  const height = saved?.height ?? WINDOW_DEFAULT_HEIGHT;
  const isMaximized = saved?.isMaximized === true;
  if (saved === undefined) {
    return { width, height, isMaximized: false };
  }
  try {
    const area = { x: saved.x, y: saved.y, width, height };
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return (
        area.x < b.x + b.width &&
        area.x + area.width > b.x &&
        area.y < b.y + b.height &&
        area.y + area.height > b.y
      );
    });
    if (!visible) return { width, height, isMaximized: false };
    return { x: saved.x, y: saved.y, width, height, isMaximized };
  } catch {
    return { width, height, isMaximized: false };
  }
}

function persistMainWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  try {
    // Prefer normal (unmaximized) bounds so restore after maximize still has size.
    const bounds =
      typeof win.getNormalBounds === "function" ? win.getNormalBounds() : win.getBounds();
    const nextBounds: WindowBoundsPrefs = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(WINDOW_MIN_WIDTH, Math.round(bounds.width)),
      height: Math.max(WINDOW_MIN_HEIGHT, Math.round(bounds.height)),
      ...(win.isMaximized() ? { isMaximized: true } : {}),
    };
    const prefs = loadDesktopPrefs();
    saveDesktopPrefs({ ...prefs, window: nextBounds });
  } catch {
    // ignore
  }
}

function attachWindowBoundsPersistence(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      persistMainWindowBounds(win);
    }, 250);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    persistMainWindowBounds(win);
  });
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

function normalizeHostCwd(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

class HostSupervisor {
  #host: ActiveHost | undefined;
  #snapshot: HostSnapshot | undefined;
  /**
   * Single-flight lifecycle queue. clearActive / start / stop / newSession must not
   * interleave — rapid「新建会话」clicks previously killed mid-start hosts (exit 0).
   */
  #opQueue: Promise<unknown> = Promise.resolve();
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

  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#opQueue.then(fn, fn);
    this.#opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

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
    const samePath = (item: string) => item.replace(/\\/g, "/").replace(/\/+$/, "") === normalized;
    const recent = prefs.recentWorkspaces.filter((item) => !samePath(item));
    const next: DesktopPrefs = {
      ...prefs,
      recentWorkspaces: recent,
    };
    if (prefs.lastWorkspace && samePath(prefs.lastWorkspace)) {
      delete next.lastWorkspace;
    }
    // If removing the live project, detach so it leaves the sidebar "current" slot.
    const active = this.#workspaceCwd?.replace(/\\/g, "/").replace(/\/+$/, "");
    if (active === normalized) {
      void this.clearActiveWorkspace().catch(() => undefined);
    }
    saveDesktopPrefs(next);
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
        if (typeof item !== "string" || isNonProjectWorkspacePath(item)) return false;
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
    return this.#exclusive(() => this.#startExclusive(options));
  }

  async #startExclusive(options?: {
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

    const live =
      this.#host &&
      this.#snapshot &&
      !this.#host.ignoreMessages &&
      !this.#host.stopping;
    if (
      !options?.force &&
      live &&
      options?.sessionFile === undefined &&
      (!options?.cwd ||
        normalizeHostCwd(this.#snapshot!.cwd) === normalizeHostCwd(options.cwd))
    ) {
      return this.#snapshot!;
    }

    // Only kill when explicitly forced or the workspace actually changes.
    const forceSpawn =
      Boolean(options?.force) ||
      Boolean(
        this.#host &&
          options?.cwd &&
          this.#snapshot &&
          normalizeHostCwd(this.#snapshot.cwd) !== normalizeHostCwd(options.cwd),
      );

    return this.#start(forceSpawn);
  }

  /**
   * Ensure utility process is up AND runtime handle exists (host.ready received).
   * Checking only `#host` is insufficient: the process can be mid-start with no handle yet.
   */
  async #ensureHostReady(): Promise<void> {
    if (this.#host && this.#snapshot && !this.#host.ignoreMessages && !this.#host.stopping) {
      return;
    }
    const zombie =
      Boolean(this.#host) &&
      !this.#snapshot &&
      !this.#host!.stopping &&
      !this.#host!.ignoreMessages;
    await this.#startExclusive({
      ...(this.#workspaceCwd ? { cwd: this.#workspaceCwd } : {}),
      force: zombie,
    });
  }

  async openWorkspace(
    cwd: string,
    options?: { resumeRecent?: boolean; sessionFile?: string },
  ): Promise<HostSnapshot> {
    return this.#exclusive(async () => {
      rememberWorkspace(cwd);
      this.#workspaceCwd = cwd;
      this.#requireExplicitWorkspace = false;
      // Prefer explicit session when switching into a project (avoids open→default→switch flicker).
      this.#sessionFile = options?.sessionFile;
      this.#resumeRecent = options?.resumeRecent === true && !options?.sessionFile;
      await this.#stopExclusive().catch(() => undefined);
      // stop()'s child exit path may have run after our pre-clear; re-assert intent.
      this.#sessionFile = options?.sessionFile;
      this.#snapshot = undefined;
      this.#host = undefined;
      this.#resumeRecent = options?.resumeRecent === true && !options?.sessionFile;
      return this.#startExclusive({
        cwd,
        ...(options?.sessionFile ? { sessionFile: options.sessionFile } : {}),
        resumeRecent: options?.resumeRecent === true && !options?.sessionFile,
        force: true,
      });
    });
  }

  /**
   * Global "新建会话": detach from the live project session.
   * - Product: clear cwd so the next start requires an explicit project pick.
   * - Isolated/e2e (`PIX_WORKSPACE`): keep the fixture cwd for subsequent session.create.
   * Keeps the project on the recent list so it stays visible in the sidebar groups.
   */
  async clearActiveWorkspace(): Promise<void> {
    return this.#exclusive(() => this.#clearActiveExclusive());
  }

  async #clearActiveExclusive(): Promise<void> {
    const previous = this.#workspaceCwd;
    await this.#stopExclusive().catch(() => undefined);
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
      if (previous && !isNonProjectWorkspacePath(previous)) {
        rememberWorkspace(previous);
      }
    }
  }

  /**
   * Atomic「新建会话」for pure conversation: stop if needed, ensure conversation host,
   * create a new session. Rapid clicks serialize on #opQueue — no mid-start kills.
   */
  createBlankConversation(): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
    return this.#exclusive(async () => {
      const convCwd =
        process.env.PIX_WORKSPACE?.trim() || ensureConversationWorkspacePath();
      const alreadyOnConv =
        Boolean(this.#host && this.#snapshot) &&
        !this.#host!.stopping &&
        !this.#host!.ignoreMessages &&
        isConversationWorkspacePath(this.#snapshot!.cwd) &&
        normalizeHostCwd(this.#snapshot!.cwd) === normalizeHostCwd(convCwd);

      if (!alreadyOnConv) {
        await this.#clearActiveExclusive();
        // Fixture workspace (e2e) wins over conversation home when set.
        if (process.env.PIX_WORKSPACE?.trim()) {
          this.#workspaceCwd = process.env.PIX_WORKSPACE.trim();
          this.#requireExplicitWorkspace = false;
        } else {
          this.#workspaceCwd = convCwd;
          this.#requireExplicitWorkspace = false;
        }
        await this.#startExclusive({
          cwd: this.#workspaceCwd,
        });
      }

      return this.#newSessionExclusive();
    });
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

    // Pi home state (packages/resources/settings) must work without a user project.
    // Prefer supervisor workspace (set by openPath / start options) over PIX_WORKSPACE
    // so e2e/product can switch projects even when PIX_WORKSPACE is set for fixtures.
    // Fallback: PIX_WORKSPACE → last durable project → Documents/Pix/YYYY-MM-DD scratch.
    const cwd =
      this.#workspaceCwd ??
      process.env.PIX_WORKSPACE ??
      (this.#requireExplicitWorkspace
        ? undefined
        : durableWorkspacePath(loadDesktopPrefs().lastWorkspace)) ??
      ensureDefaultWorkspacePath();
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

  async prompt(
    message: string,
    streamingBehavior?: "steer" | "followUp",
    imagePaths?: string[],
  ): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "agent.prompt",
      requestId: randomUUID(),
      message,
    };
    if (streamingBehavior) command.streamingBehavior = streamingBehavior;
    if (imagePaths?.length) command.imagePaths = imagePaths.slice(0, 12);
    const event = await this.#request(command);
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected prompt response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async clearQueue(): Promise<HostSnapshot> {
    if (!this.#host) throw new Error("Agent Host is not running");
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "agent.queue.clear",
      requestId: randomUUID(),
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected queue response");
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
    return this.#exclusive(async () => {
      await this.#ensureHostReady();
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
    });
  }

  async newSession(): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
    return this.#exclusive(async () => {
      await this.#ensureHostReady();
      return this.#newSessionExclusive();
    });
  }

  async #newSessionExclusive(): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
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
    // Ensure a live runtime exists. Prefer opening the target session file directly
    // so we do not start a throwaway session then switch (flash + missing history).
    if (!this.#host || !this.#snapshot) {
      this.#sessionFile = sessionPath;
      this.#requireExplicitWorkspace = false;
      await this.start({
        ...(this.#workspaceCwd ? { cwd: this.#workspaceCwd } : {}),
        sessionFile: sessionPath,
        force: true,
      });
    }
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.switch",
      requestId: randomUUID(),
      sessionPath,
    });
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.switch response");
    this.#acceptSnapshot(event.snapshot);
    // Keep supervisor workspace pointer aligned with the session's project cwd.
    if (event.snapshot.cwd) {
      this.#workspaceCwd = event.snapshot.cwd;
      this.#requireExplicitWorkspace = false;
      this.#sessionFile = event.snapshot.sessionFile ?? sessionPath;
      rememberWorkspace(event.snapshot.cwd);
    }
    return { snapshot: event.snapshot, threads: event.threads, history: event.history };
  }

  async forkSession(entryId?: string): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
    selectedText?: string;
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
    return {
      snapshot: event.snapshot,
      threads: event.threads,
      history: event.history,
      ...(event.selectedText !== undefined ? { selectedText: event.selectedText } : {}),
    };
  }

  async sessionTree(): Promise<SessionTreeView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.tree",
      requestId: randomUUID(),
    });
    if (event.type !== "session.tree")
      throw new Error("Agent Host returned an unexpected session.tree response");
    return event.tree;
  }

  async navigateSessionTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string },
  ): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
    cancelled: boolean;
  }> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.navigateTree",
      requestId: randomUUID(),
      targetId,
    };
    if (options?.summarize !== undefined) command.summarize = options.summarize;
    if (options?.customInstructions) command.customInstructions = options.customInstructions;
    const event = await this.#request(command);
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.navigateTree response");
    if (!event.cancelled) this.#acceptSnapshot(event.snapshot);
    return {
      snapshot: event.snapshot,
      threads: event.threads,
      history: event.history,
      cancelled: event.cancelled === true,
    };
  }

  async compactSession(instructions?: string): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.compact",
      requestId: randomUUID(),
    };
    if (instructions !== undefined) command.instructions = instructions;
    const event = await this.#request(command);
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected session.compact response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async setSessionName(name: string): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.setName",
      requestId: randomUUID(),
      name,
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected session.setName response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async cloneSession(): Promise<{
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.clone",
      requestId: randomUUID(),
    });
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.clone response");
    this.#acceptSnapshot(event.snapshot);
    return { snapshot: event.snapshot, threads: event.threads, history: event.history };
  }

  async sessionInfo(): Promise<SessionInfoView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.info",
      requestId: randomUUID(),
    });
    if (event.type !== "session.info")
      throw new Error("Agent Host returned an unexpected session.info response");
    return event.info;
  }

  async exportSession(format: "html" | "jsonl", outputPath?: string): Promise<SessionExportResult> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.export",
      requestId: randomUUID(),
      format,
    };
    if (outputPath !== undefined) command.outputPath = outputPath;
    const event = await this.#request(command);
    if (event.type !== "session.export")
      throw new Error("Agent Host returned an unexpected session.export response");
    return event.result;
  }

  async importSession(
    inputPath: string,
    cwdOverride?: string,
  ): Promise<
    | {
        snapshot: HostSnapshot;
        threads: SessionThreadSummary[];
        history: SessionHistoryMessage[];
      }
    | undefined
  > {
    if (!this.#host) await this.start();
    const resolvedInputPath = isAbsolute(inputPath)
      ? inputPath
      : resolve(this.#workspaceCwd ?? process.cwd(), inputPath);
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.import",
      requestId: randomUUID(),
      inputPath: resolvedInputPath,
    };
    if (cwdOverride) command.cwdOverride = cwdOverride;
    let event: HostEvent;
    try {
      event = await this.#request(command);
    } catch (error) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "SESSION_IMPORT_CWD_MISSING" || cwdOverride) throw error;
      if (this.window.isDestroyed()) return undefined;
      const picked = await dialog.showOpenDialog(this.window, {
        title: "Choose a workspace for the imported session",
        buttonLabel: "Use this workspace",
        properties: ["openDirectory", "createDirectory"],
        ...(error instanceof Error ? { message: error.message } : {}),
        ...(this.#workspaceCwd ? { defaultPath: this.#workspaceCwd } : {}),
      });
      const selectedCwd = picked.filePaths[0];
      if (picked.canceled || !selectedCwd) return undefined;
      return this.importSession(resolvedInputPath, selectedCwd);
    }
    if (event.type !== "session.opened")
      throw new Error("Agent Host returned an unexpected session.import response");
    this.#acceptSnapshot(event.snapshot);
    if (event.snapshot.cwd) {
      this.#workspaceCwd = event.snapshot.cwd;
      this.#requireExplicitWorkspace = false;
      this.#sessionFile = event.snapshot.sessionFile;
      rememberWorkspace(event.snapshot.cwd);
    }
    return { snapshot: event.snapshot, threads: event.threads, history: event.history };
  }

  async sessionBash(
    commandText: string,
    options?: { excludeFromContext?: boolean },
  ): Promise<{ result: SessionBashResult; snapshot: HostSnapshot }> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.bash",
      requestId: randomUUID(),
      command: commandText,
    };
    if (options?.excludeFromContext !== undefined) {
      command.excludeFromContext = options.excludeFromContext;
    }
    const event = await this.#request(command);
    if (event.type !== "session.bash")
      throw new Error("Agent Host returned an unexpected session.bash response");
    this.#acceptSnapshot(event.snapshot);
    return { result: event.result, snapshot: event.snapshot };
  }

  async copyLastAssistant(): Promise<string | undefined> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.copyLast",
      requestId: randomUUID(),
    });
    if (event.type !== "session.copyLast")
      throw new Error("Agent Host returned an unexpected session.copyLast response");
    return event.text;
  }

  async shareSession(): Promise<SessionShareResult> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "session.share",
      requestId: randomUUID(),
    });
    if (event.type !== "session.share")
      throw new Error("Agent Host returned an unexpected session.share response");
    return event.result;
  }

  async reloadRuntime(): Promise<HostSnapshot> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "runtime.reload",
      requestId: randomUUID(),
    });
    if (event.type !== "runtime.snapshot")
      throw new Error("Agent Host returned an unexpected runtime.reload response");
    this.#acceptSnapshot(event.snapshot);
    return event.snapshot;
  }

  async exportSessionPick(format: "html" | "jsonl"): Promise<SessionExportResult | undefined> {
    if (!mainWindow || mainWindow.isDestroyed()) return undefined;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: format === "html" ? "Export session HTML" : "Export session JSONL",
      defaultPath: format === "html" ? "session.html" : "session.jsonl",
      filters:
        format === "html"
          ? [{ name: "HTML", extensions: ["html", "htm"] }]
          : [{ name: "JSONL", extensions: ["jsonl"] }],
    });
    if (result.canceled || !result.filePath) return undefined;
    return this.exportSession(format, result.filePath);
  }

  async importSessionPick(): Promise<
    | {
        snapshot: HostSnapshot;
        threads: SessionThreadSummary[];
        history: SessionHistoryMessage[];
      }
    | undefined
  > {
    if (!mainWindow || mainWindow.isDestroyed()) return undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import session JSONL",
      properties: ["openFile"],
      filters: [{ name: "JSONL", extensions: ["jsonl"] }],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return this.importSession(result.filePaths[0]);
  }

  async listScopedModels(): Promise<ScopedModelView[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "models.scoped.list",
      requestId: randomUUID(),
    });
    if (event.type !== "models.scoped")
      throw new Error("Agent Host returned an unexpected models.scoped.list response");
    return event.models;
  }

  async refreshModelCatalog(): Promise<ModelSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "models.refresh",
      requestId: randomUUID(),
    });
    if (event.type !== "model.list")
      throw new Error("Agent Host returned an unexpected models.refresh response");
    return event.models;
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

  async installPackage(
    source: string,
    scope: "global" | "project",
    options?: { temporary?: boolean },
  ): Promise<PackageSummary[]> {
    if (!this.#host) await this.start();
    const command: HostCommand = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "packages.install",
      requestId: randomUUID(),
      source,
      scope,
    };
    if (options?.temporary) command.temporary = true;
    const event = await this.#request(command);
    if (event.type !== "packages.changed")
      throw new Error("Agent Host returned an unexpected packages.install response");
    return event.packages;
  }

  async setPackageEnabled(
    source: string,
    scope: "global" | "project",
    enabled: boolean,
  ): Promise<PackageSummary[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "packages.setEnabled",
      requestId: randomUUID(),
      source,
      scope,
      enabled,
    });
    if (event.type !== "packages.changed")
      throw new Error("Agent Host returned an unexpected packages.setEnabled response");
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

  async completeText(
    prompt: string,
    options?: { systemPrompt?: string; model?: { provider: string; id: string } },
  ): Promise<string> {
    if (!this.#host) await this.start();
    const command = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "util.complete-text" as const,
      requestId: randomUUID(),
      prompt,
      ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options?.model ? { model: options.model } : {}),
    } satisfies HostCommand;
    const event = await this.#request(command);
    if (event.type !== "util.text")
      throw new Error("Agent Host returned an unexpected util.complete-text response");
    return event.text;
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

  async getModelsJsonConfig(): Promise<ModelsJsonConfigView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "models.config.get",
      requestId: randomUUID(),
    });
    if (event.type !== "models.config")
      throw new Error("Agent Host returned an unexpected models.config.get response");
    return event.config;
  }

  async upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelsJsonConfigView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "models.config.upsert",
      requestId: randomUUID(),
      input,
    });
    if (event.type !== "models.config")
      throw new Error("Agent Host returned an unexpected models.config.upsert response");
    return event.config;
  }

  async removeCustomProvider(provider: string): Promise<ModelsJsonConfigView> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "models.config.remove",
      requestId: randomUUID(),
      provider,
    });
    if (event.type !== "models.config")
      throw new Error("Agent Host returned an unexpected models.config.remove response");
    return event.config;
  }

  async #resolveAgentDir(): Promise<string> {
    if (this.#snapshot?.agentDir) return this.#snapshot.agentDir;
    if (process.env.PI_CODING_AGENT_DIR?.trim()) return process.env.PI_CODING_AGENT_DIR.trim();
    return (await this.start()).agentDir;
  }

  /** Ensure models.json exists and open it with the OS default app. */
  async openModelsJson(): Promise<void> {
    const agentDir = await this.#resolveAgentDir();
    const { ensureModelsJsonTemplate } = await import("@pix/agent-runtime");
    const path = await ensureModelsJsonTemplate(agentDir);
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  }

  async revealModelsJson(): Promise<void> {
    const agentDir = await this.#resolveAgentDir();
    const { ensureModelsJsonTemplate } = await import("@pix/agent-runtime");
    const path = await ensureModelsJsonTemplate(agentDir);
    shell.showItemInFolder(path);
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

  async listProviderUsage(): Promise<ProviderUsageSnapshot[]> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.usage",
      requestId: randomUUID(),
    });
    if (event.type !== "providers.usage") {
      throw new Error("Agent Host returned an unexpected providers.usage response");
    }
    return event.usage;
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

  async startProviderOAuth(provider: string, requestedOperationId?: string): Promise<string> {
    if (!this.#host) await this.start();
    const operationId = requestedOperationId || randomUUID();
    void this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.oauth.start",
      requestId: operationId,
      provider,
    }).catch((error: unknown) => {
      this.#emit({
        protocolVersion: IPC_PROTOCOL_VERSION,
        type: "providers.oauth",
        requestId: operationId,
        provider,
        update: {
          stage: "error",
          message: error instanceof Error ? error.message : "OAuth login failed",
        },
      });
    });
    return operationId;
  }

  async respondProviderOAuth(
    operationId: string,
    promptId: string,
    value?: string,
    cancelled?: boolean,
  ): Promise<void> {
    this.#send({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.oauth.respond",
      requestId: randomUUID(),
      operationId,
      promptId,
      ...(value !== undefined ? { value } : {}),
      ...(cancelled !== undefined ? { cancelled } : {}),
    });
  }

  async cancelProviderOAuth(operationId: string): Promise<void> {
    this.#send({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "providers.oauth.cancel",
      requestId: randomUUID(),
      operationId,
    });
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

  async patchPiSettings(patch: PiSettingsPatch): Promise<PiSettingsPatchResult> {
    if (!this.#host) await this.start();
    const event = await this.#request({
      protocolVersion: IPC_PROTOCOL_VERSION,
      type: "settings.patch",
      requestId: randomUUID(),
      patch,
    });
    if (event.type !== "settings.view")
      throw new Error("Agent Host returned an unexpected settings.patch response");
    if (!event.snapshot) throw new Error("Agent Host omitted the settings snapshot");
    this.#acceptSnapshot(event.snapshot);
    return { settings: event.settings, snapshot: event.snapshot };
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
    return this.#exclusive(() => this.#stopExclusive());
  }

  async #stopExclusive(): Promise<void> {
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
      await host.exit.promise.catch(() => undefined);
      if (this.#host === host) this.#host = undefined;
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

    // Surface host stdout/stderr so "exited with code 0" failures are diagnosable.
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk).trim();
      if (text) console.log(`[agent-host:${host.hostId.slice(0, 8)}] ${text}`);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk).trim();
      if (text) console.warn(`[agent-host:${host.hostId.slice(0, 8)}] ${text}`);
    });

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
      // Streaming events share the parent requestId but are not the final response.
      if (message.type !== "packages.progress" && message.type !== "providers.oauth") {
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
      // Intentional stop/replace: pending callers should fail softly; Windows kill often is code 0.
      const error = host.stopping
        ? new Error("Agent Host was replaced or stopped")
        : new Error(`Agent Host exited with code ${exitCode}`);
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
          : command.type === "providers.oauth.start"
            ? 300_000
            : command.type === "providers.usage"
              ? 25_000
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

  #send(command: HostCommand): void {
    const host = this.#host;
    if (!host || host.ignoreMessages) throw new Error("Agent Host is not running");
    host.child.postMessage(command);
  }

  #resolvePending(message: HostEvent): void {
    if (!("requestId" in message) || !message.requestId) return;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(message.requestId);
    if (message.type === "host.error") {
      const error = new Error(message.message) as NodeJS.ErrnoException;
      error.code = message.code;
      pending.reject(error);
    } else pending.resolve(message);
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

/** App package root (apps/desktop) whether running from src or dist/main. */
function packageRoot(): string {
  // dist/main → ../.. ; file:// main might be nested differently
  const fromDist = join(currentDirectory, "../..");
  if (existsSync(join(fromDist, "package.json"))) return fromDist;
  const fromNested = join(currentDirectory, "../../..");
  if (existsSync(join(fromNested, "package.json"))) return fromNested;
  return fromDist;
}

function resolveAppIconPath(): string | undefined {
  const root = packageRoot();
  // Prefer PNG for dock / About / window chrome. Packaged .app also ships .icns via builder.
  for (const rel of ["build/icon.png", "build/icon.icns"]) {
    const path = join(root, rel);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * macOS Dock: system applies the squircle mask — artwork must be a full square.
 * Pre-drawn rounded corners make the icon look smaller / differently framed than
 * VS Code, Cursor, ChatGPT, etc.
 * Dev: Electron binary has no Pix .icns, so set the dock image explicitly.
 */
function applyDockIcon(iconPath: string | undefined): void {
  if (process.platform !== "darwin" || !iconPath || !app.dock) return;
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    console.warn("[pix] dock icon empty:", iconPath);
    return;
  }
  // Normalize to a square bitmap so Dock scaling matches other apps.
  const size = Math.max(image.getSize().width, image.getSize().height, 128);
  const squared = image.resize({ width: size, height: size, quality: "best" });
  app.dock.setIcon(squared);
}

/**
 * Product branding for About dialog, Dock, and window chrome (dev + packaged).
 * About panel needs an explicit iconPath or macOS falls back to Electron's icon.
 */
function applyAppBranding(): void {
  app.setName("Pix");
  if (process.platform === "win32") {
    app.setAppUserModelId("dev.pix.app");
  }
  const iconPath = resolveAppIconPath();
  applyDockIcon(iconPath);
  if (iconPath) {
    try {
      app.setAboutPanelOptions({
        applicationName: "Pix",
        applicationVersion: app.getVersion(),
        version: app.getVersion(),
        copyright: "Pix",
        iconPath,
      });
    } catch (error) {
      console.warn("[pix] setAboutPanelOptions failed:", error);
    }
  } else {
    console.warn("[pix] app icon not found under build/icon.png|icns");
  }
}

/** Keep in sync with apps/desktop/src/renderer/lib/desktop-chrome.ts TITLEBAR_HEIGHT_PX. */
const TITLEBAR_HEIGHT_PX = 46;

/** Match renderer `styles.css` shell backgrounds for titleBarOverlay / frame fill. */
function titleBarChromeColors(): { color: string; symbolColor: string } {
  if (nativeTheme.shouldUseDarkColors) {
    return { color: "#191919", symbolColor: "#fafafa" };
  }
  return { color: "#ffffff", symbolColor: "#0a0a0a" };
}

/** Windows: native caption buttons sit in the custom titlebar via titleBarOverlay. */
function applyWindowsTitleBarOverlay(win: BrowserWindow | null | undefined): void {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return;
  if (typeof win.setTitleBarOverlay !== "function") return;
  const { color, symbolColor } = titleBarChromeColors();
  try {
    win.setTitleBarOverlay({
      color,
      symbolColor,
      height: TITLEBAR_HEIGHT_PX,
    });
  } catch (error) {
    console.warn("[pix] setTitleBarOverlay failed:", error);
  }
}

function applyNonMacWindowChrome(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed() || process.platform === "darwin") return;
  const { color } = titleBarChromeColors();
  try {
    win.setBackgroundColor(color);
  } catch {
    // ignore
  }
  applyWindowsTitleBarOverlay(win);
}

async function createWindow(): Promise<void> {
  // Keep in sync with apps/desktop/src/renderer/lib/desktop-chrome.ts (Synara-aligned).
  const titlebarHeight = TITLEBAR_HEIGHT_PX;
  const trafficDotRadius = 7;
  const trafficLightPosition = {
    x: 16,
    y: Math.round(titlebarHeight / 2 - trafficDotRadius),
  };

  const iconPath = resolveAppIconPath();
  applyAppBranding();

  const savedWindow = resolveWindowCreateOptions(loadDesktopPrefs().window);
  const chrome = titleBarChromeColors();

  mainWindow = new BrowserWindow({
    width: savedWindow.width,
    height: savedWindow.height,
    ...(savedWindow.x !== undefined && savedWindow.y !== undefined
      ? { x: savedWindow.x, y: savedWindow.y }
      : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: "Pix",
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    // macOS: traffic lights in the sidebar titlebar + real sidebar vibrancy (true glass).
    // Windows/Linux: frameless custom titlebar (hidden system title strip); drag via -webkit-app-region.
    // Windows keeps native min/max/close via titleBarOverlay; Linux uses renderer caption buttons.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition,
          vibrancy: "sidebar" as const,
          visualEffectState: "active" as const,
          transparent: true,
          backgroundColor: "#00000000",
        }
      : {
          backgroundColor: chrome.color,
          autoHideMenuBar: true,
          titleBarStyle: "hidden" as const,
          ...(process.platform === "win32"
            ? {
                titleBarOverlay: {
                  color: chrome.color,
                  symbolColor: chrome.symbolColor,
                  height: titlebarHeight,
                },
              }
            : {}),
        }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "..", "preload", "preload.cjs"),
    },
  });
  attachWindowBoundsPersistence(mainWindow);
  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("pix:window:state", {
      isMaximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (savedWindow.isMaximized) mainWindow.maximize();
    mainWindow.show();
  });
  supervisor = new HostSupervisor(mainWindow);
  await mainWindow.loadFile(join(currentDirectory, "..", "renderer", "index.html"));
  // Fallback if ready-to-show already fired before listener (rare on some platforms).
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    if (savedWindow.isMaximized) mainWindow.maximize();
    mainWindow.show();
  }
}

// Identity early (before ready). Full branding (About icon/Dock) re-applied in whenReady.
if (process.platform === "win32") {
  app.setAppUserModelId("dev.pix.app");
}
app.setName("Pix");

function openSystemNotificationSettings(): void {
  if (process.platform === "darwin") {
    // Ventura+ Settings app
    void shell
      .openExternal("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
      .catch(() => {
        void shell.openExternal("x-apple.systempreferences:com.apple.preference.notifications");
      });
    return;
  }
  if (process.platform === "win32") {
    void shell.openExternal("ms-settings:notifications");
    return;
  }
  // Linux: no single standard deep-link.
  void shell
    .openExternal("https://wiki.archlinux.org/title/Desktop_notifications")
    .catch(() => undefined);
}

/** Keep Notification instances alive until closed (GC otherwise drops them before show). */
const liveOsNotifications = new Set<InstanceType<typeof Notification>>();

export type ShowOsNotificationPayload = {
  title: string;
  body?: string;
  silent?: boolean;
  /** Always attempt (settings test). */
  force?: boolean;
  /** Skip when the main window is focused (checked in main — not renderer hasFocus). */
  requireUnfocused?: boolean;
};

function focusMainWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Post a desktop OS notification from the main process.
 * Returns whether the OS accepted/showed it (listens for `show` / `failed`).
 */
async function showOsNotification(payload: ShowOsNotificationPayload): Promise<boolean> {
  try {
    if (!Notification.isSupported()) {
      console.warn("[pix] notifications unsupported on this platform");
      return false;
    }
    const title = payload?.title?.trim();
    if (!title) return false;

    if (!payload.force && payload.requireUnfocused) {
      const focused = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
      if (focused) return false;
    }

    // Some hosts suppress empty-body banners; always provide a body string.
    const body = payload.body?.trim() || title;
    const iconPath = resolveAppIconPath();
    const options: Electron.NotificationConstructorOptions = {
      title,
      body,
      silent: payload.silent === true,
    };
    // macOS uses the app bundle icon; Windows/Linux need an explicit path.
    if (iconPath && process.platform !== "darwin") {
      options.icon = iconPath;
    }
    if (process.platform === "linux") {
      options.urgency = "normal";
    }

    const n = new Notification(options);
    liveOsNotifications.add(n);

    const drop = () => liveOsNotifications.delete(n);
    n.once("close", drop);
    n.once("click", () => {
      focusMainWindow();
      drop();
    });

    const shown = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      n.once("show", () => finish(true));
      n.once("failed", (_event, error) => {
        console.warn("[pix] notification failed:", error);
        drop();
        finish(false);
      });
      // Linux / some macOS builds never emit `show`; treat no-failure as success.
      setTimeout(() => finish(true), 800);
      try {
        n.show();
      } catch (error) {
        console.warn("[pix] notification show() threw:", error);
        drop();
        finish(false);
      }
    });

    return shown;
  } catch (error) {
    console.warn("[pix] notification error:", error);
    return false;
  }
}

void app
  .whenReady()
  .then(async () => {
    // Name + About/Dock icon (must be after ready for About panel iconPath on some builds).
    applyAppBranding();
    // Default Electron File/Edit/View/Window menu is English-only and not product chrome.
    // macOS keeps a minimal app menu (required for standard shortcuts / system UX).
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            role: "appMenu",
          },
          {
            role: "editMenu",
          },
          {
            role: "windowMenu",
          },
        ]),
      );
    } else {
      Menu.setApplicationMenu(null);
    }
    ipcMain.handle("pix:app:get-runtime", () => ({
      platform: process.platform,
      isPackaged: app.isPackaged,
      enableTestCommands:
        process.env.PIX_ENABLE_TEST_COMMANDS === "1" ||
        process.env.PIX_ENABLE_TEST_COMMANDS === "true",
      /** Windows uses native titleBarOverlay buttons; Linux needs renderer caption buttons. */
      customWindowControls: process.platform === "linux",
    }));
    ipcMain.handle("pix:window:minimize", () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    });
    ipcMain.handle("pix:window:toggle-maximize", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      return mainWindow.isMaximized();
    });
    ipcMain.handle("pix:window:close", () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
    ipcMain.handle("pix:window:is-maximized", () =>
      Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
    );
    ipcMain.handle("pix:appearance:set-theme-source", (_event, source: unknown) => {
      if (source !== "light" && source !== "dark" && source !== "system") {
        throw new Error("Invalid native theme source");
      }
      nativeTheme.themeSource = source;
      applyNonMacWindowChrome(mainWindow);
    });
    nativeTheme.on("updated", () => {
      applyNonMacWindowChrome(mainWindow);
    });

    const broadcastPiProgress = (event: PiCliProgressEvent) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(PI_PROGRESS_CHANNEL, event);
    };
    const runEnsurePiCli = async () => {
      const result = await ensurePiCli({ onProgress: broadcastPiProgress });
      // Fresh install only: gently re-read config. Do not force-kill a healthy host mid-start
      // (that surfaces as "Agent Host exited with code 0" on Windows).
      if (result.installedNow && supervisor) {
        try {
          await supervisor.start({ force: false });
        } catch (error) {
          console.warn("[pix] host refresh after pi install failed:", error);
        }
      }
      return result;
    };
    ipcMain.handle("pix:pi:ensure", () => runEnsurePiCli());

    await createWindow();
    // Do not wait for the renderer effect — start ensure as soon as the window exists
    // so `pnpm dev` installs even if React remounts cancel the first UI call.
    void runEnsurePiCli().catch((error) => {
      console.warn("[pix] pi ensure failed:", error);
    });

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
        options: { path?: string; branch?: string; newBranch?: string; cwd?: string },
      ) => {
        const path = resolveWorkspaceCwd(options?.cwd, supervisor?.getWorkspaceCwd());
        return createGitWorktree(path, options);
      },
    );
    ipcMain.handle("pix:workspace:get-worktree-prefs", (_event, cwd?: string) => {
      const path =
        typeof cwd === "string" && cwd.trim() ? cwd : (supervisor?.getWorkspaceCwd() ?? undefined);
      return getWorktreePrefsView(path);
    });
    ipcMain.handle(
      "pix:workspace:set-worktree-prefs",
      (
        _event,
        patch: { rootConfigured?: string; autoDelete?: boolean; autoDeleteLimit?: number },
      ) => setWorktreePrefs(patch ?? {}),
    );
    ipcMain.handle("pix:workspace:get-git-prefs", () => getGitPrefs());
    ipcMain.handle(
      "pix:workspace:set-git-prefs",
      (
        _event,
        patch: {
          branchPrefix?: string;
          pullMode?: "merge" | "squash";
          forcePush?: boolean;
          draftPr?: boolean;
          customCommitCommand?: string;
          customPrCommand?: string;
          modelProvider?: string;
          modelId?: string;
        },
      ) => setGitPrefs(patch ?? {}),
    );
    ipcMain.handle("pix:workspace:reveal-in-folder", (_event, cwd: string) => {
      if (typeof cwd === "string" && cwd.trim()) shell.showItemInFolder(cwd);
    });
    ipcMain.handle("pix:workspace:open-file", async (_event, path: string) => {
      if (typeof path !== "string" || !path.trim()) throw new Error("Invalid file path");
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    });
    ipcMain.handle("pix:workspace:open-external", async (_event, url: string) => {
      if (typeof url !== "string") throw new Error("Invalid external URL");
      const protocol = new URL(url).protocol;
      if (!new Set(["http:", "https:", "mailto:"]).has(protocol)) {
        throw new Error(`Unsupported external URL protocol: ${protocol}`);
      }
      await shell.openExternal(url);
    });
    ipcMain.handle("pix:workspace:ensure-default", () => ensureDefaultWorkspacePath());
    ipcMain.handle("pix:workspace:ensure-conversation", () => ensureConversationWorkspacePath());
    ipcMain.handle("pix:workspace:git-status", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return gitStatus(path);
    });
    ipcMain.handle("pix:workspace:git-commit", async (_event, message: string, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return gitCommit(path, message);
    });
    ipcMain.handle("pix:workspace:git-pull", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return gitPull(path);
    });
    ipcMain.handle("pix:workspace:git-push", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return gitPush(path);
    });
    ipcMain.handle(
      "pix:workspace:git-commit-and-push",
      async (_event, message: string, cwd?: string) => {
        const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
        return gitCommitAndPush(path, message);
      },
    );
    ipcMain.handle("pix:workspace:git-generate-commit-message", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return generateCommitMessage(path);
    });
    ipcMain.handle("pix:workspace:open-create-pr", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return openCreatePullRequest(path);
    });
    ipcMain.handle("pix:workspace:list-open-targets", async (_event, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return listOpenTargets(path);
    });
    ipcMain.handle("pix:workspace:open-in-app", async (_event, appId: string, cwd?: string) => {
      const path = resolveWorkspaceCwd(cwd, supervisor?.getWorkspaceCwd());
      return openInApp(appId, path);
    });
    ipcMain.handle("pix:workspace:pick-folder", async () => {
      if (!mainWindow) return undefined;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return undefined;
      return result.filePaths[0];
    });
    ipcMain.handle("pix:workspace:pick-attachments", async () => {
      if (!mainWindow) return [];
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile", "openDirectory", "multiSelections"],
      });
      return result.canceled ? [] : result.filePaths;
    });
    ipcMain.handle(
      "pix:workspace:search-paths",
      async (_event, query?: string, options?: { cwd?: string; limit?: number }) => {
        const fromOpts =
          typeof options?.cwd === "string" && options.cwd.trim() ? options.cwd.trim() : undefined;
        const resolved = fromOpts ?? supervisor?.getWorkspaceCwd();
        if (!resolved || !existsSync(resolved)) return [];
        return searchWorkspacePaths(
          resolved,
          typeof query === "string" ? query : "",
          options?.limit ?? 24,
        );
      },
    );
    ipcMain.handle(
      "pix:workspace:save-clipboard-image",
      async (_event, options?: { bytes?: number[]; ext?: string }) => {
        const dir = join(app.getPath("temp"), "pix-attachments");
        mkdirSync(dir, { recursive: true });
        let buffer: Buffer | undefined;
        let ext =
          typeof options?.ext === "string" && options.ext.trim() ? options.ext.trim() : "png";
        if (Array.isArray(options?.bytes) && options.bytes.length > 0) {
          buffer = Buffer.from(options.bytes);
        } else {
          const image = clipboard.readImage();
          if (image.isEmpty()) return undefined;
          buffer = image.toPNG();
          ext = "png";
        }
        if (!buffer || buffer.length === 0) return undefined;
        const filePath = join(dir, `paste-${Date.now()}.${ext.replace(/^\./, "")}`);
        writeFileSync(filePath, buffer);
        return filePath;
      },
    );
    ipcMain.handle("pix:trust:get", () => supervisor?.getTrust());
    ipcMain.handle("pix:trust:set", (_event, trusted: boolean) => supervisor?.setTrust(trusted));
    ipcMain.handle("pix:models:list", () => supervisor?.listModels());
    ipcMain.handle("pix:models:set", (_event, provider: string, id: string) =>
      supervisor?.setModel(provider, id),
    );
    ipcMain.handle("pix:models:get-config", () => supervisor?.getModelsJsonConfig());
    ipcMain.handle("pix:models:upsert-custom", (_event, input: UpsertCustomProviderInput) =>
      supervisor?.upsertCustomProvider(input),
    );
    ipcMain.handle("pix:models:remove-custom", (_event, provider: string) =>
      supervisor?.removeCustomProvider(provider),
    );
    ipcMain.handle("pix:models:open-config", () => supervisor?.openModelsJson());
    ipcMain.handle("pix:models:reveal-config", () => supervisor?.revealModelsJson());
    ipcMain.handle("pix:thinking:set", (_event, level: string) =>
      supervisor?.setThinkingLevel(level),
    );
    ipcMain.handle("pix:providers:list", () => supervisor?.listProviders());
    ipcMain.handle("pix:providers:usage", () => supervisor?.listProviderUsage());
    ipcMain.handle("pix:providers:set-api-key", (_event, provider: string, apiKey: string) =>
      supervisor?.setProviderApiKey(provider, apiKey),
    );
    ipcMain.handle("pix:providers:clear-auth", (_event, provider: string) =>
      supervisor?.clearProviderAuth(provider),
    );
    ipcMain.handle("pix:providers:oauth-start", (_event, provider: string, operationId?: string) =>
      supervisor?.startProviderOAuth(provider, operationId),
    );
    ipcMain.handle(
      "pix:providers:oauth-respond",
      (_event, operationId: string, promptId: string, value?: string, cancelled?: boolean) =>
        supervisor?.respondProviderOAuth(operationId, promptId, value, cancelled),
    );
    ipcMain.handle("pix:providers:oauth-cancel", (_event, operationId: string) =>
      supervisor?.cancelProviderOAuth(operationId),
    );
    ipcMain.handle("pix:settings:get", () => supervisor?.getPiSettings());
    ipcMain.handle("pix:settings:patch", (_event, patch: PiSettingsPatch) =>
      supervisor?.patchPiSettings(patch),
    );
    ipcMain.handle(
      "pix:agent:prompt",
      (_event, message: string, streamingBehavior?: "steer" | "followUp", imagePaths?: string[]) =>
        supervisor?.prompt(message, streamingBehavior, imagePaths),
    );
    ipcMain.handle("pix:agent:queue-clear", () => supervisor?.clearQueue());
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
    ipcMain.handle("pix:session:create-blank", () => supervisor?.createBlankConversation());
    ipcMain.handle("pix:session:switch", (_event, sessionPath: string) =>
      supervisor?.switchSession(sessionPath),
    );
    ipcMain.handle("pix:session:fork", (_event, entryId?: string) =>
      supervisor?.forkSession(entryId),
    );
    ipcMain.handle("pix:session:tree", () => supervisor?.sessionTree());
    ipcMain.handle(
      "pix:session:navigate-tree",
      (_event, targetId: string, options?: { summarize?: boolean; customInstructions?: string }) =>
        supervisor?.navigateSessionTree(targetId, options),
    );
    ipcMain.handle("pix:session:compact", (_event, instructions?: string) =>
      supervisor?.compactSession(instructions),
    );
    ipcMain.handle("pix:session:set-name", (_event, name: string) =>
      supervisor?.setSessionName(name),
    );
    ipcMain.handle("pix:session:clone", () => supervisor?.cloneSession());
    ipcMain.handle("pix:session:info", () => supervisor?.sessionInfo());
    ipcMain.handle("pix:session:export", (_event, format: "html" | "jsonl", outputPath?: string) =>
      supervisor?.exportSession(format, outputPath),
    );
    ipcMain.handle("pix:session:export-pick", (_event, format: "html" | "jsonl") =>
      supervisor?.exportSessionPick(format),
    );
    ipcMain.handle("pix:session:import", (_event, inputPath: string) =>
      supervisor?.importSession(inputPath),
    );
    ipcMain.handle("pix:session:import-pick", () => supervisor?.importSessionPick());
    ipcMain.handle(
      "pix:session:bash",
      (_event, command: string, options?: { excludeFromContext?: boolean }) =>
        supervisor?.sessionBash(command, options),
    );
    ipcMain.handle("pix:session:copy-last", () => supervisor?.copyLastAssistant());
    ipcMain.handle("pix:session:share", () => supervisor?.shareSession());
    ipcMain.handle("pix:runtime:reload", () => supervisor?.reloadRuntime());
    ipcMain.handle("pix:models:list-scoped", () => supervisor?.listScopedModels());
    ipcMain.handle("pix:models:refresh-catalog", () => supervisor?.refreshModelCatalog());
    ipcMain.handle("pix:packages:list", () => supervisor?.listPackages());
    ipcMain.handle(
      "pix:packages:install",
      (_event, source: string, scope: "global" | "project", options?: { temporary?: boolean }) =>
        supervisor?.installPackage(source, scope, options),
    );
    ipcMain.handle(
      "pix:packages:set-enabled",
      (_event, source: string, scope: "global" | "project", enabled: boolean) =>
        supervisor?.setPackageEnabled(source, scope, enabled),
    );
    ipcMain.handle("pix:packages:remove", (_event, source: string, scope: "global" | "project") =>
      supervisor?.removePackage(source, scope),
    );
    ipcMain.handle("pix:packages:update", (_event, source?: string) =>
      supervisor?.updatePackage(source),
    );
    ipcMain.handle(
      "pix:packages:search-catalog",
      (_event, query?: string, size?: number, from?: number) =>
        searchPiPackageCatalog(query, size, from),
    );
    ipcMain.handle("pix:resources:list", () => supervisor?.listResources());
    ipcMain.handle("pix:extension-ui:respond", (_event, response: ExtensionUiResponse) =>
      supervisor?.extensionUiRespond(response),
    );
    if (process.env.PIX_ENABLE_TEST_COMMANDS === "1") {
      ipcMain.handle("pix:test:crash-host", () => supervisor?.crashHost());
    }

    ipcMain.handle("pix:notifications:show", (_event, payload: ShowOsNotificationPayload) =>
      showOsNotification(payload ?? { title: "" }),
    );
    ipcMain.handle("pix:notifications:open-system-settings", () => {
      openSystemNotificationSettings();
    });

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
