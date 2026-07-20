/**
 * Conversation composer:
 * - Project picker above the card (icon + name)
 * - Textarea
 * - Bottom-left: attach +, access permission
 * - Bottom-right: context usage, model menu (thinking / model / speed), send icon
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { GitBranchInfo, GitContextInfo } from "@pix/contracts";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderGit2,
  Gauge,
  GitBranch,
  Monitor,
  Paperclip,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";
import {
  anchorFromElement,
  anchorFromEvent,
  FloatingMenu,
  type AnchorRect,
} from "./FloatingMenu.tsx";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { t, type Locale } from "../lib/i18n.ts";
import type { AccessMode, AccessVisibility } from "../lib/settings-prefs.ts";
import { visibleAccessModes } from "../lib/settings-prefs.ts";
import { cn } from "../lib/utils.ts";
import { workspaceLabel } from "../lib/workspace.ts";

export type { AccessMode, AccessVisibility };
export type SpeedMode = "fast" | "balanced" | "quality";

export interface ComposerModelOption {
  provider: string;
  id: string;
  name: string;
}

export interface ComposerProps {
  locale: Locale;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onAbort: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  running: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  workspacePath: string | undefined;
  recentWorkspaces: string[];
  onOpenProject: (path: string) => void;
  onAddProject: () => void;
  accessMode: AccessMode;
  onAccessMode: (mode: AccessMode) => void;
  /** Which permission options appear in the menu (from General settings). */
  accessVisibility: AccessVisibility;
  modelOptions: ComposerModelOption[];
  modelValue: string;
  onModelChange: (provider: string, id: string) => void;
  thinkingLevel: string;
  thinkingLevels: string[];
  onThinkingChange: (level: string) => void;
  speedMode: SpeedMode;
  onSpeedMode: (mode: SpeedMode) => void;
  contextPercent: number | undefined;
  contextTokens: number | undefined;
  /** When false, hide context usage chip on the composer. */
  showContextUsage?: boolean;
  projectTrusted: boolean | undefined;
  runState: string;
  piThemeLabel: string;
  /** Optional files attached in UI (names only until agent supports uploads). */
  attachments: string[];
  onAttachFiles: (files: FileList | null) => void;
  onRemoveAttachment: (name: string) => void;
}

type MenuKind = "project" | "local" | "branch" | "access" | "model" | "attach" | null;

function normalizeCwdKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isValidBranchName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (n.includes("..") || n.startsWith("-") || n.endsWith(".lock")) return false;
  if (/[\s~^:?*[\\]/.test(n)) return false;
  return true;
}

function basenameSafe(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts.at(-1) ?? "";
}

function MenuRow(props: {
  icon?: ReactNode;
  label: string;
  description?: string;
  active?: boolean;
  muted?: boolean;
  /** Emphasize label (e.g. warning / danger) */
  emphasize?: "danger" | "none";
  onClick: () => void;
  testId?: string;
}) {
  const danger = props.emphasize === "danger";
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={props.testId}
      className={cn(
        "flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors",
        props.muted
          ? "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          : "text-[var(--popover-foreground,var(--foreground))] hover:bg-[var(--accent)]",
        danger && "hover:bg-red-500/10",
        props.active && !danger && "bg-[var(--accent)]",
        props.active && danger && "bg-red-500/10",
      )}
      onClick={props.onClick}
    >
      {props.icon ? (
        <span
          className={cn(
            "mt-0.5 inline-flex size-4 shrink-0",
            danger ? "text-red-500 opacity-100" : "opacity-70",
          )}
        >
          {props.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] font-medium leading-snug",
            danger && "text-red-500",
          )}
        >
          {props.label}
        </span>
        {props.description ? (
          <span
            className={cn(
              "mt-0.5 block text-[11px] leading-snug",
              danger ? "text-red-500/75" : "text-[var(--text-subtle)]",
            )}
          >
            {props.description}
          </span>
        ) : null}
      </span>
      {props.active ? (
        <span className={cn("mt-0.5 text-[11px]", danger ? "text-red-500" : "text-[#0a84ff]")}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/**
 * Access-control option: rounded card inset from menu edges.
 * Active state highlights text only (not a full-bleed row).
 */
function AccessOption(props: {
  icon: ReactNode;
  label: string;
  description: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={props.testId}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
        "bg-transparent hover:bg-[var(--accent)]",
        props.danger && "hover:bg-red-500/10",
      )}
      onClick={props.onClick}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0",
          props.danger ? "text-red-500" : "text-[var(--muted-foreground)]",
          props.active && !props.danger && "text-[#0a84ff]",
        )}
      >
        {props.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] font-medium leading-snug",
            props.danger ? "text-red-500" : "text-[var(--foreground)]",
            props.active && !props.danger && "text-[#0a84ff]",
          )}
        >
          {props.label}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-[11px] leading-snug",
            props.danger ? "text-red-500/75" : "text-[var(--text-subtle)]",
            props.active && !props.danger && "text-[#0a84ff]/80",
          )}
        >
          {props.description}
        </span>
      </span>
      {props.active ? (
        <span
          className={cn(
            "mt-0.5 shrink-0 text-[11px] font-medium",
            props.danger ? "text-red-500" : "text-[#0a84ff]",
          )}
        >
          ✓
        </span>
      ) : null}
    </button>
  );
}

function MenuSection(props: { title: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium tracking-wide text-[var(--text-subtle)]">
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

/**
 * Hover-only row → right flyout.
 * Open/close timers are owned by the parent so sibling rows can switch without flicker.
 */
function FlyoutRow(props: {
  icon?: ReactNode;
  label: string;
  /** Current selection shown immediately left of the › arrow. */
  valueLabel?: string;
  open: boolean;
  /** Open this flyout immediately (cancels any pending close). */
  onHoverOpen: () => void;
  /** Schedule close after a short delay (cancelled if another flyout opens). */
  onHoverLeave: () => void;
  children: ReactNode;
  testId?: string;
  flyoutTestId?: string;
  minWidth?: number;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setAnchor(anchorFromElement(rowRef.current));
  }, [props.open]);

  function show() {
    setAnchor(anchorFromElement(rowRef.current));
    props.onHoverOpen();
  }

  return (
    <>
      <div
        ref={rowRef}
        role="menuitem"
        data-testid={props.testId}
        className={cn(
          "flex w-full cursor-default items-center gap-2 px-2.5 py-2 text-left text-[13px] transition-colors",
          "text-[var(--popover-foreground,var(--foreground))] hover:bg-[var(--accent)]",
          props.open && "bg-[var(--accent)]",
        )}
        onMouseEnter={show}
        onMouseLeave={props.onHoverLeave}
      >
        {props.icon ? (
          <span className="inline-flex size-4 shrink-0 opacity-70">{props.icon}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium leading-snug">{props.label}</span>
        {props.valueLabel ? (
          <span className="max-w-[6.5rem] shrink-0 truncate text-[12px] text-[var(--text-subtle)]">
            {props.valueLabel}
          </span>
        ) : null}
        <ChevronRight className="size-3.5 shrink-0 opacity-50" strokeWidth={2} />
      </div>
      <FloatingMenu
        open={props.open && Boolean(anchor)}
        anchor={anchor}
        onClose={props.onHoverLeave}
        placement="right"
        zIndex={10_050}
        closeOnOutside={false}
        minWidth={props.minWidth ?? 180}
        className="py-1"
        {...(props.flyoutTestId ? { testId: props.flyoutTestId } : {})}
      >
        <div onMouseEnter={props.onHoverOpen} onMouseLeave={props.onHoverLeave}>
          {props.children}
        </div>
      </FloatingMenu>
    </>
  );
}

function accessIcon(mode: AccessMode, className = "size-3.5") {
  if (mode === "full") return <ShieldAlert className={className} strokeWidth={1.75} />;
  if (mode === "autoReview") return <ShieldCheck className={className} strokeWidth={1.75} />;
  return <Shield className={className} strokeWidth={1.75} />;
}

function accessLabel(locale: Locale, mode: AccessMode): string {
  if (mode === "full") return t(locale, "composer.access.full");
  if (mode === "autoReview") return t(locale, "composer.access.autoReview");
  return t(locale, "composer.access.default");
}

function accessDesc(locale: Locale, mode: AccessMode): string {
  if (mode === "full") return t(locale, "composer.access.fullDesc");
  if (mode === "autoReview") return t(locale, "composer.access.autoReviewDesc");
  return t(locale, "composer.access.defaultDesc");
}

function formatContext(percent: number | undefined, tokens: number | undefined): string {
  if (percent != null && Number.isFinite(percent)) return `${Math.round(percent)}%`;
  if (tokens != null && Number.isFinite(tokens) && tokens > 0) {
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
    return `${tokens}`;
  }
  // No live usage yet — show empty capacity, never a dash.
  return "0%";
}

export function Composer(props: ComposerProps) {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string>) =>
    t(props.locale, key, vars);
  const [menu, setMenu] = useState<MenuKind>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitError, setGitError] = useState<string>();
  /** Which model-submenu flyout is open: thinking | speed */
  const [modelFlyout, setModelFlyout] = useState<"thinking" | "speed" | null>(null);
  const modelFlyoutCloseTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspace = workspaceLabel(props.workspacePath);
  const [gitContext, setGitContext] = useState<GitContextInfo>({});

  async function refreshGitContext(cwd = props.workspacePath) {
    if (!cwd) {
      setGitContext({});
      return;
    }
    try {
      const info = await window.pix.workspace.getGitContext(cwd);
      setGitContext(info ?? {});
    } catch {
      setGitContext({});
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!props.workspacePath) {
      setGitContext({});
      return;
    }
    void window.pix.workspace
      .getGitContext(props.workspacePath)
      .then((info) => {
        if (!cancelled) setGitContext(info ?? {});
      })
      .catch(() => {
        if (!cancelled) setGitContext({});
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspacePath]);

  useEffect(() => {
    if (menu !== "branch" || !props.workspacePath) return;
    let cancelled = false;
    setBranchesLoading(true);
    setGitError(undefined);
    void window.pix.workspace
      .listGitBranches(props.workspacePath)
      .then((list) => {
        if (!cancelled) setBranches(list ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          setBranches([]);
          setGitError(error instanceof Error ? error.message : tr("composer.branch.failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tr is stable per locale
  }, [menu, props.workspacePath, props.locale]);

  function clearModelFlyoutCloseTimer() {
    if (modelFlyoutCloseTimer.current != null) {
      window.clearTimeout(modelFlyoutCloseTimer.current);
      modelFlyoutCloseTimer.current = null;
    }
  }

  function openModelFlyout(kind: "thinking" | "speed") {
    clearModelFlyoutCloseTimer();
    setModelFlyout(kind);
  }

  function scheduleCloseModelFlyout() {
    clearModelFlyoutCloseTimer();
    // Shared delay so moving between sibling rows / into the flyout does not flicker.
    modelFlyoutCloseTimer.current = window.setTimeout(() => {
      modelFlyoutCloseTimer.current = null;
      setModelFlyout(null);
    }, 180);
  }

  useEffect(() => {
    return () => clearModelFlyoutCloseTimer();
  }, []);

  const projectPaths = useMemo(() => {
    const list: string[] = [];
    if (props.workspacePath) list.push(props.workspacePath);
    for (const p of props.recentWorkspaces) list.push(p);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of list) {
      const key = p.replace(/\\/g, "/").replace(/\/+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [props.workspacePath, props.recentWorkspaces]);

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projectPaths;
    return projectPaths.filter((path) => {
      const label = workspaceLabel(path);
      return (
        label.name.toLowerCase().includes(q) ||
        path.toLowerCase().includes(q) ||
        (label.detail?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [projectPaths, projectQuery]);

  const modelLabel = useMemo(() => {
    if (!props.modelValue) return tr("composer.model.none");
    const [provider, id] = props.modelValue.split("/");
    const found = props.modelOptions.find((m) => m.provider === provider && m.id === id);
    return found?.name || id || tr("composer.model.none");
  }, [props.modelValue, props.modelOptions, props.locale]);

  function closeMenu() {
    clearModelFlyoutCloseTimer();
    setMenu(null);
    setAnchor(null);
    setProjectQuery("");
    setBranchQuery("");
    setGitError(undefined);
    setModelFlyout(null);
  }

  function openMenu(kind: MenuKind, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (menu === kind) {
      closeMenu();
      return;
    }
    setGitError(undefined);
    setMenu(kind);
    setAnchor(anchorFromEvent(event.currentTarget));
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

  async function handleCheckoutBranch(name: string) {
    if (!props.workspacePath || gitBusy) return;
    setGitBusy(true);
    setGitError(undefined);
    try {
      const next = await window.pix.workspace.checkoutGitBranch(name, props.workspacePath);
      setGitContext(next);
      closeMenu();
    } catch (error) {
      setGitError(error instanceof Error ? error.message : tr("composer.branch.failed"));
    } finally {
      setGitBusy(false);
    }
  }

  async function handleCreateCheckoutBranch() {
    const name = branchQuery.trim();
    if (!props.workspacePath || !isValidBranchName(name) || gitBusy) return;
    setGitBusy(true);
    setGitError(undefined);
    try {
      const next = await window.pix.workspace.createGitBranch(name, {
        checkout: true,
        cwd: props.workspacePath,
      });
      setGitContext(next);
      closeMenu();
    } catch (error) {
      setGitError(error instanceof Error ? error.message : tr("composer.branch.failed"));
    } finally {
      setGitBusy(false);
    }
  }

  async function handleSwitchToLocal() {
    if (!props.workspacePath || gitBusy) return;
    const main = gitContext.mainWorktreePath;
    if (gitContext.isMainWorktree !== false) {
      closeMenu();
      return;
    }
    if (!main) {
      setGitError(tr("composer.local.failed"));
      return;
    }
    if (normalizeCwdKey(main) === normalizeCwdKey(props.workspacePath)) {
      closeMenu();
      return;
    }
    setGitBusy(true);
    setGitError(undefined);
    try {
      closeMenu();
      props.onOpenProject(main);
    } catch (error) {
      setGitError(error instanceof Error ? error.message : tr("composer.local.failed"));
    } finally {
      setGitBusy(false);
    }
  }

  async function handleNewWorktree() {
    if (!props.workspacePath || gitBusy) return;
    setGitBusy(true);
    setGitError(undefined);
    try {
      const folder = await window.pix.workspace.pickFolder();
      if (!folder) {
        setGitBusy(false);
        return;
      }
      const newBranch = basenameSafe(folder);
      const result = await window.pix.workspace.createGitWorktree({
        path: folder,
        cwd: props.workspacePath,
        ...(newBranch ? { newBranch } : {}),
      });
      closeMenu();
      props.onOpenProject(result.path);
      void refreshGitContext(result.path);
    } catch (error) {
      setGitError(error instanceof Error ? error.message : tr("composer.local.failed"));
    } finally {
      setGitBusy(false);
    }
  }

  const projectMenuOpen = menu === "project";
  const localMenuOpen = menu === "local";
  const branchMenuOpen = menu === "branch";
  const hasProject = Boolean(props.workspacePath);
  const localLabel =
    gitContext.isMainWorktree === false && gitContext.worktree
      ? gitContext.worktree
      : tr("composer.local.label");

  return (
    <div
      className="pointer-events-auto relative mx-auto w-[min(630px,100%)]"
      data-testid="composer-root"
    >
      {/*
        Protrusion: span the flat top of the input (stop at the corner radius = 18px each side).
        No border. Input keeps a complete independent border.
      */}
      <div className="relative z-[2] flex w-full justify-center px-[18px]">
        <div
          className={cn(
            "flex w-full min-w-0 items-center gap-5 px-3 py-1.5",
            "rounded-t-[16px] bg-[var(--bg-composer)]",
            "text-[12px] font-medium text-[var(--foreground)]",
          )}
          data-testid="composer-project-bar"
        >
          <button
            type="button"
            data-testid="composer-project-picker"
            aria-expanded={projectMenuOpen}
            className={cn(
              "inline-flex min-w-0 max-w-[42%] items-center gap-1.5 transition-colors",
              "hover:opacity-80",
              projectMenuOpen && "opacity-100",
            )}
            onClick={(e) => openMenu("project", e)}
          >
            <Folder className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="min-w-0 truncate" data-testid="workspace-name-chip">
              {hasProject ? workspace.name : tr("composer.project.pick")}
            </span>
          </button>

          {hasProject ? (
            <>
              <button
                type="button"
                className={cn(
                  "inline-flex min-w-0 max-w-[26%] items-center gap-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]",
                  localMenuOpen && "text-[var(--foreground)]",
                )}
                title={localLabel}
                data-testid="composer-local"
                aria-expanded={localMenuOpen}
                onClick={(e) => openMenu("local", e)}
              >
                <Monitor className="size-3.5 shrink-0 opacity-75" strokeWidth={1.75} />
                <span className="min-w-0 truncate">{localLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-50" strokeWidth={2} />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex min-w-0 max-w-[26%] items-center gap-1.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]",
                  branchMenuOpen && "text-[var(--foreground)]",
                )}
                title={tr("composer.project.branch")}
                data-testid="composer-git-branch"
                aria-expanded={branchMenuOpen}
                onClick={(e) => openMenu("branch", e)}
              >
                <GitBranch className="size-3.5 shrink-0 opacity-75" strokeWidth={1.75} />
                <span className="min-w-0 truncate">
                  {gitContext.branch || tr("composer.project.noBranch")}
                </span>
                <ChevronDown className="size-3 shrink-0 opacity-50" strokeWidth={2} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Full independent border — not shared / clipped by the protrusion. */}
      <form
        className={cn(
          "relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--bg-composer)]",
          "shadow-[var(--shadow-soft)]",
        )}
        onSubmit={(event) => props.onSubmit(event)}
      >
        {props.attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5" data-testid="composer-attachments">
            {props.attachments.map((name) => (
              <span
                key={name}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[11px] text-[var(--muted-foreground)]"
              >
                <Paperclip className="size-3 opacity-60" strokeWidth={1.75} />
                <span className="min-w-0 truncate">{name}</span>
                <button
                  type="button"
                  className="rounded px-0.5 text-[var(--text-subtle)] hover:text-[var(--foreground)]"
                  aria-label={tr("composer.attach.remove")}
                  onClick={() => props.onRemoveAttachment(name)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <Textarea
          ref={props.composerRef}
          aria-label="Prompt"
          data-testid="prompt-input"
          value={props.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
          onKeyDown={props.onKeyDown}
          placeholder={tr("composer.placeholder")}
          rows={2}
          className="min-h-[52px] border-0 bg-transparent px-3.5 pt-3 pb-1 text-[14px] focus-visible:ring-0"
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          {/* Left: attach + access */}
          <div className="flex min-w-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="composer-attach"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title={tr("composer.attach")}
              aria-label={tr("composer.attach")}
              onClick={(e) => openMenu("attach", e)}
            >
              <Plus className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              data-testid="composer-access"
              className={cn(
                "inline-flex h-8 max-w-[11rem] items-center gap-1 rounded-full px-2",
                "text-[12px] hover:bg-[var(--accent)]",
                props.accessMode === "full"
                  ? "text-red-500 hover:bg-red-500/10 hover:text-red-600"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
              onClick={(e) => openMenu("access", e)}
            >
              {accessIcon(props.accessMode)}
              <span className="min-w-0 truncate">
                {accessLabel(props.locale, props.accessMode)}
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-50" strokeWidth={2} />
            </button>
            {/* legacy probes (hidden) */}
            <span className="hidden" data-testid="trust-chip">
              {props.projectTrusted ? tr("workspace.trusted") : tr("workspace.untrusted")}
            </span>
            <span className="hidden" data-testid="run-state-chip">
              {props.runState}
            </span>
            <span className="hidden" data-testid="pi-theme-label">
              {props.piThemeLabel}
            </span>
          </div>

          {/* Right: context + model + send */}
          <div className="flex shrink-0 items-center gap-1">
            {props.showContextUsage !== false ? (
              <span
                className="inline-flex h-8 items-center rounded-full px-2 text-[11px] tabular-nums text-[var(--text-subtle)]"
                data-testid="usage-chip"
                title={tr("composer.context")}
              >
                {formatContext(props.contextPercent, props.contextTokens)}
              </span>
            ) : null}
            <button
              type="button"
              data-testid="model-select-wrap"
              className={cn(
                "inline-flex h-8 max-w-[10rem] items-center gap-1 rounded-full px-2",
                "text-[12px] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                !props.modelOptions.length && !props.modelValue && "opacity-50",
              )}
              disabled={props.running}
              onClick={(e) => openMenu("model", e)}
            >
              <Sparkles className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
              <span className="min-w-0 truncate" data-testid="model-select-label">
                {modelLabel}
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-50" strokeWidth={2} />
            </button>
            {/* hidden native selects for e2e/compat */}
            <select
              data-testid="model-select"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              value={props.modelValue}
              disabled={!props.modelValue || props.running}
              onChange={(event) => {
                const [provider, id] = event.target.value.split("/");
                if (provider && id) props.onModelChange(provider, id);
              }}
            >
              {(props.modelOptions.length
                ? props.modelOptions
                : props.modelValue
                  ? [
                      {
                        provider: props.modelValue.split("/")[0]!,
                        id: props.modelValue.split("/")[1]!,
                        name: props.modelValue,
                      },
                    ]
                  : []
              ).map((model) => (
                <option
                  key={`${model.provider}/${model.id}`}
                  value={`${model.provider}/${model.id}`}
                >
                  {model.name || model.id}
                </option>
              ))}
            </select>
            <select
              data-testid="thinking-select"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              value={props.thinkingLevel}
              disabled={props.running}
              onChange={(event) => props.onThinkingChange(event.target.value)}
            >
              {props.thinkingLevels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>

            {props.running ? (
              <Button
                type="button"
                size="icon"
                data-testid="abort-prompt"
                onClick={() => props.onAbort()}
                aria-label={tr("composer.stop")}
                className="h-8 w-8 rounded-full bg-red-500 text-white hover:bg-red-600"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                data-testid="send-prompt"
                disabled={!props.prompt.trim()}
                aria-label={tr("composer.start")}
                className="h-8 w-8 rounded-full disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
              </Button>
            )}
          </div>
        </div>
      </form>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="composer-file-input"
        onChange={(e) => {
          props.onAttachFiles(e.target.files);
          e.target.value = "";
          closeMenu();
        }}
      />

      {/* Project menu — simple list, opens upward above the pill (matches reference). */}
      <FloatingMenu
        open={projectMenuOpen && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        placement="top"
        testId="composer-project-menu"
        minWidth={260}
        className="!py-0 overflow-hidden rounded-xl border-[var(--border)] bg-[var(--popover)] shadow-[var(--shadow-soft)]"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 text-[var(--muted-foreground)]">
          <Search className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          <input
            autoFocus
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            placeholder={tr("composer.project.search")}
            data-testid="composer-project-search"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-subtle)]"
          />
        </div>
        <div className="pix-scroll max-h-[220px] overscroll-contain py-0.5">
          {filteredProjects.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-[var(--text-subtle)]">
              {tr("composer.project.empty")}
            </p>
          ) : (
            filteredProjects.map((path) => {
              const label = workspaceLabel(path);
              const active =
                props.workspacePath?.replace(/\\/g, "/").replace(/\/+$/, "") ===
                path.replace(/\\/g, "/").replace(/\/+$/, "");
              return (
                <button
                  key={path}
                  type="button"
                  role="menuitem"
                  data-testid="composer-project-item"
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors",
                    active
                      ? "bg-[var(--accent)] text-[var(--foreground)]"
                      : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                  )}
                  onClick={() => {
                    closeMenu();
                    if (!active) props.onOpenProject(path);
                  }}
                >
                  <Folder className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-[var(--border)]">
          <button
            type="button"
            role="menuitem"
            data-testid="composer-project-add"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
            onClick={() => {
              closeMenu();
              props.onAddProject();
            }}
          >
            <Plus className="size-3.5 shrink-0 opacity-80" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate">{tr("composer.project.add")}</span>
            <ChevronRight className="size-3.5 shrink-0 opacity-45" strokeWidth={2} />
          </button>
        </div>
      </FloatingMenu>

      {/* Local / worktree menu */}
      <FloatingMenu
        open={localMenuOpen && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        placement="top"
        testId="composer-local-menu"
        minWidth={260}
        className="!py-0 overflow-hidden rounded-xl border-[var(--border)] bg-[var(--popover)] shadow-[var(--shadow-soft)]"
      >
        <div className="flex flex-col gap-0.5 p-1.5">
          <button
            type="button"
            role="menuitem"
            data-testid="composer-local-option-local"
            disabled={gitBusy}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
              "hover:bg-[var(--accent)] disabled:opacity-50",
              gitContext.isMainWorktree !== false && "bg-[var(--accent)]/60",
            )}
            onClick={() => void handleSwitchToLocal()}
          >
            <Monitor className="mt-0.5 size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-[var(--foreground)]">
                {tr("composer.local.menuLocal")}
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-subtle)]">
                {tr("composer.local.menuLocalHint")}
              </span>
            </span>
            {gitContext.isMainWorktree !== false ? (
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-[var(--foreground)]"
                strokeWidth={2}
              />
            ) : null}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="composer-local-option-worktree"
            disabled={gitBusy}
            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
            onClick={() => void handleNewWorktree()}
          >
            <FolderGit2 className="mt-0.5 size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-[var(--foreground)]">
                {gitBusy ? tr("composer.local.creating") : tr("composer.local.menuNewWorktree")}
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-subtle)]">
                {tr("composer.local.menuNewWorktreeHint")}
              </span>
            </span>
          </button>
        </div>
        {gitError && menu === "local" ? (
          <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-red-400">
            {gitError}
          </p>
        ) : null}
      </FloatingMenu>

      {/* Branch menu — search + list + create & checkout */}
      <FloatingMenu
        open={branchMenuOpen && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        placement="top"
        testId="composer-branch-menu"
        minWidth={280}
        className="!py-0 overflow-hidden rounded-xl border-[var(--border)] bg-[var(--popover)] shadow-[var(--shadow-soft)]"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 text-[var(--muted-foreground)]">
          <Search className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
          <input
            autoFocus
            value={branchQuery}
            onChange={(e) => setBranchQuery(e.target.value)}
            placeholder={tr("composer.branch.search")}
            data-testid="composer-branch-search"
            disabled={gitBusy}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-subtle)] disabled:opacity-50"
          />
        </div>
        <div className="pix-scroll max-h-[260px] overscroll-contain py-0.5">
          {branchesLoading ? (
            <p className="px-3 py-3 text-[12px] text-[var(--text-subtle)]">
              {tr("composer.branch.loading")}
            </p>
          ) : filteredBranches.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-[var(--text-subtle)]">
              {tr("composer.branch.empty")}
            </p>
          ) : (
            filteredBranches.map((branch) => (
              <button
                key={`${branch.remote ? "r" : "l"}:${branch.name}`}
                type="button"
                role="menuitem"
                data-testid="composer-branch-item"
                disabled={gitBusy}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50",
                  branch.current
                    ? "bg-[var(--accent)] text-[var(--foreground)]"
                    : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                )}
                onClick={() => {
                  if (!branch.current) void handleCheckoutBranch(branch.name);
                  else closeMenu();
                }}
              >
                <GitBranch className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                {branch.remote ? (
                  <span className="shrink-0 text-[10px] text-[var(--text-subtle)]">
                    {tr("composer.branch.remote")}
                  </span>
                ) : null}
                {branch.current ? (
                  <Check className="size-3.5 shrink-0 opacity-80" strokeWidth={2} />
                ) : null}
              </button>
            ))
          )}
        </div>
        {canCreateBranch ? (
          <div className="border-t border-[var(--border)]">
            <button
              type="button"
              role="menuitem"
              data-testid="composer-branch-create"
              disabled={gitBusy}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
              onClick={() => void handleCreateCheckoutBranch()}
            >
              <Plus className="size-3.5 shrink-0 opacity-80" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate">
                {tr("composer.branch.createCheckout", { name: branchQuery.trim() })}
              </span>
            </button>
          </div>
        ) : null}
        {gitError && menu === "branch" ? (
          <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-red-400">
            {gitError}
          </p>
        ) : null}
      </FloatingMenu>

      {/* Attach menu */}
      <FloatingMenu
        open={menu === "attach" && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        testId="composer-attach-menu"
        minWidth={200}
      >
        <MenuRow
          icon={<FilePlus2 className="size-3.5" strokeWidth={1.75} />}
          label={tr("composer.attach.files")}
          testId="composer-attach-files"
          onClick={() => fileInputRef.current?.click()}
        />
      </FloatingMenu>

      {/* Access menu — only options enabled in General → Permissions */}
      <FloatingMenu
        open={menu === "access" && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        testId="composer-access-menu"
        minWidth={288}
        className="!py-0"
      >
        <div className="flex flex-col gap-1.5 p-2">
          {visibleAccessModes(props.accessVisibility).map((mode) => (
            <AccessOption
              key={mode}
              icon={accessIcon(mode)}
              label={accessLabel(props.locale, mode)}
              description={accessDesc(props.locale, mode)}
              danger={mode === "full"}
              active={props.accessMode === mode}
              testId={`composer-access-${mode}`}
              onClick={() => {
                props.onAccessMode(mode);
                closeMenu();
              }}
            />
          ))}
        </div>
      </FloatingMenu>

      {/* Model menu: models + hover flyouts (thinking above speed, open right) */}
      <FloatingMenu
        open={menu === "model" && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        testId="composer-model-menu"
        minWidth={240}
      >
        <MenuSection title={tr("composer.model.models")}>
          {props.modelOptions.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12px] text-[var(--text-subtle)]">
              {tr("composer.model.none")}
            </p>
          ) : (
            props.modelOptions.map((model) => {
              const value = `${model.provider}/${model.id}`;
              return (
                <MenuRow
                  key={value}
                  label={model.name || model.id}
                  active={props.modelValue === value}
                  testId={`composer-model-${model.id}`}
                  onClick={() => {
                    props.onModelChange(model.provider, model.id);
                    closeMenu();
                  }}
                />
              );
            })
          )}
        </MenuSection>
        <div className="mx-2 border-t border-[var(--border)]" />

        {/* 思考强度 above 速度; hover flyout; current value left of › */}
        <FlyoutRow
          icon={<Sparkles className="size-3.5" strokeWidth={1.75} />}
          label={tr("composer.model.thinking")}
          valueLabel={props.thinkingLevel}
          open={modelFlyout === "thinking"}
          onHoverOpen={() => openModelFlyout("thinking")}
          onHoverLeave={scheduleCloseModelFlyout}
          testId="composer-thinking-flyout-trigger"
          flyoutTestId="composer-thinking-flyout"
          minWidth={160}
        >
          {props.thinkingLevels.map((level) => (
            <MenuRow
              key={level}
              label={level}
              active={props.thinkingLevel === level}
              testId={`composer-thinking-${level}`}
              onClick={() => {
                props.onThinkingChange(level);
                clearModelFlyoutCloseTimer();
                setModelFlyout(null);
              }}
            />
          ))}
        </FlyoutRow>

        <FlyoutRow
          icon={<Gauge className="size-3.5" strokeWidth={1.75} />}
          label={tr("composer.model.speed")}
          valueLabel={
            props.speedMode === "fast"
              ? tr("composer.speed.fast")
              : props.speedMode === "quality"
                ? tr("composer.speed.quality")
                : tr("composer.speed.balanced")
          }
          open={modelFlyout === "speed"}
          onHoverOpen={() => openModelFlyout("speed")}
          onHoverLeave={scheduleCloseModelFlyout}
          testId="composer-speed-flyout-trigger"
          flyoutTestId="composer-speed-flyout"
          minWidth={160}
        >
          {(
            [
              ["fast", tr("composer.speed.fast")],
              ["balanced", tr("composer.speed.balanced")],
              ["quality", tr("composer.speed.quality")],
            ] as const
          ).map(([mode, label]) => (
            <MenuRow
              key={mode}
              label={label}
              active={props.speedMode === mode}
              testId={`composer-speed-${mode}`}
              onClick={() => {
                props.onSpeedMode(mode);
                clearModelFlyoutCloseTimer();
                setModelFlyout(null);
              }}
            />
          ))}
        </FlyoutRow>
      </FloatingMenu>
    </div>
  );
}
