/**
 * Docked right env rail: squeezes the thread content (not an overlay).
 * Height follows content. Submenus are FloatingMenu portals (not clipped by the panel).
 */
import type { DetectedApp, GitBranchInfo, GitContextInfo, GitStatusSummary } from "@pix/contracts";
import {
  ChevronRight,
  ExternalLink,
  FileDiff,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Laptop,
  Monitor,
  Settings as SettingsIcon,
  SquareTerminal,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { t, type Locale, type MessageKey } from "../lib/i18n.ts";
import {
  loadEnvPanelVisibility,
  type EnvPanelVisibility,
} from "../lib/env-panel-prefs.ts";
import { cn } from "../lib/utils.ts";
import { useShellStore } from "../store/shell-store.ts";
import { anchorFromEvent, FloatingMenu, type AnchorRect } from "./FloatingMenu.tsx";

export const ENV_PANEL_WIDTH_PX = 300;
/** Minimum width left for timeline/composer when env rail is open (matches composer default). */
export const ENV_PANEL_MIN_CONTENT_PX = 630;

type FlyoutId = "changes" | "local" | "branch" | "git" | "openIn" | null;
type CommitMode = "commit" | "commitAndPush";

function normalizeCwdKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isValidBranchName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length > 120) return false;
  if (n.startsWith(".") || n.endsWith(".lock")) return false;
  if (n.includes("..") || n.includes("//") || n.includes("@{")) return false;
  if (n.endsWith("/") || n.endsWith(".")) return false;
  if (/[\s~^:?*[\\]/.test(n) || n.includes("\0")) return false;
  return true;
}

export function EnvPanel(props: {
  locale: Locale;
  cwd: string | undefined;
  open: boolean;
  onOpenSettings?: () => void;
  onOpenProject?: (path: string) => void;
}) {
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(props.locale, key, vars);
  const showAppError = useShellStore((s) => s.showAppError);
  const [visibility, setVisibility] = useState<EnvPanelVisibility>(loadEnvPanelVisibility);
  const [status, setStatus] = useState<GitStatusSummary | undefined>();
  const [gitContext, setGitContext] = useState<GitContextInfo>({
    branch: "—",
    worktree: "本地",
    isMainWorktree: true,
  });
  const [apps, setApps] = useState<DetectedApp[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMode, setCommitMode] = useState<CommitMode>("commit");
  const [commitGenerating, setCommitGenerating] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [flyout, setFlyout] = useState<FlyoutId>(null);
  const [flyoutAnchor, setFlyoutAnchor] = useState<AnchorRect | null>(null);

  const refresh = useCallback(async () => {
    if (!props.cwd) {
      setStatus(undefined);
      setApps([]);
      setBranches([]);
      setGitContext({ branch: "—", worktree: "本地", isMainWorktree: true });
      return;
    }
    setBusy(true);
    try {
      const [st, targets, ctx, br] = await Promise.all([
        window.pix.workspace.gitStatus(props.cwd).catch(() => undefined),
        window.pix.workspace.listOpenTargets(props.cwd).catch(() => [] as DetectedApp[]),
        window.pix.workspace
          .getGitContext(props.cwd)
          .catch((): GitContextInfo => ({ branch: "—", worktree: "本地", isMainWorktree: true })),
        window.pix.workspace.listGitBranches(props.cwd).catch(() => [] as GitBranchInfo[]),
      ]);
      setStatus(st);
      setApps(targets);
      setGitContext(ctx);
      setBranches(br);
    } finally {
      setBusy(false);
    }
  }, [props.cwd]);

  useEffect(() => {
    if (!props.open) {
      setFlyout(null);
      setFlyoutAnchor(null);
      setCommitOpen(false);
      return;
    }
    setVisibility(loadEnvPanelVisibility());
    void refresh();
  }, [props.open, props.cwd, refresh]);

  useEffect(() => {
    const onPrefs = () => setVisibility(loadEnvPanelVisibility());
    window.addEventListener("pix-env-panel-prefs", onPrefs);
    return () => window.removeEventListener("pix-env-panel-prefs", onPrefs);
  }, []);

  async function runGit(action: () => Promise<GitStatusSummary>) {
    setBusy(true);
    try {
      setStatus(await action());
      setCommitMsg("");
      setCommitOpen(false);
      setCommitMode("commit");
      void refresh();
    } catch (error) {
      showAppError(error instanceof Error ? error.message : tr("env.error.git"));
    } finally {
      setBusy(false);
    }
  }

  function closeFlyout() {
    setFlyout(null);
    setFlyoutAnchor(null);
  }

  function openFlyout(id: Exclude<FlyoutId, null>, event: ReactMouseEvent) {
    event.stopPropagation();
    if (flyout === id) {
      closeFlyout();
      return;
    }
    setFlyoutAnchor(anchorFromEvent(event.currentTarget));
    setFlyout(id);
  }

  const filteredBranches = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, branchQuery]);

  const canCreateBranch = useMemo(() => {
    const name = branchQuery.trim();
    if (!isValidBranchName(name)) return false;
    return !branches.some((b) => b.name === name || b.name.endsWith(`/${name}`));
  }, [branchQuery, branches]);

  if (!props.open) return null;

  const plusIns = status?.insertions ?? 0;
  const plusDel = status?.deletions ?? 0;
  const changeTrailing =
    status && !status.clean ? (
      <span className="tabular-nums text-[12px]">
        {plusIns > 0 ? <span className="text-emerald-500">+{plusIns.toLocaleString()}</span> : null}
        {plusIns > 0 && plusDel > 0 ? " " : null}
        {plusDel > 0 ? <span className="text-red-400">-{plusDel.toLocaleString()}</span> : null}
        {plusIns === 0 && plusDel === 0 ? (
          <span className="text-[var(--text-subtle)]">{status.changes.length}</span>
        ) : null}
      </span>
    ) : null;

  const localLabel =
    gitContext.isMainWorktree === false && gitContext.worktree
      ? gitContext.worktree
      : tr("composer.local.label");

  const flyoutContent =
    flyout === "changes" ? (
      !status ? (
        <p className="m-0 px-2.5 py-2 text-[12px] text-[var(--text-subtle)]">{tr("env.notGit")}</p>
      ) : status.clean ? (
        <p className="m-0 px-2.5 py-2 text-[12px] text-[var(--text-subtle)]">{tr("env.clean")}</p>
      ) : (
        <ul className="m-0 max-h-[min(50vh,320px)] list-none space-y-0.5 overflow-y-auto p-1.5">
          {status.changes.map((c) => (
            <li
              key={`${c.status}:${c.path}`}
              className="flex min-w-0 gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px]"
            >
              <span className="w-4 shrink-0 text-[var(--text-subtle)]">{c.status}</span>
              <span className="min-w-0 truncate">{c.path}</span>
            </li>
          ))}
        </ul>
      )
    ) : flyout === "local" ? (
      <div className="flex flex-col gap-0.5 p-1">
        <ActionRow
          icon={<Monitor className="size-3.5" strokeWidth={1.75} />}
          label={tr("composer.local.menuLocal")}
          disabled={busy || gitContext.isMainWorktree !== false}
          onClick={() => {
            const main = gitContext.mainWorktreePath;
            if (!main || !props.cwd) return;
            if (normalizeCwdKey(main) === normalizeCwdKey(props.cwd)) {
              closeFlyout();
              return;
            }
            closeFlyout();
            props.onOpenProject?.(main);
          }}
        />
        <ActionRow
          icon={<Folder className="size-3.5" strokeWidth={1.75} />}
          label={tr("composer.local.menuNewWorktree")}
          disabled={busy}
          onClick={() => {
            void (async () => {
              if (!props.cwd || busy) return;
              setBusy(true);
              try {
                const stamp = new Date().toISOString().slice(0, 10);
                const result = await window.pix.workspace.createGitWorktree({
                  cwd: props.cwd,
                  newBranch: stamp,
                });
                closeFlyout();
                props.onOpenProject?.(result.path);
              } catch (error) {
                showAppError(
                  error instanceof Error ? error.message : tr("composer.local.failed"),
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
        {props.cwd ? (
          <p className="m-0 break-all px-2 pb-1.5 pt-1 font-mono text-[10px] text-[var(--text-subtle)]">
            {props.cwd}
          </p>
        ) : null}
      </div>
    ) : flyout === "branch" ? (
      <div className="flex max-h-[min(55vh,380px)] min-w-[220px] flex-col gap-2 p-2">
        <input
          className="h-8 w-full rounded-md border border-[var(--border)] bg-transparent px-2 text-[12px] outline-none focus:border-[var(--ring,#0a84ff)]"
          placeholder={tr("composer.branch.search")}
          value={branchQuery}
          disabled={busy}
          onChange={(e) => setBranchQuery(e.target.value)}
        />
        {canCreateBranch ? (
          <button
            type="button"
            className="rounded-md bg-[var(--accent)] px-2 py-1.5 text-left text-[12px] font-medium"
            disabled={busy}
            onClick={() => {
              void (async () => {
                const name = branchQuery.trim();
                if (!props.cwd || !isValidBranchName(name)) return;
                setBusy(true);
                try {
                  const next = await window.pix.workspace.createGitBranch(name, {
                    checkout: true,
                    cwd: props.cwd,
                  });
                  setGitContext(next);
                  setBranchQuery("");
                  closeFlyout();
                  void refresh();
                } catch (error) {
                  showAppError(
                    error instanceof Error ? error.message : tr("composer.branch.failed"),
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {tr("env.createBranch")}: {branchQuery.trim()}
          </button>
        ) : null}
        <div className="pix-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {filteredBranches.map((b) => (
            <button
              key={b.name}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[var(--accent)]",
                b.current && "bg-[var(--accent)] font-medium",
              )}
              disabled={busy || b.current}
              onClick={() => {
                void (async () => {
                  if (!props.cwd || busy) return;
                  setBusy(true);
                  try {
                    const next = await window.pix.workspace.checkoutGitBranch(b.name, props.cwd);
                    setGitContext(next);
                    closeFlyout();
                    void refresh();
                  } catch (error) {
                    showAppError(
                      error instanceof Error ? error.message : tr("composer.branch.failed"),
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <GitBranch className="size-3 shrink-0 opacity-70" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
            </button>
          ))}
        </div>
      </div>
    ) : flyout === "git" ? (
      <div className="flex flex-col gap-0.5 p-1">
        <ActionRow
          icon={<GitCommitHorizontal className="size-3.5" strokeWidth={1.75} />}
          label={tr("env.commit")}
          disabled={busy}
          onClick={() => {
            closeFlyout();
            setCommitMode("commit");
            setCommitOpen(true);
          }}
        />
        <ActionRow
          icon={<Upload className="size-3.5" strokeWidth={1.75} />}
          label={tr("env.push")}
          disabled={busy}
          onClick={() => {
            closeFlyout();
            void runGit(() => window.pix.workspace.gitPush(props.cwd));
          }}
        />
        <ActionRow
          icon={<GitCommitHorizontal className="size-3.5" strokeWidth={1.75} />}
          label={tr("env.commitAndPush")}
          disabled={busy}
          onClick={() => {
            closeFlyout();
            setCommitMode("commitAndPush");
            setCommitOpen(true);
          }}
        />
        <ActionRow
          icon={<GitBranch className="size-3.5" strokeWidth={1.75} />}
          label={tr("env.pull")}
          disabled={busy}
          onClick={() => {
            closeFlyout();
            void runGit(() => window.pix.workspace.gitPull(props.cwd));
          }}
        />
        <ActionRow
          icon={<GitPullRequest className="size-3.5" strokeWidth={1.75} />}
          label={tr("env.createPr")}
          disabled={busy}
          onClick={() => {
            closeFlyout();
            void window.pix.workspace
              .openCreatePullRequest(props.cwd)
              .catch((error) =>
                showAppError(error instanceof Error ? error.message : tr("env.error.git")),
              );
          }}
        />
      </div>
    ) : flyout === "openIn" ? (
      <div className="flex max-h-[min(50vh,280px)] flex-col gap-0.5 overflow-y-auto p-1">
        {apps.length === 0 ? (
          <p className="m-0 px-2 py-1.5 text-[12px] text-[var(--text-subtle)]">{tr("env.noApps")}</p>
        ) : (
          apps.map((app) => (
            <button
              key={app.id}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--accent)]"
              disabled={busy}
              onClick={() => {
                closeFlyout();
                void window.pix.workspace
                  .openInApp(app.id, props.cwd)
                  .catch((error) =>
                    showAppError(error instanceof Error ? error.message : tr("env.error.open")),
                  );
              }}
            >
              <span className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[4px]">
                {app.iconDataUrl ? (
                  <img
                    src={app.iconDataUrl}
                    alt=""
                    className="size-5 object-contain"
                    draggable={false}
                  />
                ) : app.kind === "finder" ? (
                  <Folder className="size-3.5 opacity-70" strokeWidth={1.75} />
                ) : app.kind === "terminal" ? (
                  <SquareTerminal className="size-3.5 opacity-70" strokeWidth={1.75} />
                ) : (
                  <ExternalLink className="size-3.5 opacity-70" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {app.kind === "finder"
                  ? tr("env.showIn", { name: app.name })
                  : tr("env.openInApp", { name: app.name })}
              </span>
            </button>
          ))
        )}
      </div>
    ) : null;

  return (
    <aside
      className={cn(
        "env-panel relative z-10 mt-2 mb-2 ml-0 mr-4 flex shrink-0 flex-col self-start overflow-hidden",
        "rounded-2xl border border-[var(--border)] bg-[var(--popover)] shadow-lg",
      )}
      style={{
        width: ENV_PANEL_WIDTH_PX,
        maxHeight: "calc(100% - 16px)",
      }}
      data-testid="env-panel"
      data-open="true"
    >
      {/* Group header (same size as sidebar「项目」) + settings gear */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2.5 pt-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide text-[var(--text-subtle)]">
          {tr("env.title")}
        </span>
        {props.onOpenSettings ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title={tr("env.openSettings")}
            aria-label={tr("env.openSettings")}
            data-testid="env-panel-settings"
            onClick={props.onOpenSettings}
          >
            <SettingsIcon className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <div className="overflow-y-auto px-1 pb-1.5">
        {!props.cwd ? (
          <p className="m-0 px-2 py-2 text-[12px] text-[var(--muted-foreground)]">
            {tr("env.noCwd")}
          </p>
        ) : (
          <div className="flex flex-col">
            {visibility.changes ? (
              <MenuRow
                icon={<FileDiff className="size-3.5" strokeWidth={1.75} />}
                label={tr("env.changes")}
                trailing={changeTrailing}
                active={flyout === "changes"}
                onClick={(e) => openFlyout("changes", e)}
                disabled={busy}
              />
            ) : null}
            {visibility.cwd ? (
              <MenuRow
                icon={<Monitor className="size-3.5" strokeWidth={1.75} />}
                label={localLabel}
                active={flyout === "local"}
                onClick={(e) => openFlyout("local", e)}
                disabled={busy}
              />
            ) : null}
            {visibility.branch ? (
              <MenuRow
                icon={<GitBranch className="size-3.5" strokeWidth={1.75} />}
                label={status?.branch || gitContext.branch || tr("env.branchUnknown")}
                active={flyout === "branch"}
                onClick={(e) => openFlyout("branch", e)}
                disabled={busy}
              />
            ) : null}
            {visibility.gitActions ? (
              <MenuRow
                icon={<GitCommitHorizontal className="size-3.5" strokeWidth={1.75} />}
                label={tr("env.gitActions")}
                active={flyout === "git"}
                onClick={(e) => openFlyout("git", e)}
                disabled={busy}
              />
            ) : null}
            {visibility.openIn ? (
              <MenuRow
                icon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}
                label={tr("env.openIn")}
                active={flyout === "openIn"}
                onClick={(e) => openFlyout("openIn", e)}
                disabled={busy}
              />
            ) : null}
            {visibility.localServices ? (
              <MenuRow
                icon={<Laptop className="size-3.5" strokeWidth={1.75} />}
                label={tr("env.localServices")}
                trailing={
                  <span className="text-[11px] text-[var(--text-subtle)]">
                    {tr("env.localServicesEmpty")}
                  </span>
                }
                muted
                showChevron={false}
              />
            ) : null}
          </div>
        )}
      </div>

      <FloatingMenu
        open={Boolean(flyout && flyoutAnchor && props.cwd)}
        anchor={flyoutAnchor}
        onClose={closeFlyout}
        placement="left"
        minWidth={220}
        zIndex={12_000}
        testId={flyout ? `env-flyout-${flyout}` : "env-flyout"}
        className="!py-0"
      >
        {flyoutContent}
      </FloatingMenu>

      <CommitDialog
        open={commitOpen}
        locale={props.locale}
        busy={busy}
        generating={commitGenerating}
        value={commitMsg}
        mode={commitMode}
        cwd={props.cwd}
        onChange={setCommitMsg}
        onCancel={() => {
          if (commitGenerating) return;
          setCommitOpen(false);
          setCommitMode("commit");
          setCommitMsg("");
        }}
        onConfirm={async () => {
          let msg = commitMsg.trim();
          if (!msg) {
            setCommitGenerating(true);
            try {
              msg = (await window.pix.workspace.gitGenerateCommitMessage(props.cwd)).trim();
              setCommitMsg(msg);
            } catch (error) {
              showAppError(
                error instanceof Error ? error.message : tr("env.commitGenerateFailed"),
              );
              return;
            } finally {
              setCommitGenerating(false);
            }
          }
          if (!msg) {
            showAppError(tr("env.commitGenerateFailed"));
            return;
          }
          if (commitMode === "commitAndPush") {
            await runGit(() => window.pix.workspace.gitCommitAndPush(msg, props.cwd));
          } else {
            await runGit(() => window.pix.workspace.gitCommit(msg, props.cwd));
          }
        }}
      />
    </aside>
  );
}

function MenuRow(props: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  active?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  muted?: boolean;
  showChevron?: boolean;
}) {
  const showChevron = props.showChevron !== false;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors",
        props.muted
          ? "cursor-default text-[var(--text-subtle)]"
          : "text-[var(--foreground)] hover:bg-[var(--accent)]",
        props.active && "bg-[var(--accent)]",
        props.disabled && "opacity-50",
      )}
      disabled={props.disabled || props.muted}
      onClick={props.onClick}
    >
      <span className="opacity-70">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{props.label}</span>
      {props.trailing}
      {showChevron && !props.muted ? (
        <ChevronRight className="size-3.5 shrink-0 opacity-50" strokeWidth={2} />
      ) : null}
    </button>
  );
}

function ActionRow(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12px] text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-40"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="opacity-70">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}

function CommitDialog(props: {
  open: boolean;
  locale: Locale;
  busy: boolean;
  generating?: boolean;
  value: string;
  mode: CommitMode;
  cwd?: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const tr = (key: MessageKey) => t(props.locale, key);
  const locked = props.busy || Boolean(props.generating);
  useEffect(() => {
    if (!props.open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (!locked) props.onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onCancel, locked]);

  if (!props.open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4"
      data-testid="env-commit-dialog"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) props.onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--popover)] p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 mb-2 text-[15px] font-semibold text-[var(--foreground)]">
          {props.mode === "commitAndPush" ? tr("env.commitAndPush") : tr("env.commit")}
        </h2>
        <textarea
          className="mb-3 min-h-[96px] w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[var(--ring,#0a84ff)] disabled:opacity-60"
          placeholder={
            props.generating ? tr("env.commitMessageGenerating") : tr("env.commitMessage")
          }
          value={props.value}
          disabled={locked}
          autoFocus
          onChange={(e) => props.onChange(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-8 rounded-lg px-3 text-[13px] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
            onClick={props.onCancel}
            disabled={locked}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="h-8 rounded-lg bg-[#0a84ff] px-3.5 text-[13px] font-medium text-white hover:bg-[#0a84ff]/90 disabled:opacity-40"
            disabled={locked}
            data-testid="env-commit-confirm"
            onClick={() => void props.onConfirm()}
          >
            {props.generating
              ? tr("env.commitMessageGenerating")
              : props.mode === "commitAndPush"
                ? tr("env.commitAndPush")
                : tr("env.commit")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
