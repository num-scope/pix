/**
 * Conversation composer:
 * - Project picker above the card (icon + name)
 * - Textarea
 * - Bottom-left: attach +, access permission
 * - Bottom-right: context usage, model menu (thinking / model / speed), send icon
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type {
  GitBranchInfo,
  GitContextInfo,
  PackageSummary,
  QueuedMessages,
  SlashCommandSummary,
} from "@pix/contracts";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Cpu,
  Download,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  Gauge,
  GitBranch,
  GitFork,
  Info,
  Keyboard,
  ListPlus,
  MessageSquareText,
  Minimize2,
  Monitor,
  Network,
  Package,
  Plus,
  PlusCircle,
  Presentation,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Slash,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import {
  anchorFromElement,
  anchorFromEvent,
  FloatingMenu,
  type AnchorRect,
} from "./FloatingMenu.tsx";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { t, type Locale } from "../lib/i18n.ts";
import { groupModelsByProvider } from "../lib/model-groups.ts";
import {
  addResourceQuery,
  applyPathTokenCompletion,
  attachmentLabel,
  attachmentPresentation,
  filterSlashCommands,
  pathTokenBeforeCursor,
  slashCommandQuery,
  type AttachmentKind,
} from "../lib/composer-suggestions.ts";
import type { AccessMode, AccessVisibility } from "../lib/settings-prefs.ts";
import { visibleAccessModes } from "../lib/settings-prefs.ts";
import { cn } from "../lib/utils.ts";
import { workspaceLabel } from "../lib/workspace.ts";
import { useShellStore } from "../store/shell-store.ts";

export type { AccessMode, AccessVisibility };
export type SpeedMode = "fast" | "balanced" | "quality";

export interface ComposerModelOption {
  provider: string;
  id: string;
  name: string;
  /** Aligns with model settings: "custom" vs built-in catalog providers. */
  source?: string;
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
  /** Absolute file or directory paths passed to pi as readable context. */
  attachments: string[];
  onPickAttachments: () => Promise<void>;
  onRemoveAttachment: (path: string) => void;
  /** Add paths chosen from `@` file suggestions. */
  onAddAttachments?: (paths: string[]) => void;
  slashCommands: SlashCommandSummary[];
  /** Installed packages shown under `@` → 插件. */
  packages?: PackageSummary[];
  queuedMessages: QueuedMessages;
  onClearQueue: () => void;
  /**
   * Project / local / branch bar that protrudes above the input.
   * Hidden once the session already has conversation content.
   */
  showProjectBar?: boolean;
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
          ? "text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)]"
          : "text-[var(--popover-foreground,var(--foreground))] hover:bg-[var(--hover-fill)]",
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

/** Full-access caution: orange-red (not pale system orange, not pure error red). */
const ACCESS_FULL_ORANGE = "text-[#ff5c1a]";
const ACCESS_FULL_ORANGE_MUTED = "text-[#ff5c1a]/90";
const ACCESS_FULL_ORANGE_HOVER = "hover:bg-[#ff5c1a]/12";

/**
 * Access-control option — same hover/active fill + radius as session rows
 * (`--hover-fill`, rounded-md). Full access keeps orange caution text.
 */
function AccessOption(props: {
  icon: ReactNode;
  label: string;
  description: string;
  active?: boolean;
  /** Full-access caution (orange), not destructive red. */
  caution?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={props.testId}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-colors",
        // Match session list: transparent default, hover-fill on hover/active.
        props.active ? "bg-[var(--hover-fill)]" : "bg-transparent hover:bg-[var(--hover-fill)]",
        props.caution && !props.active && ACCESS_FULL_ORANGE_HOVER,
      )}
      onClick={props.onClick}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0",
          props.caution ? ACCESS_FULL_ORANGE : "text-[var(--muted-foreground)]",
        )}
      >
        {props.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] font-medium leading-snug",
            props.caution ? ACCESS_FULL_ORANGE : "text-[var(--foreground)]",
          )}
        >
          {props.label}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-[11px] leading-snug",
            props.caution ? ACCESS_FULL_ORANGE_MUTED : "text-[var(--text-subtle)]",
          )}
        >
          {props.description}
        </span>
      </span>
      {props.active ? (
        <span
          className={cn(
            "mt-0.5 shrink-0 text-[11px] font-medium",
            props.caution ? ACCESS_FULL_ORANGE : "text-[var(--foreground)]",
          )}
        >
          ✓
        </span>
      ) : null}
    </button>
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
          "text-[var(--popover-foreground,var(--foreground))] hover:bg-[var(--hover-fill)]",
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

const ICON_SM = { className: "size-4 shrink-0", strokeWidth: 1.75 } as const;

/** Icons for `/` catalog — source groups + well-known builtin command names. */
function commandSourceIcon(command: SlashCommandSummary) {
  if (command.source === "skill" || command.name.startsWith("skill:")) {
    return <Wand2 {...ICON_SM} />;
  }
  if (command.source === "prompt") {
    return <MessageSquareText {...ICON_SM} />;
  }
  if (command.source === "extension") {
    return <Puzzle {...ICON_SM} />;
  }
  // builtin (and legacy names mapped as builtin)
  switch (command.name) {
    case "new":
      return <PlusCircle {...ICON_SM} />;
    case "model":
    case "models":
      return <Cpu {...ICON_SM} />;
    case "settings":
      return <Settings {...ICON_SM} />;
    case "session":
      return <Info {...ICON_SM} />;
    case "name":
      return <Tag {...ICON_SM} />;
    case "tree":
      return <Network {...ICON_SM} />;
    case "fork":
      return <GitFork {...ICON_SM} />;
    case "clone":
      return <Copy {...ICON_SM} />;
    case "compact":
      return <Minimize2 {...ICON_SM} />;
    case "export":
      return <Download {...ICON_SM} />;
    case "import":
      return <Upload {...ICON_SM} />;
    case "share":
      return <Share2 {...ICON_SM} />;
    case "copy":
      return <ClipboardCopy {...ICON_SM} />;
    case "reload":
      return <RefreshCw {...ICON_SM} />;
    case "hotkeys":
    case "keybindings":
      return <Keyboard {...ICON_SM} />;
    default:
      return <Slash {...ICON_SM} />;
  }
}

/** `/` menu: 命令 (builtins/prompts/extensions) + 技能 (skills). */
type SlashGroupId = "command" | "skill";

const SLASH_GROUP_ORDER: SlashGroupId[] = ["command", "skill"];

function slashGroupId(command: SlashCommandSummary): SlashGroupId {
  if (command.source === "skill" || command.name.startsWith("skill:")) return "skill";
  return "command";
}

function groupSlashCommands(commands: SlashCommandSummary[]): Array<{
  id: SlashGroupId;
  items: Array<{ command: SlashCommandSummary; flatIndex: number }>;
}> {
  const buckets: Record<SlashGroupId, SlashCommandSummary[]> = {
    command: [],
    skill: [],
  };
  for (const command of commands) {
    buckets[slashGroupId(command)].push(command);
  }
  let flatIndex = 0;
  // Only show groups that still have matches after filtering.
  const groups: Array<{
    id: SlashGroupId;
    items: Array<{ command: SlashCommandSummary; flatIndex: number }>;
  }> = [];
  for (const id of SLASH_GROUP_ORDER) {
    const list = buckets[id];
    if (list.length === 0) continue;
    groups.push({
      id,
      items: list.map((command) => {
        const row = { command, flatIndex };
        flatIndex += 1;
        return row;
      }),
    });
  }
  return groups;
}

function filterPackages(packages: PackageSummary[], query: string, limit = 24): PackageSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  const list = packages.filter((pkg) => {
    if (!needle) return true;
    return (
      pkg.source.toLocaleLowerCase().includes(needle) ||
      pkg.kind.toLocaleLowerCase().includes(needle) ||
      pkg.scope.toLocaleLowerCase().includes(needle)
    );
  });
  return list
    .slice()
    .sort((a, b) => a.source.localeCompare(b.source))
    .slice(0, limit);
}

/** Track whether a suggest list overflows so we only reserve fade padding when needed. */
function useSuggestOverflow(open: boolean, deps: unknown[]) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) {
      setOverflows(false);
      return;
    }
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : undefined;
    ro?.observe(el);
    // Children size changes (filter results) also need remeasure.
    for (const child of el.children) {
      if (child instanceof HTMLElement) ro?.observe(child);
    }
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are intentional content keys
  }, [open, ...deps]);

  return { scrollRef, overflows };
}

function attachmentKindIcon(kind: AttachmentKind) {
  const props = { className: "size-5", strokeWidth: 1.65 };
  if (kind === "spreadsheet") return <FileSpreadsheet {...props} />;
  if (kind === "image") return <FileImage {...props} />;
  if (kind === "presentation") return <Presentation {...props} />;
  if (kind === "archive") return <FileArchive {...props} />;
  if (kind === "code") return <FileCode2 {...props} />;
  if (kind === "folder") return <Folder {...props} />;
  if (kind === "document" || kind === "pdf" || kind === "text") {
    return <FileText {...props} />;
  }
  return <File {...props} />;
}

function queuedMessagePreview(message: string): string {
  return message.split("\n\n<attached-paths>", 1)[0]?.trim() || message.trim();
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
  /** Hover tip for local-menu options (description bubble outside the menu). */
  const [localTip, setLocalTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const showAppError = useShellStore((s) => s.showAppError);
  /** Which model-submenu flyout is open: thinking | speed */
  const [modelFlyout, setModelFlyout] = useState<"thinking" | "speed" | null>(null);
  const modelFlyoutCloseTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Main input card only — slash/@ menus overlay this, ignoring project-bar protrusion height. */
  const composerCardRef = useRef<HTMLFormElement | null>(null);
  const [suggestionAnchor, setSuggestionAnchor] = useState<AnchorRect | null>(null);
  /** -1 = no highlighted option (no default selected background). */
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
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

    void window.pix.workspace
      .listGitBranches(props.workspacePath)
      .then((list) => {
        if (!cancelled) setBranches(list ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          setBranches([]);
          showAppError(error instanceof Error ? error.message : tr("composer.branch.failed"));
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

  const modelGroups = useMemo(
    () => groupModelsByProvider(props.modelOptions, tr("models.group.custom")),
    [props.modelOptions, props.locale],
  );

  const slashQuery = slashCommandQuery(props.prompt);
  const resourceQuery = addResourceQuery(props.prompt);
  const slashSuggestions = useMemo(
    () => filterSlashCommands(props.slashCommands, slashQuery ?? ""),
    [props.slashCommands, slashQuery],
  );
  const slashGroups = useMemo(() => groupSlashCommands(slashSuggestions), [slashSuggestions]);
  const packageSuggestions = useMemo(
    () => filterPackages(props.packages ?? [], resourceQuery ?? ""),
    [props.packages, resourceQuery],
  );
  const [pathSuggestions, setPathSuggestions] = useState<
    Array<{ path: string; relative: string; kind: "file" | "folder" }>
  >([]);
  // `@` → 添加 (picker + project paths) + 插件 (packages, only if any).
  const slashPanelOpen = menu === null && !suggestionsDismissed && slashQuery !== undefined;
  const resourcePanelOpen =
    menu === "attach" || (menu === null && !suggestionsDismissed && resourceQuery !== undefined);
  /** Flat `@` nav: 0 = picker, then paths, then packages. */
  const resourceItemCount = 1 + pathSuggestions.length + packageSuggestions.length;
  const slashOverflow = useSuggestOverflow(slashPanelOpen, [
    slashQuery,
    slashSuggestions.length,
    props.slashCommands.length,
  ]);
  const resourceOverflow = useSuggestOverflow(resourcePanelOpen, [
    resourceQuery,
    pathSuggestions.length,
    packageSuggestions.length,
    props.packages?.length ?? 0,
  ]);

  useEffect(() => {
    if (!resourcePanelOpen) {
      setPathSuggestions([]);
      return;
    }
    // Menu opened via + button still searches; typed `@q` filters paths.
    const q = resourceQuery ?? "";
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.pix.workspace
        .searchPaths(q, {
          ...(props.workspacePath ? { cwd: props.workspacePath } : {}),
          limit: 24,
        })
        .then((rows) => {
          if (!cancelled) setPathSuggestions(rows);
        })
        .catch(() => {
          if (!cancelled) setPathSuggestions([]);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resourcePanelOpen, resourceQuery, props.workspacePath]);

  useEffect(() => {
    if (!slashPanelOpen && !resourcePanelOpen) {
      setSuggestionAnchor(null);
      return;
    }
    // Anchor to the card surface so the menu covers protrusion instead of clearing its full height.
    setSuggestionAnchor(anchorFromElement(composerCardRef.current ?? rootRef.current));
  }, [
    slashPanelOpen,
    resourcePanelOpen,
    props.prompt,
    props.showProjectBar,
    props.attachments.length,
  ]);

  useEffect(() => {
    setSuggestionIndex(-1);
  }, [slashQuery, resourceQuery, menu]);

  function closeMenu() {
    clearModelFlyoutCloseTimer();
    setMenu(null);
    setAnchor(null);
    setProjectQuery("");
    setBranchQuery("");
    setModelFlyout(null);
    setLocalTip(null);
  }

  function openMenu(kind: MenuKind, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (menu === kind) {
      closeMenu();
      return;
    }
    setMenu(kind);
    setAnchor(
      kind === "attach"
        ? anchorFromElement(composerCardRef.current ?? rootRef.current)
        : anchorFromEvent(event.currentTarget),
    );
  }

  function dismissSuggestions() {
    if (menu === "attach") closeMenu();
    else setSuggestionsDismissed(true);
  }

  function selectCommand(command: SlashCommandSummary) {
    props.onPromptChange(`/${command.name} `);
    setSuggestionsDismissed(true);
    closeMenu();
    requestAnimationFrame(() => props.composerRef.current?.focus());
  }

  async function selectAttachments() {
    if (resourceQuery !== undefined) props.onPromptChange("");
    setSuggestionsDismissed(true);
    closeMenu();
    await props.onPickAttachments();
    requestAnimationFrame(() => props.composerRef.current?.focus());
  }

  function handlePromptChange(value: string) {
    setSuggestionsDismissed(false);
    if (slashCommandQuery(value) !== undefined || addResourceQuery(value) !== undefined) {
      closeMenu();
    }
    props.onPromptChange(value);
  }

  function clearAtTokenFromPrompt() {
    // Drop a trailing `@query` token after picking a resource.
    const next = props.prompt.replace(/@[^\s]*$/, "").trimEnd();
    props.onPromptChange(next ? `${next} ` : "");
  }

  function selectPackage(pkg: PackageSummary) {
    // Insert package source as an @ mention and close the menu.
    props.onPromptChange(`@${pkg.source} `);
    setSuggestionsDismissed(true);
    closeMenu();
    requestAnimationFrame(() => props.composerRef.current?.focus());
  }

  function selectProjectPath(absPath: string) {
    clearAtTokenFromPrompt();
    props.onAddAttachments?.([absPath]);
    setSuggestionsDismissed(true);
    closeMenu();
    requestAnimationFrame(() => props.composerRef.current?.focus());
  }

  function commitResourceIndex(index: number) {
    if (index === 0) {
      void selectAttachments();
      return;
    }
    if (index <= pathSuggestions.length) {
      const hit = pathSuggestions[index - 1];
      if (hit) selectProjectPath(hit.path);
      return;
    }
    const pkg = packageSuggestions[index - 1 - pathSuggestions.length];
    if (pkg) selectPackage(pkg);
  }

  async function completePathWithTab(textarea: HTMLTextAreaElement) {
    const cursor = textarea.selectionStart ?? props.prompt.length;
    const token = pathTokenBeforeCursor(props.prompt, cursor);
    if (!token) return false;
    // When @ menu already has path hits, Tab accepts highlighted/first path.
    if (resourcePanelOpen && pathSuggestions.length > 0) {
      const index =
        suggestionIndex > 0 && suggestionIndex <= pathSuggestions.length ? suggestionIndex : 1;
      const hit = pathSuggestions[index - 1];
      if (hit) {
        if (token.atMention) {
          selectProjectPath(hit.path);
        } else {
          const applied = applyPathTokenCompletion(props.prompt, cursor, hit.relative);
          if (applied) {
            props.onPromptChange(applied.value);
            requestAnimationFrame(() => {
              textarea.setSelectionRange(applied.cursor, applied.cursor);
              textarea.focus();
            });
          }
        }
        return true;
      }
    }
    try {
      const rows = await window.pix.workspace.searchPaths(token.query, {
        ...(props.workspacePath ? { cwd: props.workspacePath } : {}),
        limit: 8,
      });
      const hit = rows[0];
      if (!hit) return false;
      if (token.atMention) {
        selectProjectPath(hit.path);
        return true;
      }
      const applied = applyPathTokenCompletion(props.prompt, cursor, hit.relative);
      if (!applied) return false;
      props.onPromptChange(applied.value);
      requestAnimationFrame(() => {
        textarea.setSelectionRange(applied.cursor, applied.cursor);
        textarea.focus();
      });
      return true;
    } catch {
      return false;
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const panel = slashPanelOpen ? "slash" : resourcePanelOpen ? "resource" : undefined;
    if (panel) {
      // `/` → commands+skills; `@` → picker + project paths + packages.
      const itemCount = panel === "slash" ? slashSuggestions.length : resourceItemCount;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (itemCount > 0) {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setSuggestionIndex((current) => {
            // No selection yet → first Down picks 0, first Up picks last.
            if (current < 0) return event.key === "ArrowDown" ? 0 : itemCount - 1;
            return (current + delta + itemCount) % itemCount;
          });
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissSuggestions();
        return;
      }
      // Tab completes path / accepts first resource suggestion (pi editor parity).
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        if (panel === "resource") {
          if (suggestionIndex >= 0) commitResourceIndex(suggestionIndex);
          else if (pathSuggestions.length > 0) commitResourceIndex(1);
          else void selectAttachments();
          return;
        }
        if (panel === "slash" && slashSuggestions.length > 0) {
          const command = slashSuggestions[suggestionIndex >= 0 ? suggestionIndex : 0];
          if (command) selectCommand(command);
          return;
        }
      }
      // Only commit a menu choice when something is highlighted (keyboard or hover).
      if (event.key === "Enter" && !event.shiftKey && itemCount > 0 && suggestionIndex >= 0) {
        event.preventDefault();
        if (panel === "resource") commitResourceIndex(suggestionIndex);
        else {
          const command = slashSuggestions[suggestionIndex];
          if (command) selectCommand(command);
        }
        return;
      }
    } else if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      // Bare path Tab completion when no slash/@ panel is open.
      const token = pathTokenBeforeCursor(
        props.prompt,
        event.currentTarget.selectionStart ?? props.prompt.length,
      );
      if (token) {
        event.preventDefault();
        void completePathWithTab(event.currentTarget);
        return;
      }
    }
    props.onKeyDown(event);
  }

  async function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    let hasImage = false;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        hasImage = true;
        break;
      }
    }
    if (!hasImage) return;
    event.preventDefault();
    try {
      // Prefer system clipboard image via main (handles OS paste reliably).
      const saved = await window.pix.workspace.saveClipboardImage();
      if (saved) {
        props.onAddAttachments?.([saved]);
        return;
      }
      // Fallback: file from clipboard data
      for (const item of items) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const buffer = new Uint8Array(await file.arrayBuffer());
        const ext = file.type.includes("jpeg") || file.type.includes("jpg") ? "jpg" : "png";
        const path = await window.pix.workspace.saveClipboardImage({
          bytes: Array.from(buffer),
          ext,
        });
        if (path) props.onAddAttachments?.([path]);
        break;
      }
    } catch {
      // ignore paste failures — user can still attach via picker
    }
  }

  function handleComposerDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    const paths: string[] = [];
    for (const file of files) {
      const filePath = window.pix.workspace.pathForFile(file);
      if (typeof filePath === "string" && filePath) paths.push(filePath);
    }
    if (paths.length) props.onAddAttachments?.(paths);
  }

  const filteredBranches = useMemo(() => {
    // Local branches only — hide origin/* and other remote-tracking refs.
    // Keep names like feature/foo (local with slash); drop remote flag / origin/ prefix.
    const locals = branches.filter((b) => {
      if (b.remote) return false;
      if (/^(origin|upstream)\//.test(b.name)) return false;
      return true;
    });
    const q = branchQuery.trim().toLowerCase();
    if (!q) return locals;
    return locals.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, branchQuery]);

  const canCreateBranch = useMemo(() => {
    const name = branchQuery.trim();
    if (!isValidBranchName(name)) return false;
    return !branches.some((b) => b.name === name || b.name.endsWith(`/${name}`));
  }, [branchQuery, branches]);

  async function handleCheckoutBranch(name: string) {
    if (!props.workspacePath || gitBusy) return;
    setGitBusy(true);

    try {
      const next = await window.pix.workspace.checkoutGitBranch(name, props.workspacePath);
      setGitContext(next);
      closeMenu();
    } catch (error) {
      showAppError(error instanceof Error ? error.message : tr("composer.branch.failed"));
    } finally {
      setGitBusy(false);
    }
  }

  async function handleCreateCheckoutBranch() {
    const name = branchQuery.trim();
    if (!props.workspacePath || !isValidBranchName(name) || gitBusy) return;
    setGitBusy(true);

    try {
      const next = await window.pix.workspace.createGitBranch(name, {
        checkout: true,
        cwd: props.workspacePath,
      });
      setGitContext(next);
      closeMenu();
    } catch (error) {
      showAppError(error instanceof Error ? error.message : tr("composer.branch.failed"));
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
      showAppError(tr("composer.local.failed"));
      return;
    }
    if (normalizeCwdKey(main) === normalizeCwdKey(props.workspacePath)) {
      closeMenu();
      return;
    }
    setGitBusy(true);

    try {
      closeMenu();
      props.onOpenProject(main);
    } catch (error) {
      showAppError(error instanceof Error ? error.message : tr("composer.local.failed"));
    } finally {
      setGitBusy(false);
    }
  }

  async function handleNewWorktree() {
    if (!props.workspacePath || gitBusy) return;
    setGitBusy(true);
    try {
      // Path comes from worktree prefs root + date/branch name (no project- prefix).
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await window.pix.workspace.createGitWorktree({
        cwd: props.workspacePath,
        newBranch: stamp,
      });
      closeMenu();
      props.onOpenProject(result.path);
      void refreshGitContext(result.path);
    } catch (error) {
      showAppError(error instanceof Error ? error.message : tr("composer.local.failed"));
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

  const showProjectBar = props.showProjectBar !== false;
  const queuedItems = [
    ...props.queuedMessages.steering.map((message) => ({
      message,
      kind: "steering" as const,
    })),
    ...props.queuedMessages.followUp.map((message) => ({
      message,
      kind: "followUp" as const,
    })),
  ];

  return (
    <div
      ref={rootRef}
      // Parent is `.thread-content-column` (same as timeline) — fill it completely.
      className="pointer-events-auto relative w-full min-w-0 max-w-full"
      data-testid="composer-root"
    >
      {queuedItems.length > 0 ? (
        <div className="composer-queue-card" data-testid="composer-queue-card">
          <div className="min-w-0 flex-1">
            {queuedItems.slice(0, 2).map((item, index) => (
              <div
                key={`${item.kind}:${index}:${item.message}`}
                className="flex min-w-0 items-center gap-2 px-3 py-2"
              >
                <ListPlus
                  className="size-3.5 shrink-0 text-[var(--text-subtle)]"
                  strokeWidth={1.75}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[12px] font-medium"
                  title={item.message}
                >
                  {queuedMessagePreview(item.message)}
                </span>
                <span className="shrink-0 rounded-full bg-[var(--hover-fill)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                  {item.kind === "steering"
                    ? tr("composer.queue.guidance")
                    : tr("composer.queue.followUp")}
                </span>
              </div>
            ))}
            {queuedItems.length > 2 ? (
              <div className="px-3 pb-2 text-[10px] text-[var(--text-subtle)]">
                {tr("composer.queue.more", { count: String(queuedItems.length - 2) })}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1 pr-2">
            <span className="hidden text-[10px] text-[var(--text-subtle)] sm:inline">
              {tr("composer.queue.hint")}
            </span>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full text-[var(--text-subtle)] transition-colors hover:bg-[var(--hover-fill)] hover:text-[var(--foreground)]"
              title={tr("composer.queue.clear")}
              aria-label={tr("composer.queue.clear")}
              data-testid="composer-queue-clear"
              onClick={props.onClearQueue}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ) : null}

      {/*
        Protrusion: project / local / branch. Only for empty sessions —
        hide once the thread has conversation content.
      */}
      {showProjectBar ? (
        <div className="relative z-[2] flex w-full justify-center px-[18px]">
          <div className="composer-protrusion" data-testid="composer-project-bar">
            <button
              type="button"
              data-testid="composer-project-picker"
              aria-expanded={projectMenuOpen}
              className="inline-flex min-w-0 max-w-[42%] items-center gap-1.5 text-[var(--foreground)]"
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
                  className="inline-flex min-w-0 max-w-[26%] items-center gap-1.5 text-[var(--foreground)]"
                  title={localLabel}
                  data-testid="composer-local"
                  aria-expanded={localMenuOpen}
                  onClick={(e) => openMenu("local", e)}
                >
                  <Monitor className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
                  <span className="min-w-0 truncate">{localLabel}</span>
                  <ChevronDown className="size-3 shrink-0 opacity-60" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="inline-flex min-w-0 max-w-[26%] items-center gap-1.5 text-[var(--foreground)]"
                  title={tr("composer.project.branch")}
                  data-testid="composer-git-branch"
                  aria-expanded={branchMenuOpen}
                  onClick={(e) => openMenu("branch", e)}
                >
                  <GitBranch className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
                  <span className="min-w-0 truncate">
                    {gitContext.branch || tr("composer.project.noBranch")}
                  </span>
                  <ChevronDown className="size-3 shrink-0 opacity-60" strokeWidth={2} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Full card border; joins the protrusion tab when present. */}
      <form
        ref={composerCardRef}
        className={cn("composer-card", showProjectBar && "composer-card-with-protrusion")}
        onSubmit={(event) => props.onSubmit(event)}
      >
        {props.attachments.length > 0 ? (
          <AttachmentGroup className="composer-attachment-grid" data-testid="composer-attachments">
            {props.attachments.map((path) => {
              const presentation = attachmentPresentation(path);
              return (
                <Attachment
                  key={path}
                  state="done"
                  size="sm"
                  data-kind={presentation.kind}
                  data-testid="composer-attachment-card"
                  className="composer-attachment-card"
                  title={path}
                >
                  <AttachmentMedia variant="icon" className="composer-attachment-icon">
                    {attachmentKindIcon(presentation.kind)}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle className="text-[12px]">
                      {attachmentLabel(path)}
                    </AttachmentTitle>
                    <AttachmentDescription className="text-[10px] font-medium uppercase tracking-[0.04em]">
                      {presentation.typeLabel}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      type="button"
                      className="composer-attachment-remove"
                      aria-label={tr("composer.attach.remove")}
                      onClick={() => props.onRemoveAttachment(path)}
                    >
                      <X strokeWidth={2} />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              );
            })}
          </AttachmentGroup>
        ) : null}

        <Textarea
          ref={props.composerRef}
          aria-label="Prompt"
          data-testid="prompt-input"
          value={props.prompt}
          onChange={(event) => handlePromptChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          onPaste={(event) => void handleComposerPaste(event)}
          onDrop={handleComposerDrop}
          onDragOver={(event) => {
            if (event.dataTransfer?.types?.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)] hover:text-[var(--foreground)]"
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
                "text-[12px] hover:bg-[var(--hover-fill)]",
                props.accessMode === "full"
                  ? "text-[#ff5c1a] hover:bg-[#ff5c1a]/12 hover:text-[#ff4d00]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
              onClick={(e) => openMenu("access", e)}
            >
              {accessIcon(props.accessMode)}
              <span className="min-w-0 truncate">
                {accessLabel(props.locale, props.accessMode)}
              </span>
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
                "text-[12px] text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)] hover:text-[var(--foreground)]",
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
              <>
                <Button
                  type="submit"
                  size="icon"
                  data-testid="queue-prompt"
                  disabled={!props.prompt.trim() && props.attachments.length === 0}
                  title={tr("composer.queue.steer")}
                  aria-label={tr("composer.queue.steer")}
                  className="h-7 w-7 rounded-full disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  data-testid="abort-prompt"
                  onClick={() => props.onAbort()}
                  aria-label={tr("composer.stop")}
                  className="h-7 w-7 rounded-full bg-red-500 text-white hover:bg-red-600"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                </Button>
              </>
            ) : (
              <Button
                type="submit"
                size="icon"
                data-testid="send-prompt"
                disabled={!props.prompt.trim() && props.attachments.length === 0}
                aria-label={tr("composer.start")}
                className="h-7 w-7 rounded-full disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
              </Button>
            )}
          </div>
        </div>
      </form>

      <FloatingMenu
        open={slashPanelOpen && Boolean(suggestionAnchor)}
        anchor={suggestionAnchor}
        onClose={dismissSuggestions}
        placement="top"
        testId="composer-slash-menu"
        minWidth={320}
        matchAnchorWidth
        elevated={false}
        offsetPx={2}
        className="!rounded-[var(--radius-panel)] !border-[var(--border)] !bg-[var(--surface-panel)] !py-0"
      >
        <div
          className="composer-suggest-body"
          data-overflow={slashOverflow.overflows ? "true" : "false"}
        >
          <div ref={slashOverflow.scrollRef} className="composer-suggest-scroll pt-0">
            {slashGroups.length === 0 ? (
              <p className="px-2.5 py-3 text-left text-[13px] text-[var(--text-subtle)]">
                {tr("composer.slash.empty")}
              </p>
            ) : (
              slashGroups.map((group) => (
                <div
                  key={group.id}
                  className="composer-suggest-group"
                  data-testid={`composer-slash-group-${group.id}`}
                >
                  <div className="composer-suggest-group-label">
                    {tr(
                      group.id === "skill"
                        ? "composer.slash.group.skill"
                        : "composer.slash.group.command",
                    )}
                  </div>
                  {group.items.map(({ command, flatIndex }) => (
                    <button
                      key={`${command.source}:${command.name}`}
                      type="button"
                      role="menuitem"
                      data-testid="composer-slash-item"
                      data-active={
                        suggestionIndex >= 0 && flatIndex === suggestionIndex ? "true" : "false"
                      }
                      className="composer-suggest-item"
                      onMouseEnter={() => setSuggestionIndex(flatIndex)}
                      onMouseLeave={() => setSuggestionIndex(-1)}
                      onClick={() => selectCommand(command)}
                    >
                      <span className="inline-flex size-4 shrink-0 text-[var(--muted-foreground)]">
                        {commandSourceIcon(command)}
                      </span>
                      <span className="composer-suggest-item-main">
                        /{command.name}
                        {command.argumentHint ? (
                          <span className="ml-1 font-normal text-[var(--text-subtle)]">
                            {command.argumentHint}
                          </span>
                        ) : null}
                      </span>
                      <span className="composer-suggest-item-desc">{command.description}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="composer-suggest-fade" aria-hidden />
        </div>
      </FloatingMenu>

      <FloatingMenu
        open={resourcePanelOpen && Boolean(menu === "attach" ? anchor : suggestionAnchor)}
        anchor={menu === "attach" ? anchor : suggestionAnchor}
        onClose={dismissSuggestions}
        placement="top"
        testId="composer-attach-menu"
        minWidth={320}
        matchAnchorWidth
        elevated={false}
        offsetPx={2}
        className="!rounded-[var(--radius-panel)] !border-[var(--border)] !bg-[var(--surface-panel)] !py-0"
      >
        <div
          className="composer-suggest-body"
          data-overflow={resourceOverflow.overflows ? "true" : "false"}
        >
          <div ref={resourceOverflow.scrollRef} className="composer-suggest-scroll pt-0">
            <div className="composer-suggest-group" data-testid="composer-attach-group-add">
              <div className="composer-suggest-group-label">{tr("composer.add.title")}</div>
              <button
                type="button"
                role="menuitem"
                data-testid="composer-attach-files"
                data-active={suggestionIndex === 0 ? "true" : "false"}
                className="composer-suggest-item"
                onMouseEnter={() => setSuggestionIndex(0)}
                onMouseLeave={() => setSuggestionIndex(-1)}
                onClick={() => void selectAttachments()}
              >
                <FolderOpen
                  className="size-4 shrink-0 text-[var(--muted-foreground)]"
                  strokeWidth={1.75}
                />
                <span className="composer-suggest-item-main">
                  {tr("composer.attach.filesAndFolders")}
                </span>
              </button>
              {pathSuggestions.map((item, index) => {
                const flatIndex = index + 1;
                return (
                  <button
                    key={item.path}
                    type="button"
                    role="menuitem"
                    data-testid="composer-attach-path"
                    data-active={suggestionIndex === flatIndex ? "true" : "false"}
                    className="composer-suggest-item"
                    onMouseEnter={() => setSuggestionIndex(flatIndex)}
                    onMouseLeave={() => setSuggestionIndex(-1)}
                    onClick={() => selectProjectPath(item.path)}
                    title={item.path}
                  >
                    {item.kind === "folder" ? (
                      <Folder
                        className="size-4 shrink-0 text-[var(--muted-foreground)]"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <File
                        className="size-4 shrink-0 text-[var(--muted-foreground)]"
                        strokeWidth={1.75}
                      />
                    )}
                    <span className="composer-suggest-item-main">{item.relative}</span>
                  </button>
                );
              })}
            </div>
            {packageSuggestions.length > 0 ? (
              <div className="composer-suggest-group" data-testid="composer-attach-group-plugins">
                <div className="composer-suggest-group-label">{tr("composer.add.plugins")}</div>
                {packageSuggestions.map((pkg, index) => {
                  const flatIndex = 1 + pathSuggestions.length + index;
                  return (
                    <button
                      key={`${pkg.scope}:${pkg.source}`}
                      type="button"
                      role="menuitem"
                      data-testid={`composer-attach-package-${pkg.source}`}
                      data-active={suggestionIndex === flatIndex ? "true" : "false"}
                      className="composer-suggest-item"
                      onMouseEnter={() => setSuggestionIndex(flatIndex)}
                      onMouseLeave={() => setSuggestionIndex(-1)}
                      onClick={() => selectPackage(pkg)}
                    >
                      <Package
                        className="size-4 shrink-0 text-[var(--muted-foreground)]"
                        strokeWidth={1.75}
                      />
                      <span className="composer-suggest-item-main">{pkg.source}</span>
                      <span className="composer-suggest-item-desc">{pkg.scope}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="composer-suggest-fade" aria-hidden />
        </div>
      </FloatingMenu>

      {/* Project menu — simple list, opens upward above the pill (matches reference). */}
      <FloatingMenu
        open={projectMenuOpen && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        placement="top"
        testId="composer-project-menu"
        minWidth={260}
        className="!rounded-[var(--radius-panel)] !border-[var(--border)] !bg-[var(--surface-panel)] !py-0 overflow-hidden shadow-[var(--shadow-soft)]"
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
                      : "text-[var(--foreground)] hover:bg-[var(--hover-fill)]",
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
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition-colors hover:bg-[var(--hover-fill)]"
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

      {/* Local / worktree menu — labels only; descriptions show in a hover bubble */}
      <FloatingMenu
        open={localMenuOpen && Boolean(anchor)}
        anchor={anchor}
        onClose={() => {
          setLocalTip(null);
          closeMenu();
        }}
        placement="top"
        testId="composer-local-menu"
        minWidth={200}
        className="!rounded-[var(--radius-panel)] !border-[var(--border)] !bg-[var(--surface-panel)] !py-0 overflow-hidden shadow-[var(--shadow-soft)]"
      >
        <div className="flex flex-col gap-0.5 p-1.5">
          <button
            type="button"
            role="menuitem"
            data-testid="composer-local-option-local"
            disabled={gitBusy}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
              "hover:bg-[var(--hover-fill)] disabled:opacity-50",
              gitContext.isMainWorktree !== false && "bg-[var(--accent)]/60",
            )}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setLocalTip({
                text: tr("composer.local.menuLocalHint"),
                x: r.right + 8,
                y: r.top + r.height / 2,
              });
            }}
            onMouseLeave={() => setLocalTip(null)}
            onClick={() => void handleSwitchToLocal()}
          >
            <Monitor className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--foreground)]">
              {tr("composer.local.menuLocal")}
            </span>
            {gitContext.isMainWorktree !== false ? (
              <Check className="size-3.5 shrink-0 text-[var(--foreground)]" strokeWidth={2} />
            ) : null}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="composer-local-option-worktree"
            disabled={gitBusy}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover-fill)] disabled:opacity-50"
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setLocalTip({
                text: tr("composer.local.menuNewWorktreeHint"),
                x: r.right + 8,
                y: r.top + r.height / 2,
              });
            }}
            onMouseLeave={() => setLocalTip(null)}
            onClick={() => void handleNewWorktree()}
          >
            <FolderGit2 className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--foreground)]">
              {gitBusy ? tr("composer.local.creating") : tr("composer.local.menuNewWorktree")}
            </span>
          </button>
        </div>
      </FloatingMenu>
      {localTip && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              data-testid="composer-local-tip"
              className="surface-panel pointer-events-none fixed z-[12050] max-w-[220px] -translate-y-1/2 px-2.5 py-1.5 text-[11px] leading-snug text-[var(--muted-foreground)] shadow-lg"
              style={{ left: localTip.x, top: localTip.y }}
            >
              {localTip.text}
            </div>,
            document.body,
          )
        : null}

      {/* Branch menu — search + list + create & checkout */}
      <FloatingMenu
        open={branchMenuOpen && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        placement="top"
        testId="composer-branch-menu"
        minWidth={280}
        className="!rounded-[var(--radius-panel)] !border-[var(--border)] !bg-[var(--surface-panel)] !py-0 overflow-hidden shadow-[var(--shadow-soft)]"
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
                    : "text-[var(--foreground)] hover:bg-[var(--hover-fill)]",
                )}
                onClick={() => {
                  if (!branch.current) void handleCheckoutBranch(branch.name);
                  else closeMenu();
                }}
              >
                <GitBranch className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{branch.name}</span>
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
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--foreground)] transition-colors hover:bg-[var(--hover-fill)] disabled:opacity-50"
              onClick={() => void handleCreateCheckoutBranch()}
            >
              <Plus className="size-3.5 shrink-0 opacity-80" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate">
                {tr("composer.branch.createCheckout", { name: branchQuery.trim() })}
              </span>
            </button>
          </div>
        ) : null}
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
              caution={mode === "full"}
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

      {/* Model menu: scrollable models + pinned thinking/speed flyouts */}
      <FloatingMenu
        open={menu === "model" && Boolean(anchor)}
        anchor={anchor}
        onClose={closeMenu}
        placement="top"
        testId="composer-model-menu"
        minWidth={220}
        className="flex w-[min(15rem,calc(100vw-2rem))] flex-col !overflow-hidden !py-0"
      >
        <div className="pix-scroll min-h-0 flex-1 overscroll-contain max-h-[min(320px,calc(100vh-14rem))] py-1">
          {modelGroups.length === 0 ? (
            <p className="px-2.5 py-1.5 text-left text-[13px] text-[var(--text-subtle)]">
              {tr("composer.model.none")}
            </p>
          ) : (
            modelGroups.map((group) => (
              <div
                key={group.key}
                className="composer-model-group"
                data-testid={`composer-model-group-${group.key}`}
              >
                <div className="composer-model-group-label">{group.label}</div>
                {group.models.map((model) => {
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
                })}
              </div>
            ))
          )}
        </div>
        <div className="shrink-0 border-t border-[var(--border)] py-1">
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
        </div>
      </FloatingMenu>
    </div>
  );
}
