import { IPC_PROTOCOL_VERSION } from "@pix/contracts";
import type {
  CatalogPackage,
  HostEvent,
  HostSnapshot,
  PackageSummary,
  ResourceSummary,
  SessionInfoView,
  SessionThreadSummary,
  SessionTreeView,
} from "@pix/contracts";
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { ArrowDown } from "lucide-react";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { Composer, type SpeedMode } from "./components/Composer.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { ErrorDialog } from "./components/ErrorDialog.tsx";
import { SessionInfoPanel, SessionTreePanel } from "./components/SessionParityPanels.tsx";
import { RenameDialog } from "./components/RenameDialog.tsx";
import { SettingsPage } from "./components/settings/SettingsPage.tsx";
import {
  SettingsSearchField,
  SettingsSelect,
  SettingsToggle,
} from "./components/settings/SettingsPrimitives.tsx";
import {
  EnvPanel,
  envPanelLayoutForWidth,
  type EnvPanelLayoutMode,
} from "./components/EnvPanel.tsx";
import { PixLogo } from "./components/PixLogo.tsx";
import { ThreadHeader } from "./components/ThreadHeader.tsx";
import { WindowCaptionButtons } from "./components/WindowCaptionButtons.tsx";
import {
  TimelineLiveStatus,
  TimelineProcessBlock,
  TimelineRow,
} from "./components/TimelineRow.tsx";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { buildShellCommands } from "./lib/commands.ts";
import { isPromptImagePath, promptWithAttachedPaths } from "./lib/composer-suggestions.ts";
import {
  buildUnifiedSlashCatalog,
  parseShellInjection,
  parseSlashLine,
  resolveBuiltinSlash,
} from "./lib/slash-parity.ts";
import { applyDocumentTheme, colorModeFromPiTheme, piThemeLabel } from "./lib/theme.ts";
import { cn } from "./lib/utils.ts";
import { t, type Locale } from "./lib/i18n.ts";
import {
  loadAccessMode,
  loadAccessVisibility,
  loadShowContextUsage,
  resolveAccessMode,
  saveAccessMode,
  saveAccessVisibility,
  saveShowContextUsage,
  type AccessMode,
  type AccessVisibility,
} from "./lib/settings-prefs.ts";
import { loadNotificationPrefs } from "./lib/notification-prefs.ts";
import { installOverlayScroll, syncOverlayScroll } from "./lib/overlay-scroll.ts";
import { sidebarRailWidth } from "./lib/sidebar-prefs.ts";
import { matchShortcut, SHORTCUT_OVERRIDES_CHANGED_EVENT } from "./lib/shortcuts.ts";
import {
  filterRecentWorkspaces,
  firstLine,
  isNonProjectWorkspacePath,
  prependRecentPath,
  workspaceLabel,
} from "./lib/workspace.ts";
import { appendHostEvent } from "./lib/host-events.ts";
import {
  buildTimelineBlocks,
  deriveLiveActivity,
  deriveRunState,
  historyToTimeline,
  processBlockCoversLiveActivity,
  type TimelineItem,
} from "./lib/timeline.ts";
import {
  classifyRuntimeEventDelivery,
  sessionKeyFromSnapshot,
  useShellStore,
} from "./store/shell-store.ts";
import "./styles.css";

/** Surface app-level errors as a modal (agent timeline errors stay in-chat). */
function reportAppError(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  useShellStore.getState().showAppError(message);
  return message;
}

function maybeNotify(kind: "complete" | "error" | "crash", body?: string): void {
  const prefs = loadNotificationPrefs();
  if (!prefs.enabled) return;
  if (kind === "complete" && !prefs.onComplete) return;
  if (kind === "error" && !prefs.onError) return;
  if (kind === "crash" && !prefs.onHostCrash) return;
  const locale = useShellStore.getState().locale;
  const title =
    kind === "complete"
      ? t(locale, "notify.completeTitle")
      : kind === "error"
        ? t(locale, "notify.errorTitle")
        : t(locale, "notify.crashTitle");
  // Focus check runs in main via requireUnfocused (document.hasFocus is unreliable in Electron).
  void window.pix.notifications
    .show({
      title,
      body: body?.trim() || title,
      silent: !prefs.sound,
      requireUnfocused: prefs.onlyWhenUnfocused,
    })
    .catch(() => undefined);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

async function respondToExtensionUi(event: Extract<HostEvent, { type: "extensionUi.request" }>) {
  const args = record(event.args);
  if (!args || !["select", "confirm", "input", "editor"].includes(event.method)) return;
  let value: unknown;
  let ok = true;
  if (event.method === "confirm") {
    value = window.confirm(`${text(args.title, "Confirm")}\n\n${text(args.message)}`);
  } else if (event.method === "input" || event.method === "editor") {
    value = window.prompt(
      text(args.title, event.method === "editor" ? "Editor" : "Input"),
      text(event.method === "editor" ? args.prefill : args.placeholder),
    );
    ok = value !== null;
    if (!ok) value = undefined;
  } else {
    const options = Array.isArray(args.options)
      ? args.options.filter((item) => typeof item === "string")
      : [];
    value = window.prompt(`${text(args.title, "Select")}\n\n${options.join("\n")}`, options[0]);
    ok = typeof value === "string" && options.includes(value);
    if (!ok) value = undefined;
  }
  await window.pix.extensionUi.respond({
    runtimeId: event.runtimeId,
    requestId: event.requestId,
    ok,
    value,
  });
}

function hostPillState(status: string, running: boolean): string {
  if (running) return "running";
  const lower = status.toLowerCase();
  if (lower.includes("ready") || lower.includes("settled") || lower.includes("restarted"))
    return "ready";
  if (lower.includes("exit") || lower.includes("fail") || lower.includes("crash")) return "error";
  return "idle";
}

function App() {
  const status = useShellStore((s) => s.status);
  const snapshot = useShellStore((s) => s.snapshot);
  const events = useShellStore((s) => s.events);
  const liveStream = useShellStore((s) => s.liveStream);
  const history = useShellStore((s) => s.history);
  const threads = useShellStore((s) => s.threads);
  const prompt = useShellStore((s) => s.prompt);
  const sentPrompts = useShellStore((s) => s.sentPrompts);
  const queuedMessages = useShellStore((s) => s.queuedMessages);
  const running = useShellStore((s) => s.running);
  const sessionMarkers = useShellStore((s) => s.sessionMarkers);
  const reviewOpen = useShellStore((s) => s.reviewOpen);
  const envPanelOpen = useShellStore((s) => s.envPanelOpen);
  const sidebarOpen = useShellStore((s) => s.sidebarOpen);
  const lastFailure = useShellStore((s) => s.lastFailure);
  const appError = useShellStore((s) => s.appError);
  const view = useShellStore((s) => s.view);
  const runtimeId = useShellStore((s) => s.runtimeId);
  const packages = useShellStore((s) => s.packages);
  const resources = useShellStore((s) => s.resources);
  const ecoLoading = useShellStore((s) => s.ecoLoading);
  const colorMode = useShellStore((s) => s.colorMode);
  const themePreference = useShellStore((s) => s.themePreference);
  const locale = useShellStore((s) => s.locale);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const sidebarWidthPx = useShellStore((s) => s.sidebarWidthPx);
  const sidebarTranslucent = useShellStore((s) => s.sidebarTranslucent);
  const settingsSection = useShellStore((s) => s.settingsSection);
  const paletteOpen = useShellStore((s) => s.paletteOpen);

  const setStatus = useShellStore((s) => s.setStatus);
  const setEvents = useShellStore((s) => s.setEvents);
  const setThreads = useShellStore((s) => s.setThreads);
  const setPrompt = useShellStore((s) => s.setPrompt);
  const setSentPrompts = useShellStore((s) => s.setSentPrompts);
  const setRunning = useShellStore((s) => s.setRunning);
  const setSessionRunning = useShellStore((s) => s.setSessionRunning);
  const setSessionMarker = useShellStore((s) => s.setSessionMarker);
  const setReviewOpen = useShellStore((s) => s.setReviewOpen);
  const setEnvPanelOpen = useShellStore((s) => s.setEnvPanelOpen);
  /** Whether env panel can be shown at current thread-column width. */
  const [envPanelFits, setEnvPanelFits] = useState(true);
  /** float = overlay without squeeze; dock = flex squeeze. */
  const [envPanelLayout, setEnvPanelLayout] = useState<Exclude<EnvPanelLayoutMode, "none">>("dock");
  const [sessionTreeOpen, setSessionTreeOpen] = useState(false);
  const [sessionTreeMode, setSessionTreeMode] = useState<"navigate" | "fork">("navigate");
  const [sessionTree, setSessionTree] = useState<SessionTreeView | undefined>();
  const [sessionTreeLoading, setSessionTreeLoading] = useState(false);
  const [sessionTreeError, setSessionTreeError] = useState<string | undefined>();
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfoView | undefined>();
  const [sessionInfoLoading, setSessionInfoLoading] = useState(false);
  const [sessionInfoError, setSessionInfoError] = useState<string | undefined>();
  /** `/name` with no args → rename dialog for pi session display name. */
  const [sessionNameDialogOpen, setSessionNameDialogOpen] = useState(false);
  /** Product-visible pi install / ensure progress (not only Developer pill). */
  const [piInstallNotice, setPiInstallNotice] = useState<string | undefined>();
  const lastEscapeAtRef = useRef(0);
  const threadColumnRef = useRef<HTMLElement | null>(null);
  const setSidebarOpen = useShellStore((s) => s.setSidebarOpen);
  const setLastFailure = useShellStore((s) => s.setLastFailure);
  const clearAppError = useShellStore((s) => s.clearAppError);
  const setView = useShellStore((s) => s.setView);
  const setPackages = useShellStore((s) => s.setPackages);
  const setResources = useShellStore((s) => s.setResources);
  const setEcoLoading = useShellStore((s) => s.setEcoLoading);
  const setThemePreference = useShellStore((s) => s.setThemePreference);
  const toggleColorMode = useShellStore((s) => s.toggleColorMode);
  const syncSystemTheme = useShellStore((s) => s.syncSystemTheme);
  const toggleSidebarCollapsed = useShellStore((s) => s.toggleSidebarCollapsed);
  const setSidebarWidthPx = useShellStore((s) => s.setSidebarWidthPx);
  const setSidebarTranslucent = useShellStore((s) => s.setSidebarTranslucent);
  const setLocale = useShellStore((s) => s.setLocale);
  const setSettingsSection = useShellStore((s) => s.setSettingsSection);
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);
  const setRuntimeId = useShellStore((s) => s.setRuntimeId);
  const setLastSequence = useShellStore((s) => s.setLastSequence);
  const acceptSnapshot = useShellStore((s) => s.acceptSnapshot);
  const applySessionOpen = useShellStore((s) => s.applySessionOpen);
  const resetAfterStop = useShellStore((s) => s.resetAfterStop);

  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingComposerFocus = useRef(false);
  /** Floating composer height — timeline bottom inset so last rows stay above the input. */
  const [composerDockHeight, setComposerDockHeight] = useState(200);
  const [modelOptions, setModelOptions] = useState<
    Array<{ provider: string; id: string; name: string }>
  >([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  /** Sessions keyed by project cwd — all projects, no switch required to browse. */
  const [threadsByCwd, setThreadsByCwd] = useState<Record<string, SessionThreadSummary[]>>({});
  const [accessMode, setAccessMode] = useState<AccessMode>(loadAccessMode);
  const [accessVisibility, setAccessVisibility] = useState<AccessVisibility>(loadAccessVisibility);
  const [showContextUsage, setShowContextUsage] = useState(loadShowContextUsage);
  const [shortcutRevision, setShortcutRevision] = useState(0);

  function applyAccessMode(mode: AccessMode) {
    const next = resolveAccessMode(mode, accessVisibility);
    setAccessMode(next);
    saveAccessMode(next);
    // Full access maps onto project trust when host is live.
    if (next === "full") {
      const snap = useShellStore.getState().snapshot;
      if (snap && !snap.projectTrusted) {
        void window.pix.trust.set(true).then(
          (nextSnap) => {
            acceptSnapshot(nextSnap);
            setStatus("Project trusted");
          },
          (error: unknown) => {
            reportAppError(error, "Failed to set trust");
          },
        );
      }
    }
  }

  function applyAccessVisibility(visibility: AccessVisibility) {
    setAccessVisibility(visibility);
    saveAccessVisibility(visibility);
    // If the selected mode was hidden, fall back to a still-visible option.
    const resolved = resolveAccessMode(accessMode, visibility);
    if (resolved !== accessMode) {
      setAccessMode(resolved);
      saveAccessMode(resolved);
    }
  }

  function applyShowContextUsage(value: boolean) {
    setShowContextUsage(value);
    saveShowContextUsage(value);
  }
  const [speedMode, setSpeedMode] = useState<SpeedMode>(() => {
    try {
      const v = localStorage.getItem("pix.composer.speed");
      if (v === "fast" || v === "balanced" || v === "quality") return v;
    } catch {
      // ignore
    }
    return "balanced";
  });
  const [attachments, setAttachments] = useState<string[]>([]);
  /**
   * Selected project for composer chrome / rail highlight.
   * Global「新建会话」clears this (pure conversation) but must keep the project
   * visible via recentWorkspaces — never leave a frame where it vanishes.
   */
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | undefined>();
  /** Always-current selection for async helpers (avoids stale closures after setState). */
  const selectedWorkspacePathRef = useRef<string | undefined>(undefined);
  selectedWorkspacePathRef.current = selectedWorkspacePath;
  /**
   * True while global「新建会话」is in flight. Forces conversation empty chrome
   * (title + no project highlight) without wiping snapshot model/thinking mid-flight.
   */
  const [pendingPureConversation, setPendingPureConversation] = useState(false);
  const pendingPureConversationRef = useRef(false);

  function selectWorkspacePath(path: string | undefined) {
    selectedWorkspacePathRef.current = path;
    setSelectedWorkspacePath(path);
  }

  /** Last known model chrome — survives snapshot gaps so composer never flashes "未选择模型". */
  const lastComposerChromeRef = useRef<{
    model?: { provider: string; id: string };
    thinkingLevel?: string;
    availableThinkingLevels?: string[];
  }>({});
  if (snapshot?.model) {
    const chrome: {
      model?: { provider: string; id: string };
      thinkingLevel?: string;
      availableThinkingLevels?: string[];
    } = { model: snapshot.model };
    if (snapshot.thinkingLevel !== undefined) chrome.thinkingLevel = snapshot.thinkingLevel;
    if (snapshot.availableThinkingLevels !== undefined) {
      chrome.availableThinkingLevels = snapshot.availableThinkingLevels;
    }
    lastComposerChromeRef.current = chrome;
  }

  /** Hide conversation/scratch dirs from project chrome / sidebar. */
  function asProjectPath(path: string | undefined): string | undefined {
    if (!path || isNonProjectWorkspacePath(path)) return undefined;
    return path;
  }

  // Prefer explicit selection over host snapshot so mid-switch host.ready cannot flash the rail.
  // While creating a pure conversation, never fall back to the old project snapshot cwd.
  const workspacePath =
    asProjectPath(selectedWorkspacePath) ??
    (pendingPureConversation ? undefined : asProjectPath(snapshot?.cwd));
  const workspace = workspaceLabel(workspacePath);
  /** Host running under conversation home (not a user project), or about to. */
  const isPureConversation =
    pendingPureConversation || Boolean(snapshot?.cwd && isNonProjectWorkspacePath(snapshot.cwd));
  /** Suppress snapshot→selection sync while switchThread / newBlankTask is in flight. */
  const switchingSessionRef = useRef(false);

  useEffect(() => {
    // Never promote conversation/scratch dirs into the "selected project" slot.
    if (switchingSessionRef.current || pendingPureConversationRef.current) return;
    if (snapshot?.cwd && !isNonProjectWorkspacePath(snapshot.cwd)) {
      selectWorkspacePath(snapshot.cwd);
    }
  }, [snapshot?.cwd]);
  const runState = deriveRunState({ hostStatus: status, running, lastFailure });
  /** Session identity — used to pin scroll + remount timeline rows on switch. */
  const sessionKey = snapshot?.sessionFile ?? snapshot?.sessionId ?? "";
  const timeline = useMemo(() => {
    // history = session JSONL at open; liveStream = append-only log for this session
    // (streamed text only grows). Do not re-project deltas from the events ring.
    const items = [...historyToTimeline(history), ...liveStream.items].filter(
      (item) => !(snapshot?.hideThinkingBlock && item.kind === "thinking"),
    );
    // Prefix ids with session so React does not reuse rows across switches.
    if (!sessionKey) return items;
    return items.map((item) => ({ ...item, id: `${sessionKey}:${item.id}` }));
  }, [history, liveStream, sessionKey, snapshot?.hideThinkingBlock]);
  const timelineBlocks = useMemo(() => buildTimelineBlocks(timeline), [timeline]);
  const hasActivity = timeline.length > 0;
  const waitingForInput = runState === "waiting";
  const liveActivity = useMemo(
    () =>
      deriveLiveActivity({
        items: timeline,
        events,
        running,
        waiting: waitingForInput,
      }),
    [timeline, events, running, waitingForInput],
  );
  const showLiveStatus =
    liveActivity != null && !processBlockCoversLiveActivity(timelineBlocks, liveActivity);
  const activeThread = threads.find((thread) => thread.active);
  const threadTitle =
    activeThread?.title ||
    (sentPrompts[0]
      ? firstLine(sentPrompts[0])
      : pendingPureConversation || isPureConversation || !snapshot
        ? t(locale, "thread.new")
        : t(locale, "thread.current"));
  const displayModel = snapshot?.model ?? lastComposerChromeRef.current.model;
  const displayThinkingLevel =
    snapshot?.thinkingLevel ?? lastComposerChromeRef.current.thinkingLevel ?? "off";
  // Full pi ThinkingLevel set (docs: off…max). Model support enforced on apply.
  const displayThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

  function normalizeCwdKey(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  async function refreshThreads() {
    try {
      const listed = await window.pix.session.list();
      setThreads(listed.threads);
      const cwd = useShellStore.getState().snapshot?.cwd;
      if (cwd) {
        setThreadsByCwd((prev) => ({ ...prev, [normalizeCwdKey(cwd)]: listed.threads }));
      }
    } catch {
      // Host may be stopped.
    }
  }

  async function refreshProjectSessions(paths: string[]) {
    const unique = [...new Set(paths.map(normalizeCwdKey).filter(Boolean))];
    if (unique.length === 0) return;
    const results = await Promise.all(
      unique.map(async (cwd) => {
        try {
          const threads = await window.pix.session.listForCwd(cwd);
          return [cwd, threads] as const;
        } catch {
          return [cwd, [] as SessionThreadSummary[]] as const;
        }
      }),
    );
    setThreadsByCwd((prev) => {
      const next = { ...prev };
      for (const [cwd, threads] of results) next[cwd] = threads;
      return next;
    });
  }

  /**
   * Prefetch pure-conversation sessions (Documents/Pix/conversations) so the
   * 对话 rail stays populated even while a project host is active.
   */
  async function refreshConversationSessions() {
    try {
      const convCwd = await window.pix.workspace.ensureConversation();
      const threads = await window.pix.session.listForCwd(convCwd);
      setThreadsByCwd((prev) => ({
        ...prev,
        [normalizeCwdKey(convCwd)]: threads,
      }));
    } catch {
      // Host may be stopped or conversation home unavailable.
    }
  }

  useEffect(() => {
    applyDocumentTheme(colorMode);
  }, [colorMode]);

  useEffect(() => {
    void window.pix.appearance.setThemeSource(themePreference);
  }, [themePreference]);

  // Overlay auto-hide scrollbars for main content panes (settings / packages / thread…).
  useEffect(() => installOverlayScroll(), []);

  // Env panel: float in free right gutter when it would not cover conversation;
  // dock (squeeze) when it would cover; auto-hide when min widths no longer fit both.
  useEffect(() => {
    if (view !== "thread") return;
    const el = threadColumnRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => {
      const mode = envPanelLayoutForWidth(width);
      const fits = mode !== "none";
      setEnvPanelFits(fits);
      if (mode === "float" || mode === "dock") setEnvPanelLayout(mode);
      if (!fits && useShellStore.getState().envPanelOpen) {
        useShellStore.getState().setEnvPanelOpen(false);
      }
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      apply(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  // Follow OS appearance when theme preference is "system".
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => syncSystemTheme();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [syncSystemTheme, themePreference]);

  useEffect(() => {
    void refreshRecentWorkspaces();
  }, [snapshot?.cwd]);

  // Load sessions for every known project so expand shows chats without switching first.
  useEffect(() => {
    const paths = [...(workspacePath ? [workspacePath] : []), ...recentWorkspaces];
    void refreshProjectSessions(paths);
    // Always refresh pure conversations for the 对话 section.
    void refreshConversationSessions();
  }, [workspacePath, recentWorkspaces]);

  // Cold start: ensure global `pi` CLI → recent projects + packages/resources.
  useEffect(() => {
    let cancelled = false;
    let hideTimer: number | undefined;
    const formatPiProgress = (event: {
      phase: string;
      message: string;
      version?: string;
      installedNow?: boolean;
    }) => {
      const loc = useShellStore.getState().locale;
      const versionLabel = event.version ? ` ${event.version}` : "";
      switch (event.phase) {
        case "checking":
          return t(loc, "pi.checking");
        case "installing":
          return t(loc, "pi.installing");
        case "progress":
          return t(loc, "pi.progress", { detail: event.message });
        case "complete":
          return event.installedNow
            ? t(loc, "pi.completeInstalled", { version: versionLabel })
            : t(loc, "pi.complete", { version: versionLabel });
        case "error":
          return t(loc, "pi.error", { detail: event.message });
        case "skipped":
          return t(loc, "pi.skipped");
        default:
          return event.message;
      }
    };
    const showPiNotice = (text: string, phase?: string) => {
      useShellStore.getState().setStatus(text);
      // Keep product-visible for install work / errors; hide quiet "already present" quickly.
      if (phase === "complete" && !text.includes("刷新") && !/refresh/i.test(text)) {
        setPiInstallNotice(text);
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (!cancelled) setPiInstallNotice(undefined);
        }, 2800);
        return;
      }
      if (phase === "skipped") {
        setPiInstallNotice(undefined);
        return;
      }
      setPiInstallNotice(text);
    };
    const unsubPiProgress = window.pix.pi.onProgress((event) => {
      showPiNotice(formatPiProgress(event), event.phase);
    });
    void (async () => {
      try {
        // Main process also starts ensure on ready; this shares the in-flight promise.
        const piResult = await window.pix.pi.ensure();
        if (cancelled) return;
        if (piResult.error) {
          showPiNotice(
            t(useShellStore.getState().locale, "pi.error", { detail: piResult.error }),
            "error",
          );
        } else if (piResult.installedNow) {
          showPiNotice(
            t(useShellStore.getState().locale, "pi.completeInstalled", {
              version: piResult.version ? ` ${piResult.version}` : "",
            }),
            "complete",
          );
          try {
            const snap = await window.pix.host.start({ force: true });
            if (!cancelled) useShellStore.getState().acceptSnapshot(snap);
          } catch {
            // Host may not be up yet — refreshPiStatus will start it.
          }
        } else if (piResult.alreadyPresent) {
          showPiNotice(
            t(useShellStore.getState().locale, "pi.complete", {
              version: piResult.version ? ` ${piResult.version}` : "",
            }),
            "complete",
          );
        }
      } catch (error) {
        if (!cancelled) {
          showPiNotice(
            t(useShellStore.getState().locale, "pi.error", {
              detail: error instanceof Error ? error.message : String(error),
            }),
            "error",
          );
        }
      }
      if (cancelled) return;
      await refreshRecentWorkspaces();
      if (cancelled) return;
      await refreshPiStatus({ ensure: true });
      if (cancelled) return;
      await refreshConversationSessions();
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(hideTimer);
      unsubPiProgress();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      window.pix.host.onEvent((event) => {
        const store = useShellStore.getState();
        if (event.type === "host.ready" || event.type === "runtime.snapshot") {
          store.acceptSnapshot(event.snapshot);
          // Host up → refresh pi-home status (packages / resources), project or not.
          if (event.type === "host.ready") void refreshPiStatus({ ensure: false });
        } else if (event.type === "host.restarted") {
          store.acceptSnapshot(event.snapshot);
          store.setStatus("Agent Host restarted");
          void refreshPiStatus({ ensure: false });
        } else if (event.type === "host.crashed") {
          // Background (parked) host death must not wipe the foreground session.
          if (event.runtimeId && store.runtimeId && event.runtimeId !== store.runtimeId) {
            store.settleSessionByRuntime(event.runtimeId, "crashed", event.message);
            return;
          }
          store.resetAfterCrash(event.message);
          maybeNotify("crash", event.message);
        } else if (event.type === "session.list") {
          store.setThreads(event.threads);
          const cwd = store.snapshot?.cwd;
          if (cwd && event.threads.length > 0) {
            setThreadsByCwd((prev) => ({
              ...prev,
              [normalizeCwdKey(cwd)]: event.threads,
            }));
          }
        } else if (event.type === "session.opened") {
          // switchThread / newBlankTask apply the open themselves. Intermediate
          // session.opened (e.g. from workspace.openPath) must not wipe history into
          // an empty hero flash mid-transition.
          if (switchingSessionRef.current || pendingPureConversationRef.current) {
            const cwd = event.snapshot.cwd;
            if (cwd && event.threads.length > 0) {
              setThreadsByCwd((prev) => ({
                ...prev,
                [normalizeCwdKey(cwd)]: event.threads,
              }));
            }
            return;
          }
          markSessionOpenForBottomScroll();
          store.applySessionOpen(event);
          requestContentReveal();
          // Keep sidebar caches in sync without clearing other projects' lists.
          const cwd = event.snapshot.cwd;
          if (cwd && event.threads.length > 0) {
            setThreadsByCwd((prev) => ({
              ...prev,
              [normalizeCwdKey(cwd)]: event.threads,
            }));
          }
        } else if (event.type === "packages.progress") {
          if (event.message) store.setStatus(event.message);
        } else if (event.type === "packages.changed") {
          store.setPackages(event.packages);
          // Install/remove/update may load new skills/prompts/extensions.
          void window.pix.resources
            .list()
            .then((list) => store.setResources(list))
            .catch(() => undefined);
        } else if (event.type === "runtime.event") {
          const delivery = classifyRuntimeEventDelivery(store, event);
          // Background (parked) hosts only surface terminal events for sidebar markers.
          if (delivery === "stale-runtime") {
            if (event.event.type === "agent.settled") {
              store.settleSessionByRuntime(event.runtimeId, "completed");
              maybeNotify("complete");
            } else if (event.event.type === "message.failed") {
              const aborted = event.event.reason === "aborted";
              store.settleSessionByRuntime(
                event.runtimeId,
                aborted ? "aborted" : "failed",
                event.event.message,
              );
              maybeNotify("error", event.event.message);
            }
            // Ignore background agent.started — re-binding can re-light finished rows.
            return;
          }
          if (delivery === "duplicate") return;

          // Always fold into append-only liveStream first (sequence-deduped, text never
          // shrinks). Do this even on "gap" so tokens we did receive are not discarded.
          store.applyLiveStreamEvent(event.event, store.sentPrompts, {
            sequence: event.sequence,
          });

          if (delivery === "gap") {
            // Recover host high-water mark; liveStream already has this event's tokens.
            void window.pix.host.snapshot().then(store.acceptSnapshot);
            store.setEvents((current) => appendHostEvent(current, event));
            if (event.sequence > store.lastSequence) store.setLastSequence(event.sequence);
            return;
          }
          if (event.sequence > store.lastSequence) store.setLastSequence(event.sequence);

          if (event.event.type === "queue.updated") {
            store.setQueuedMessages({
              steering: event.event.steering,
              followUp: event.event.followUp,
            });
          } else if (event.event.type === "message.failed") {
            store.setLastFailure(event.event.message);
            const aborted = event.event.reason === "aborted";
            store.settleSessionByRuntime(
              event.runtimeId,
              aborted ? "aborted" : "failed",
              event.event.message,
            );
            maybeNotify("error", event.event.message);
          } else if (event.event.type === "agent.settled") {
            store.settleSessionByRuntime(event.runtimeId, "completed");
            maybeNotify("complete");
          }
          // Do NOT set running from agent.started / compaction.started — those can fire
          // around host/session lifecycle without a user prompt and stuck the sidebar spinner.
          // Busy markers are only set by sendPrompt → setSessionRunning(true).
        } else if (event.type === "extensionUi.request") {
          if (event.runtimeId !== store.runtimeId) return;
          // Only show waiting if this session is already in a user-initiated turn.
          const key = sessionKeyFromSnapshot(store.snapshot);
          if (key && store.runningSessions[key]) {
            store.setSessionMarker(key, "waiting", {
              runtimeId: event.runtimeId,
              reason: event.method,
            });
          }
          void respondToExtensionUi(event).finally(() => {
            const st = useShellStore.getState();
            const k = sessionKeyFromSnapshot(st.snapshot);
            if (k && st.runningSessions[k]) {
              st.setSessionMarker(k, "running", { runtimeId: event.runtimeId });
            }
          });
        }
        // Events ring is diagnostics / activity only — not the text authority.
        store.setEvents((current) => appendHostEvent(current, event));
      }),
    [],
  );

  /**
   * Pin the conversation scrollport to its true bottom (above the in-flow composer).
   * Never use element.scrollIntoView — that can scroll the window/app chrome instead
   * of only the content column.
   */
  function pinTimelineScrollport(behavior: ScrollBehavior = "auto") {
    const el = timelineScrollRef.current;
    if (!el) return;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (behavior === "smooth") {
      el.scrollTo({ top: maxTop, behavior: "smooth" });
    } else {
      el.scrollTop = maxTop;
    }
    // Programmatic pins do not always keep the floating thumb in sync — force it.
    syncOverlayScroll(el, { show: true });
    requestAnimationFrame(() => syncOverlayScroll(el, { show: true }));
  }

  /**
   * Session open/switch: hold the content pane blank until history is applied and
   * scrolled to bottom. Never show empty-hero or project-bar protrusion mid-transition.
   */
  const pendingScrollBottomRef = useRef(false);
  /** True from switch/open start until we intentionally reveal (blocks empty early-exit). */
  const holdBlankRef = useRef(false);
  const [timelineReady, setTimelineReady] = useState(true);
  /** Bumped after applySessionOpen so settle re-runs even when history length is unchanged. */
  const [revealToken, setRevealToken] = useState(0);

  function markSessionOpenForBottomScroll() {
    pendingScrollBottomRef.current = true;
    holdBlankRef.current = true;
    setTimelineReady(false);
  }

  function requestContentReveal() {
    setRevealToken((n) => n + 1);
  }

  function finishBlankHold() {
    holdBlankRef.current = false;
    pendingScrollBottomRef.current = false;
    setTimelineReady(true);
  }

  // After history lands: pin to bottom while still invisible, then reveal, then
  // re-pin once ThreadHeader / composer height change the viewport.
  useLayoutEffect(() => {
    if (!pendingScrollBottomRef.current) return;

    // Mid-switch before applySessionOpen: dock resize / partial renders must stay blank.
    // Never flash empty-hero ("在 xxx 中开始") or the composer project protrusion.
    if (switchingSessionRef.current) return;

    const el = timelineScrollRef.current;
    if (!el) return;

    if (timeline.length === 0) {
      // True empty session after apply (revealToken bumped, switch done).
      finishBlankHold();
      return;
    }

    let cancelled = false;
    let frames = 0;
    // Markdown layout can take a few frames; stay invisible while measuring.
    const preRevealFrames = 6;

    // Pin only the conversation scrollport (bottom edge = top of composer dock).
    const pinBottom = () => pinTimelineScrollport("auto");

    // Sync pin before paint of this commit.
    pinBottom();

    const tick = () => {
      if (cancelled) return;
      pinBottom();
      frames += 1;
      if (frames < preRevealFrames) {
        requestAnimationFrame(tick);
        return;
      }
      // Reveal while already pinned; header/composer height changes resize the scrollport.
      holdBlankRef.current = false;
      setTimelineReady(true);
      // Post-reveal pins: after paint so clientHeight reflects final column layout.
      requestAnimationFrame(() => {
        if (cancelled) return;
        pinBottom();
        requestAnimationFrame(() => {
          if (cancelled) return;
          pinBottom();
          requestAnimationFrame(() => {
            if (cancelled) return;
            pinBottom();
            pendingScrollBottomRef.current = false;
          });
        });
      });
    };

    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [sessionKey, history.length, timeline.length, composerDockHeight, revealToken]);

  // Track composer height so the jump-to-bottom control sits above the sticky dock
  // (composer is in-flow — content area bottom is the dock top, not the window edge).
  useEffect(() => {
    const dock = composerDockRef.current;
    if (!dock || typeof ResizeObserver === "undefined") return;
    const apply = () => setComposerDockHeight(Math.ceil(dock.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(dock);
    return () => ro.disconnect();
  }, [hasActivity, showContextUsage, accessVisibility, timelineReady]);

  /** Pixels from scrollport bottom — MessageScroller autoScroll edge threshold. */
  const SCROLL_BOTTOM_GAP_PX = 64;

  async function ensureHost(): Promise<HostSnapshot> {
    const store = useShellStore.getState();
    if (store.snapshot && store.runtimeId) return store.snapshot;
    let knownCwd =
      asProjectPath(store.snapshot?.cwd) ??
      asProjectPath(selectedWorkspacePath) ??
      (await window.pix.workspace.getCwd().catch(() => undefined));
    // Prefer a real project cwd; ignore conversation/scratch for "has project" checks.
    if (knownCwd && isNonProjectWorkspacePath(knownCwd)) {
      knownCwd = undefined;
    }
    // No user project → host still needs a cwd. Prefer conversation home for pure chat;
    // fall back to date scratch only for background pi-status (packages/resources).
    if (!knownCwd) {
      knownCwd = await window.pix.workspace.ensureConversation();
    }
    if (!isNonProjectWorkspacePath(knownCwd)) {
      selectWorkspacePath(knownCwd);
    }
    setStatus("正在启动 Agent Host…");
    const value = await window.pix.host.start({ cwd: knownCwd });
    acceptSnapshot(value);
    setStatus("Agent Host ready");
    try {
      await refreshComposerModels();
    } catch {
      setModelOptions([]);
    }
    await refreshThreads();
    await refreshRecentWorkspaces();
    return value;
  }

  /**
   * Composer model picker: only providers with stored/runtime/env auth or OAuth.
   * Settings still lists every model for configuration.
   */
  async function refreshComposerModels(): Promise<void> {
    const [models, providers] = await Promise.all([
      window.pix.models.list(),
      window.pix.providers.list(),
    ]);
    const readyProviders = new Set(
      providers.filter((provider) => provider.configured).map((provider) => provider.provider),
    );
    setModelOptions(
      models
        .filter((model) => readyProviders.has(model.provider))
        .map((model) => ({
          provider: model.provider,
          id: model.id,
          name: model.name,
          ...(model.source ? { source: model.source } : {}),
        })),
    );
  }

  // Re-filter when returning to the thread (e.g. after saving a provider API key).
  useEffect(() => {
    if (view !== "thread" || !runtimeId) return;
    void refreshComposerModels().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refresh on view/runtime changes
  }, [view, runtimeId]);

  /**
   * Always pull pi-home status (packages + resources) when local pi/agent is available.
   * Independent of whether a user project is open — host may use a quiet scratch cwd.
   */
  async function refreshPiStatus(options?: { ensure?: boolean }) {
    const ensure = options?.ensure !== false;
    try {
      if (ensure) await ensureHost();
      else if (!useShellStore.getState().runtimeId) return;
      const [pkgs, res] = await Promise.all([
        window.pix.packages.list(),
        window.pix.resources.list(),
      ]);
      setPackages(pkgs);
      setResources(res);
    } catch {
      // Pi/agent host unavailable — keep previous counts.
    }
  }

  async function refresh() {
    try {
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshThreads();
    } catch (error) {
      reportAppError(error, "Snapshot failed");
    }
  }

  async function refreshSessionTree() {
    setSessionTreeLoading(true);
    setSessionTreeError(undefined);
    try {
      if (!useShellStore.getState().snapshot) await ensureHost();
      setSessionTree(await window.pix.session.tree());
    } catch (error) {
      setSessionTreeError(error instanceof Error ? error.message : "Failed to load session tree");
    } finally {
      setSessionTreeLoading(false);
    }
  }

  async function openSessionTree(mode: "navigate" | "fork" = "navigate") {
    setSessionTreeMode(mode);
    setSessionTreeOpen(true);
    await refreshSessionTree();
  }

  async function refreshSessionInfo() {
    setSessionInfoLoading(true);
    setSessionInfoError(undefined);
    try {
      if (!useShellStore.getState().snapshot) await ensureHost();
      setSessionInfo(await window.pix.session.info());
    } catch (error) {
      setSessionInfoError(error instanceof Error ? error.message : "Failed to load session info");
    } finally {
      setSessionInfoLoading(false);
    }
  }

  async function openSessionInfo() {
    setSessionInfoOpen(true);
    await refreshSessionInfo();
  }

  async function runBuiltinSlash(name: string, args: string, source?: string): Promise<boolean> {
    const action = resolveBuiltinSlash(name, args, source);
    switch (action.type) {
      case "new":
        await newSessionInCurrentWorkspace();
        return true;
      case "model":
        setSettingsSection("models");
        setView("settings");
        return true;
      case "settings":
        setSettingsSection("piSettings");
        setView("settings");
        return true;
      case "session":
        await openSessionInfo();
        return true;
      case "name": {
        const nextName = action.name.trim();
        if (!nextName) {
          // No argument → open rename dialog (visual /name, like CLI prompting for a name).
          setSessionNameDialogOpen(true);
          return true;
        }
        acceptSnapshot(await window.pix.session.setName(nextName));
        setStatus(t(locale, "session.parity.named", { name: nextName }));
        await refreshThreads();
        return true;
      }
      case "tree":
        await openSessionTree();
        return true;
      case "fork":
        await openSessionTree("fork");
        return true;
      case "clone": {
        const opened = await window.pix.session.clone();
        markSessionOpenForBottomScroll();
        applySessionOpen(opened);
        setStatus(t(locale, "session.parity.cloned"));
        return true;
      }
      case "compact": {
        acceptSnapshot(await window.pix.session.compact(action.instructions));
        setStatus(t(locale, "session.parity.compacted"));
        await refreshThreads();
        return true;
      }
      case "export": {
        const result = await window.pix.session.exportPick(action.format);
        if (!result) return true;
        setStatus(
          t(locale, "session.parity.exported", {
            format: action.format,
            path: result.path,
          }),
        );
        return true;
      }
      case "import": {
        const opened = action.path
          ? await window.pix.session.import(action.path)
          : await window.pix.session.importPick();
        if (!opened) return true;
        markSessionOpenForBottomScroll();
        applySessionOpen(opened);
        setStatus(t(locale, "session.parity.imported"));
        return true;
      }
      case "copy": {
        const text = await window.pix.session.copyLastAssistant();
        if (!text) {
          reportAppError(
            new Error(t(locale, "session.parity.copyFailed")),
            t(locale, "session.parity.copyFailed"),
          );
          return true;
        }
        await navigator.clipboard.writeText(text);
        setStatus(t(locale, "session.parity.copied"));
        return true;
      }
      case "share": {
        try {
          setStatus(t(locale, "session.parity.sharing"));
          const shared = await window.pix.session.share();
          await navigator.clipboard.writeText(shared.url).catch(() => undefined);
          setStatus(t(locale, "session.parity.shared", { url: shared.url }));
          void window.pix.workspace.openExternal(shared.url).catch(() => undefined);
        } catch (error) {
          reportAppError(error, t(locale, "session.parity.shareFailed"));
        }
        return true;
      }
      case "reload": {
        acceptSnapshot(await window.pix.runtime.reload());
        setStatus(t(locale, "session.parity.reloaded"));
        return true;
      }
      case "hotkeys":
        setSettingsSection("shortcuts");
        setView("settings");
        return true;
      case "upcoming":
        reportAppError(
          new Error(t(locale, "session.parity.commandUpcoming", { name: action.name })),
          t(locale, "session.parity.commandUnavailable"),
        );
        return true;
      case "runtime":
      case "unknown":
        return false;
      default:
        return false;
    }
  }

  /**
   * Edit + resend policy (pi-native):
   * - Any user message with an entry id can be edited (session tree can branch from any turn).
   * - Last user message: navigateTree + resend immediately.
   * - Earlier user messages: confirm first — later turns on this branch are abandoned.
   * Uses navigateTree (same JSONL), never fork (new file).
   */
  const [editResendConfirm, setEditResendConfirm] = useState<{
    item: Extract<TimelineItem, { kind: "user" }>;
    text: string;
  } | null>(null);

  function isLastUserMessage(item: Extract<TimelineItem, { kind: "user" }>): boolean {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const row = timeline[i];
      if (row?.kind !== "user") continue;
      if (item.entryId && row.entryId) return row.entryId === item.entryId;
      return row.id === item.id;
    }
    return true;
  }

  async function editUserAndResend(
    item: Extract<TimelineItem, { kind: "user" }>,
    text: string,
    options?: { skipConfirm?: boolean },
  ) {
    const next = text.trim();
    if (!next || useShellStore.getState().running) return;
    if (!options?.skipConfirm && !isLastUserMessage(item)) {
      setEditResendConfirm({ item, text: next });
      return;
    }
    try {
      if (item.entryId) {
        markSessionOpenForBottomScroll();
        const opened = await window.pix.session.navigateTree(item.entryId, {
          summarize: false,
        });
        if (opened.cancelled) {
          setTimelineReady(true);
          pendingScrollBottomRef.current = false;
          return;
        }
        applySessionOpen({
          snapshot: opened.snapshot,
          threads: opened.threads,
          history: opened.history,
        });
        requestContentReveal();
      }
      // Pass text/attachments explicitly — do not rely on setState + sendPrompt closure.
      await sendPrompt(undefined, undefined, {
        text: next,
        attachments: item.attachments ? [...item.attachments] : [],
      });
    } catch (error) {
      reportAppError(error, t(locale, "timeline.editFailed"));
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    }
  }

  async function sendPrompt(
    event?: FormEvent,
    streamingBehavior?: "steer" | "followUp",
    overrides?: { text?: string; attachments?: string[] },
  ) {
    event?.preventDefault();
    // Always read prompt from the store so edit-resend / async paths are not stale.
    const draft = overrides?.text ?? useShellStore.getState().prompt;
    const attachedPaths = [...(overrides?.attachments ?? attachments)];
    const displayMessage =
      draft.trim() || (attachedPaths.length > 0 ? t(locale, "composer.attach.defaultPrompt") : "");
    if (!displayMessage) return;

    // Built-in slash commands (do not hit the model unless unresolved).
    const slash = parseSlashLine(displayMessage);
    if (slash && attachedPaths.length === 0) {
      try {
        if (!useShellStore.getState().snapshot) await ensureHost();
        const source = buildUnifiedSlashCatalog(useShellStore.getState().snapshot, locale).find(
          (item) => item.name === slash.name,
        )?.source;
        const handled = await runBuiltinSlash(slash.name, slash.args, source);
        if (handled) {
          setPrompt("");
          return;
        }
      } catch (error) {
        reportAppError(error, t(locale, "session.parity.slashFailed"));
        return;
      }
    }

    // pi `!cmd` / `!!cmd` shell injection.
    const shell = parseShellInjection(displayMessage);
    if (shell.kind !== "none" && attachedPaths.length === 0) {
      if (!shell.command.trim()) return;
      const agentWasRunning = useShellStore.getState().running;
      setPrompt("");
      if (!agentWasRunning) setRunning(true);
      setStatus(
        shell.kind === "hidden-shell"
          ? t(locale, "session.parity.shellHidden")
          : t(locale, "session.parity.shellRunning"),
      );
      try {
        if (!useShellStore.getState().snapshot) await ensureHost();
        const result = await window.pix.session.bash(shell.command, {
          excludeFromContext: shell.kind === "hidden-shell",
        });
        acceptSnapshot(result.snapshot);
        const shellEvent = {
          protocolVersion: IPC_PROTOCOL_VERSION,
          type: "runtime.event" as const,
          runtimeId: result.snapshot.runtimeId,
          sequence: result.snapshot.sequence,
          event: { type: "shell.completed" as const, ...result.result },
        };
        setEvents((current) => appendHostEvent(current, shellEvent));
        useShellStore
          .getState()
          .applyLiveStreamEvent(shellEvent.event, useShellStore.getState().sentPrompts, {
            sequence: shellEvent.sequence,
          });
        setStatus(
          result.result.exitCode === 0
            ? t(locale, "session.parity.shellDone")
            : t(locale, "session.parity.shellExit", { code: String(result.result.exitCode) }),
        );
      } catch (error) {
        setPrompt(draft);
        reportAppError(error, t(locale, "session.parity.shellFailed"));
      } finally {
        if (!agentWasRunning) setRunning(false);
      }
      return;
    }

    const wasRunning = useShellStore.getState().running;
    const queueBehavior = wasRunning ? (streamingBehavior ?? "steer") : undefined;
    const message = promptWithAttachedPaths(displayMessage, attachedPaths);
    const imagePaths = attachedPaths.filter(isPromptImagePath);

    // If the user switches sessions mid-request, ignore late host results for this view.
    const snapAtStart = useShellStore.getState().snapshot;
    const sessionAtStart = sessionKeyFromSnapshot(snapAtStart);
    const runtimeAtStart = snapAtStart?.runtimeId;
    const stillSameSession = () => {
      return sessionKeyFromSnapshot(useShellStore.getState().snapshot) === sessionAtStart;
    };

    setPrompt("");
    setAttachments([]);
    setSentPrompts((current) => [...current, displayMessage]);
    // Optimistic user row (append-only live stream). Host user.message dedupes if same text.
    useShellStore
      .getState()
      .applyLiveStreamEvent(
        { type: "user.message", content: displayMessage },
        useShellStore.getState().sentPrompts,
      );

    if (queueBehavior) {
      // Already streaming — keep stop button; just queue follow-up / steer.
      setStatus(queueBehavior === "followUp" ? "Follow-up queued" : "Guidance queued");
      try {
        if (!useShellStore.getState().snapshot) await ensureHost();
        const next = await window.pix.agent.prompt(message, queueBehavior, imagePaths);
        if (stillSameSession()) acceptSnapshot(next);
      } catch (error) {
        if (!stillSameSession()) return;
        setPrompt(draft);
        setAttachments((current) => [...new Set([...attachedPaths, ...current])].slice(0, 12));
        setSentPrompts((current) => {
          const index = current.lastIndexOf(displayMessage);
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
        reportAppError(error, "排队失败");
      }
      return;
    }

    // Flip send → stop immediately (before ensureHost / stream wait).
    if (sessionAtStart) setSessionRunning(sessionAtStart, true, runtimeAtStart);
    else setRunning(true);
    setLastFailure(undefined);
    setStatus("Agent running...");
    let promptDispatched = false;
    try {
      if (!useShellStore.getState().snapshot) await ensureHost();
      // User may have switched sessions during ensureHost — do not bind the new
      // runtime to the old session key or prompt into the wrong host.
      if (!stillSameSession()) {
        if (sessionAtStart) setSessionRunning(sessionAtStart, false, runtimeAtStart);
        else setRunning(false);
        return;
      }
      const rid = useShellStore.getState().runtimeId ?? runtimeAtStart;
      if (sessionAtStart && rid) setSessionRunning(sessionAtStart, true, rid);
      promptDispatched = true;
      const next = await window.pix.agent.prompt(message, undefined, imagePaths);
      if (!stillSameSession()) return;
      acceptSnapshot(next);
      setStatus("Agent settled");
      await refreshThreads();
    } catch (error) {
      // Switched away — do not restore draft into the new session.
      if (!stillSameSession()) return;
      // Host/workspace/IPC failures → modal + restore draft for retry.
      setPrompt(draft);
      setAttachments((current) => [...new Set([...attachedPaths, ...current])].slice(0, 12));
      setSentPrompts((current) => {
        const idx = current.lastIndexOf(displayMessage);
        if (idx < 0) return current;
        return [...current.slice(0, idx), ...current.slice(idx + 1)];
      });
      reportAppError(error, "发送失败");
    } finally {
      if (!sessionAtStart) {
        if (stillSameSession()) setRunning(false);
      } else if (stillSameSession()) {
        // Still viewing this session: clear busy (settled events may already have
        // set completed/failed — setSessionRunning keeps terminal markers).
        setSessionRunning(sessionAtStart, false, runtimeAtStart);
      } else if (!promptDispatched) {
        // Switched away before prompt left the renderer — drop optimistic marker.
        setSessionRunning(sessionAtStart, false, runtimeAtStart);
      }
      // Switched away after dispatch: leave marker for park + settleSessionByRuntime.
      useShellStore.getState().syncForegroundRunning();
    }
  }

  async function clearQueuedMessages() {
    const queuedCount = queuedMessages.steering.length + queuedMessages.followUp.length;
    if (queuedCount === 0) return;
    try {
      const next = await window.pix.agent.clearQueue();
      acceptSnapshot(next);
      setSentPrompts((current) => current.slice(0, Math.max(0, current.length - queuedCount)));
      setStatus("Queued messages cleared");
    } catch (error) {
      reportAppError(error, "清空队列失败");
    }
  }

  async function pickComposerAttachments() {
    try {
      const paths = await window.pix.workspace.pickAttachments();
      if (paths.length === 0) return;
      setAttachments((current) => [...new Set([...current, ...paths])].slice(0, 12));
    } catch (error) {
      reportAppError(error, "添加文件失败");
    }
  }

  async function abort() {
    const snap = useShellStore.getState().snapshot;
    const key = sessionKeyFromSnapshot(snap);
    try {
      acceptSnapshot(await window.pix.agent.abort());
      setStatus("Agent aborted");
    } catch (error) {
      reportAppError(error, "Abort failed");
    } finally {
      if (key) {
        setSessionMarker(key, "aborted", snap?.runtimeId ? { runtimeId: snap.runtimeId } : {});
      } else {
        setRunning(false);
      }
    }
  }

  async function crash() {
    try {
      await window.pix.test.crashHost();
    } catch (error) {
      reportAppError(error, "Crash command failed");
    }
  }

  async function stop() {
    await window.pix.host.stop();
    resetAfterStop();
  }

  async function openPackages() {
    setView("packages");
    setSidebarOpen(false);
    setEcoLoading(true);
    try {
      await refreshPiStatus({ ensure: true });
    } catch (error) {
      reportAppError(error, "Failed to list packages");
    } finally {
      setEcoLoading(false);
    }
  }

  async function openResources() {
    setView("resources");
    setSidebarOpen(false);
    setEcoLoading(true);
    try {
      await refreshPiStatus({ ensure: true });
    } catch (error) {
      reportAppError(error, "Failed to list resources");
    } finally {
      setEcoLoading(false);
    }
  }

  async function openSettings() {
    setView("settings");
    setSettingsSection("general");
    setSidebarOpen(false);
  }

  async function installPackage(
    source: string,
    scope: "global" | "project",
    options?: { temporary?: boolean },
  ) {
    const loc = useShellStore.getState().locale;
    setEcoLoading(true);
    setStatus(
      t(loc, options?.temporary ? "packages.status.installingTemp" : "packages.status.installing", {
        scope,
      }),
    );
    try {
      await ensureHost();
      const next = await window.pix.packages.install(source, scope, options);
      setPackages(next);
      setStatus(
        t(loc, options?.temporary ? "packages.status.installedTemp" : "packages.status.installed"),
      );
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshPiStatus({ ensure: false });
    } catch (error) {
      reportAppError(error, t(loc, "packages.status.installFailed"));
      throw error;
    } finally {
      setEcoLoading(false);
    }
  }

  async function setPackageEnabled(source: string, scope: "global" | "project", enabled: boolean) {
    const loc = useShellStore.getState().locale;
    setEcoLoading(true);
    try {
      const next = await window.pix.packages.setEnabled(source, scope, enabled);
      setPackages(next);
      setStatus(
        t(loc, enabled ? "packages.status.enabled" : "packages.status.disabled", { source }),
      );
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshPiStatus({ ensure: false });
    } catch (error) {
      reportAppError(error, t(loc, "packages.status.enableFailed"));
      throw error;
    } finally {
      setEcoLoading(false);
    }
  }

  async function refreshModelCatalogFromPackages() {
    const loc = useShellStore.getState().locale;
    setEcoLoading(true);
    try {
      await ensureHost();
      await window.pix.models.refreshCatalog();
      setStatus(t(loc, "packages.status.catalogRefreshed"));
      acceptSnapshot(await window.pix.host.snapshot());
    } catch (error) {
      reportAppError(error, t(loc, "packages.status.catalogRefreshFailed"));
    } finally {
      setEcoLoading(false);
    }
  }

  async function removePackage(source: string, scope: "global" | "project") {
    const loc = useShellStore.getState().locale;
    setEcoLoading(true);
    setStatus(t(loc, "packages.status.removing", { scope }));
    try {
      const next = await window.pix.packages.remove(source, scope);
      setPackages(next);
      setStatus(t(loc, "packages.status.removed"));
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshPiStatus({ ensure: false });
    } catch (error) {
      reportAppError(error, t(loc, "packages.status.removeFailed"));
      throw error;
    } finally {
      setEcoLoading(false);
    }
  }

  async function updatePackages(source?: string) {
    const loc = useShellStore.getState().locale;
    setEcoLoading(true);
    setStatus(
      source
        ? t(loc, "packages.status.updating", { source })
        : t(loc, "packages.status.updatingAll"),
    );
    try {
      const next = await window.pix.packages.update(source);
      setPackages(next);
      setStatus(t(loc, "packages.status.updated"));
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshPiStatus({ ensure: false });
    } catch (error) {
      reportAppError(error, t(loc, "packages.status.updateFailed"));
      throw error;
    } finally {
      setEcoLoading(false);
    }
  }

  async function refreshRecentWorkspaces() {
    try {
      const listed = await window.pix.workspace.listRecent();
      // Exclude only the explicitly selected project (shown via workspacePath).
      // Do NOT exclude snapshot.cwd — during global 新建会话 the snapshot may still
      // be the old project for a tick, and filtering it out makes the rail flash empty.
      // Read from ref so callers that just cleared selection don't exclude the old project.
      const selected = asProjectPath(selectedWorkspacePathRef.current);
      setRecentWorkspaces(
        filterRecentWorkspaces(listed, selected ? { current: selected, max: 12 } : { max: 12 }),
      );
    } catch {
      // Keep the previous list — never wipe the rail on a transient listRecent failure.
    }
  }

  async function openWorkspacePath(
    cwd: string,
    options?: { resumeRecent?: boolean; sessionFile?: string },
  ) {
    setStatus(options?.resumeRecent ? `Resuming ${cwd}…` : `Opening workspace ${cwd}…`);
    setEvents([]);
    setSentPrompts([]);
    useShellStore.getState().setHistory([]);
    useShellStore.getState().clearLiveStream();
    selectWorkspacePath(cwd);
    const snap = await window.pix.workspace.openPath(cwd, {
      resumeRecent: options?.resumeRecent === true && !options?.sessionFile,
      ...(options?.sessionFile ? { sessionFile: options.sessionFile } : {}),
    });
    acceptSnapshot(snap);
    setStatus("Agent Host ready");
    // Single list refresh after open — active flag comes from the live host once.
    const listed = await window.pix.session.list();
    setThreads(listed.threads);
    setThreadsByCwd((prev) => ({
      ...prev,
      [normalizeCwdKey(cwd)]: listed.threads,
    }));
    await refreshRecentWorkspaces();
  }

  async function openWorkspacePicker() {
    try {
      const picked = await window.pix.workspace.pickFolder();
      if (!picked) return;
      await openWorkspacePath(picked, { resumeRecent: false });
    } catch (error) {
      reportAppError(error, "Failed to open workspace");
    }
  }

  async function resumeWorkspace() {
    try {
      const raw = (await window.pix.workspace.getCwd()) ?? workspacePath;
      const cwd = asProjectPath(raw);
      if (!cwd) {
        // No real project to resume — stay project-less (do not open date folder as project).
        await ensureHost();
        return;
      }
      await openWorkspacePath(cwd, { resumeRecent: true });
    } catch (error) {
      reportAppError(error, "Failed to resume workspace");
    }
  }

  async function toggleTrust() {
    try {
      const next = !(snapshot?.projectTrusted ?? false);
      setStatus(next ? "Trusting project…" : "Untrusting project…");
      acceptSnapshot(await window.pix.trust.set(next));
      setStatus("Agent Host ready");
    } catch (error) {
      reportAppError(error, "Failed to set trust");
    }
  }

  async function changeModel(provider: string, id: string) {
    try {
      setStatus(`Switching model ${provider}/${id}…`);
      acceptSnapshot(await window.pix.models.set(provider, id));
      setStatus("Agent Host ready");
    } catch (error) {
      reportAppError(error, "Failed to set model");
    }
  }

  async function changeThinking(level: string) {
    try {
      setStatus(`Thinking level ${level}…`);
      acceptSnapshot(await window.pix.thinking.set(level));
      setStatus("Agent Host ready");
    } catch (error) {
      reportAppError(error, "Failed to set thinking level");
    }
  }

  async function openThread() {
    setView("thread");
    setSidebarOpen(false);
    // Thread column remounts when leaving settings/packages — restore true content bottom
    // (scrollport above composer), not the window top.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = timelineScrollRef.current;
        if (!el) return;
        if (el.scrollHeight > el.clientHeight + 4) {
          pinTimelineScrollport("auto");
        }
      });
    });
  }

  async function newSessionInCurrentWorkspace() {
    // Do not abort a generating session — main parks the busy host and starts a new one.
    try {
      // Always wait for a fully ready host (process + runtime), not only a runtimeId flag.
      await ensureHost();
      setView("thread");
      setSidebarOpen(false);
      setPrompt("");
      setAttachments([]);
      setStatus("Creating session...");
      const opened = await window.pix.session.create();
      markSessionOpenForBottomScroll();
      applySessionOpen(opened);
      requestContentReveal();
      setStatus("Agent Host ready");
      await refreshThreads();
      if (isNonProjectWorkspacePath(opened.snapshot.cwd)) await refreshConversationSessions();
    } catch (error) {
      reportAppError(error, "无法在当前位置新建会话");
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    }
  }

  /** Monotonic id so rapid「新建会话」clicks only apply the latest result. */
  const newBlankTaskGenRef = useRef(0);
  const newBlankTaskInFlightRef = useRef(false);

  /**
   * Global「新建会话」(sidebar top + 对话 section header):
   * Pure conversation — NOT bound to any project.
   * Host cwd = Documents/Pix/conversations (hidden from 项目 rail / recent).
   * Only the project-row ✏️ creates a session under that project.
   *
   * Lifecycle (clear/start/create) runs as one main-process exclusive op so rapid
   * clicks cannot kill a mid-start host (Windows exit code 0).
   */
  async function newBlankTask() {
    const gen = ++newBlankTaskGenRef.current;
    // Coalesce bursts: one in-flight op; later clicks only bump gen and wait their turn.
    if (newBlankTaskInFlightRef.current) {
      // Let the in-flight call finish; the latest gen will re-enter via queue below.
    }

    // Do not abort a generating session — main parks the busy host for tab-like switching.
    if (gen !== newBlankTaskGenRef.current) return;

    setView("thread");
    setSidebarOpen(false);
    setPrompt("");
    setReviewOpen(false);
    setEvents([]);
    setSentPrompts([]);
    setLastFailure(undefined);
    setAttachments([]);
    useShellStore.getState().setHistory([]);
    useShellStore.getState().clearLiveStream();

    const prevSnap = useShellStore.getState().snapshot;
    const prevProject = asProjectPath(selectedWorkspacePath) ?? asProjectPath(prevSnap?.cwd);
    // Project was listed only via workspacePath (excluded from recent while open).
    // Promote it into recent BEFORE clearing selection so the card never unmounts.
    if (prevProject) {
      setRecentWorkspaces((prev) => prependRecentPath(prev, prevProject, 12));
    }

    pendingPureConversationRef.current = true;
    setPendingPureConversation(true);
    selectWorkspacePath(undefined);
    // Do NOT setSnapshot(undefined) — composer would flash 未选择模型 / empty would
    // flash 打开工作区以开始. pendingPureConversation drives conversation chrome instead.

    newBlankTaskInFlightRef.current = true;
    try {
      setStatus("Creating conversation...");
      setRuntimeId(undefined);
      setLastSequence(0);

      // Single exclusive main-process op (safe under rapid clicks).
      const opened = await window.pix.session.createBlankConversation();
      if (gen !== newBlankTaskGenRef.current) return;

      markSessionOpenForBottomScroll();
      applySessionOpen(opened);
      requestContentReveal();
      selectWorkspacePath(undefined);
      pendingPureConversationRef.current = false;
      setPendingPureConversation(false);
      setStatus("Agent Host ready");
      try {
        await refreshComposerModels();
      } catch {
        // keep previous modelOptions
      }
      if (gen !== newBlankTaskGenRef.current) return;
      await refreshThreads();
      await refreshConversationSessions();
      await refreshRecentWorkspaces();

      // If more clicks arrived while we worked, run once more for the latest gen.
      if (gen !== newBlankTaskGenRef.current) {
        newBlankTaskInFlightRef.current = false;
        void newBlankTask();
        return;
      }
    } catch (error) {
      if (gen !== newBlankTaskGenRef.current) return;
      pendingPureConversationRef.current = false;
      setPendingPureConversation(false);
      reportAppError(error, "无法开始新会话");
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    } finally {
      if (gen === newBlankTaskGenRef.current) {
        newBlankTaskInFlightRef.current = false;
      }
    }
  }

  /** Project-row only: open that project if needed, then create a new session under it. */
  async function newThreadForProject(path: string) {
    // Do not abort a generating session — main parks the busy host.
    try {
      setView("thread");
      setSidebarOpen(false);
      setPrompt("");
      setReviewOpen(false);
      setEvents([]);
      setSentPrompts([]);
      setLastFailure(undefined);
      setAttachments([]);
      useShellStore.getState().setHistory([]);
      useShellStore.getState().clearLiveStream();
      selectWorkspacePath(path);
      const current = useShellStore.getState().snapshot?.cwd;
      if (!current || normalizeCwdKey(current) !== normalizeCwdKey(path)) {
        await openWorkspacePath(path, { resumeRecent: false });
      } else {
        await ensureHost();
      }
      setStatus("Creating thread...");
      const opened = await window.pix.session.create();
      markSessionOpenForBottomScroll();
      applySessionOpen(opened);
      requestContentReveal();
      setStatus("Agent Host ready");
      await refreshThreads();
    } catch (error) {
      reportAppError(error, "无法在项目下新建会话");
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    }
  }

  async function removeRecentWorkspace(path: string) {
    try {
      const pathKey = normalizeCwdKey(path);
      const wasActive = Boolean(workspacePath) && normalizeCwdKey(workspacePath!) === pathKey;
      const listed = await window.pix.workspace.removeRecent(path);
      // Removing the open project must clear UI current workspace, otherwise
      // ProjectList keeps injecting workspacePath into allPaths and it never disappears.
      if (wasActive) {
        await window.pix.workspace.clearActive().catch(() => undefined);
        selectWorkspacePath(undefined);
        useShellStore.getState().setSnapshot(undefined);
        setRuntimeId(undefined);
        setLastSequence(0);
        setThreads([]);
        setEvents([]);
        setSentPrompts([]);
        useShellStore.getState().setHistory([]);
        setModelOptions([]);
      }
      const cwd = useShellStore.getState().snapshot?.cwd;
      setRecentWorkspaces(
        filterRecentWorkspaces(listed, cwd ? { current: cwd, max: 12 } : { max: 12 }),
      );
      // Drop cached sessions for the removed project.
      setThreadsByCwd((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (normalizeCwdKey(key) === pathKey) delete next[key];
        }
        return next;
      });
    } catch (error) {
      reportAppError(error, "Failed to remove project");
    }
  }

  async function revealWorkspace(path: string) {
    try {
      await window.pix.workspace.revealInFolder(path);
    } catch (error) {
      reportAppError(error, "Failed to reveal folder");
    }
  }

  async function forkThread(entryId?: string) {
    if (running) return;
    if (!entryId) {
      await openSessionTree("fork");
      return;
    }
    try {
      if (!useShellStore.getState().runtimeId) await ensureHost();
      setStatus("Forking thread...");
      const opened = await window.pix.session.fork(entryId);
      markSessionOpenForBottomScroll();
      applySessionOpen(opened);
      setPrompt(opened.selectedText ?? "");
      const cwd = opened.snapshot.cwd;
      if (cwd) {
        setThreadsByCwd((prev) => ({
          ...prev,
          [normalizeCwdKey(cwd)]: opened.threads,
        }));
      }
      requestContentReveal();
      setStatus("Agent Host ready");
    } catch (error) {
      reportAppError(error, "Failed to fork thread");
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    }
  }

  async function switchThread(sessionPath: string, projectCwd?: string) {
    // Tab-like switch: never abort. Main parks a busy host and may promote a parked one.
    switchingSessionRef.current = true;
    // Blank immediately: no empty-hero, no project protrusion, no stale messages.
    markSessionOpenForBottomScroll();
    setEvents([]);
    setSentPrompts([]);
    // Drop prior history so empty chrome cannot paint even if ready flips early.
    useShellStore.getState().setHistory([]);
    useShellStore.getState().clearLiveStream();
    try {
      const store = useShellStore.getState();

      // Resolve the session's working directory (project or pure-conversation home).
      let targetCwd = projectCwd?.trim() || undefined;
      if (!targetCwd) {
        const hit = store.threads.find((t) => t.path === sessionPath || t.id === sessionPath);
        if (hit?.cwd) targetCwd = hit.cwd;
      }
      if (!targetCwd) {
        for (const list of Object.values(threadsByCwd)) {
          const hit = list.find((t) => t.path === sessionPath || t.id === sessionPath);
          if (hit?.cwd) {
            targetCwd = hit.cwd;
            break;
          }
        }
      }
      if (!targetCwd) {
        targetCwd = await window.pix.workspace.ensureConversation();
      }

      const currentCwd = store.snapshot?.cwd;
      const hostReady = Boolean(store.runtimeId && store.snapshot);
      const sameCwd =
        Boolean(currentCwd) && normalizeCwdKey(currentCwd!) === normalizeCwdKey(targetCwd);
      const needWorkspaceSwitch = !hostReady || !sameCwd;

      // Optimistic: only flip `active` flags — never empty lists or collapse projects.
      const markActive = (list: SessionThreadSummary[]) =>
        list.map((t) => ({
          ...t,
          active: t.path === sessionPath || t.id === sessionPath,
        }));
      setThreadsByCwd((prev) => {
        const next: Record<string, SessionThreadSummary[]> = {};
        for (const [k, list] of Object.entries(prev)) {
          next[k] = markActive(list);
        }
        const key = normalizeCwdKey(targetCwd!);
        if (!next[key]?.length && store.threads.length > 0 && sameCwd) {
          next[key] = markActive(store.threads);
        } else if (next[key]) {
          next[key] = markActive(next[key]);
        }
        return next;
      });
      if (sameCwd) {
        setThreads(markActive(store.threads));
      }
      // Do NOT change selectedWorkspacePath until open succeeds (avoids rail flash).
      setStatus("Switching thread...");
      setView("thread");

      // Host must run under the session's cwd. Pure conversation vs project are different hosts.
      if (needWorkspaceSwitch) {
        await window.pix.workspace.openPath(targetCwd, { sessionFile: sessionPath });
      }

      // Authoritative open: history + threads + snapshot in one store update.
      const opened = await window.pix.session.switch(sessionPath);
      // Keep switchingSessionRef true until after apply+reveal so layout won't
      // treat the empty interim as a settled empty session.
      applySessionOpen(opened);
      useShellStore.getState().syncForegroundRunning();
      const cwd = opened.snapshot.cwd || targetCwd;
      selectWorkspacePath(asProjectPath(cwd));
      if (cwd) {
        setThreadsByCwd((prev) => ({
          ...prev,
          [normalizeCwdKey(cwd)]: opened.threads,
        }));
      }
      setEvents([]);
      setSentPrompts([]);
      setStatus("Agent Host ready");
      if (needWorkspaceSwitch) void refreshRecentWorkspaces();
      // End switch gate, then bump reveal so settle runs with final history.
      switchingSessionRef.current = false;
      requestContentReveal();
    } catch (error) {
      reportAppError(error, "无法打开会话");
      holdBlankRef.current = false;
      pendingScrollBottomRef.current = false;
      setTimelineReady(true);
      void refreshThreads();
    } finally {
      switchingSessionRef.current = false;
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendPrompt(undefined, running && event.altKey ? "followUp" : undefined);
      return;
    }
    // doubleEscapeAction from pi settings: tree | fork | none
    if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const double = now - lastEscapeAtRef.current < 450;
      lastEscapeAtRef.current = now;
      if (!double) return;
      event.preventDefault();
      const action = snapshot?.doubleEscapeAction ?? "fork";
      if (action === "tree") void openSessionTree();
      else if (action === "fork") void forkThread();
    }
  }

  function focusComposer() {
    pendingComposerFocus.current = true;
    setView("thread");
    setPaletteOpen(false);
    // Immediate attempt if already on thread (textarea mounted).
    requestAnimationFrame(() => {
      if (useShellStore.getState().view === "thread" && composerRef.current) {
        composerRef.current.focus();
        pendingComposerFocus.current = false;
      }
    });
  }

  // After leaving packages/resources/settings, the composer mounts asynchronously.
  useEffect(() => {
    if (view !== "thread" || !pendingComposerFocus.current) return;
    const id = requestAnimationFrame(() => {
      composerRef.current?.focus();
      pendingComposerFocus.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [view]);

  const commands = useMemo(
    () =>
      buildShellCommands(
        {
          newThread: () => void newBlankTask(),
          openPackages: () => void openPackages(),
          openResources: () => void openResources(),
          openSettings: () => void openSettings(),
          openThread: () => void openThread(),
          focusComposer,
          toggleTheme: () => toggleColorMode(),
          forkThread: () => void forkThread(),
          toggleReview: () => setReviewOpen((open) => !open),
          toggleEnvPanel: () => {
            if (!envPanelFits || !workspacePath || !hasActivity) return;
            setEnvPanelOpen((open) => !open);
          },
        },
        locale,
      ),
    // handlers close over latest store setters; recompute lightly when mode/view/locale changes
    [colorMode, view, running, envPanelFits, workspacePath, hasActivity, shortcutRevision, locale],
  );

  useEffect(() => {
    const refreshShortcuts = () => setShortcutRevision((revision) => revision + 1);
    window.addEventListener(SHORTCUT_OVERRIDES_CHANGED_EVENT, refreshShortcuts);
    return () => window.removeEventListener(SHORTCUT_OVERRIDES_CHANGED_EVENT, refreshShortcuts);
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      // Ignore plain typing in inputs (allow mod shortcuts).
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable = tag === "input" || tag === "textarea" || target?.isContentEditable === true;
      if (editable && !(event.metaKey || event.ctrlKey)) return;

      const id = matchShortcut(event);
      if (!id) return;
      event.preventDefault();
      switch (id) {
        case "command-palette":
          setPaletteOpen(!useShellStore.getState().paletteOpen);
          break;
        case "new-thread":
          void newBlankTask();
          break;
        case "packages":
          void openPackages();
          break;
        case "resources":
          void openResources();
          break;
        case "settings":
          void openSettings();
          break;
        case "thread":
          void openThread();
          break;
        case "focus-composer":
          focusComposer();
          break;
        case "fork-thread":
          void forkThread();
          break;
        case "toggle-theme":
          toggleColorMode();
          break;
        case "toggle-env-panel":
          // Ignore when empty session, no project, or viewport cannot fit panel.
          if (!envPanelFits || !workspacePath || !hasActivity) break;
          setEnvPanelOpen((open) => !open);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands]);

  // Optional: if pi theme name is ever present on snapshot, suggest color mode once.
  useEffect(() => {
    const record = snapshot as (HostSnapshot & { theme?: string }) | undefined;
    const mapped = colorModeFromPiTheme(record?.theme);
    if (mapped && mapped !== colorMode) {
      // Do not auto-override user preference after first manual toggle; only when unset path.
    }
  }, [snapshot, colorMode]);

  const railWidth = sidebarRailWidth(sidebarCollapsed, sidebarWidthPx);

  return (
    <div
      className={cn(
        // Relative shell: sidebar overlays the clear native window region.
        "app-shell relative h-full w-full overflow-hidden text-[var(--text)]",
        sidebarOpen && "sidebar-open",
      )}
      style={
        {
          ["--sidebar-current-width" as string]: `${railWidth}px`,
        } as React.CSSProperties
      }
      data-testid="pix-app"
      data-theme={colorMode}
      data-sidebar-translucent={sidebarTranslucent ? "true" : "false"}
    >
      {/* Linux only (customWindowControls); Windows uses native titleBarOverlay. */}
      <WindowCaptionButtons />
      {piInstallNotice ? (
        <div
          className="pi-install-banner pointer-events-none fixed inset-x-0 top-0 z-[2147483002] flex justify-center px-3 pt-2"
          data-testid="pi-install-banner"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-none max-w-[min(520px,92vw)] truncate rounded-full border border-[var(--border)] bg-[var(--surface-panel)] px-3.5 py-1.5 text-[12px] text-[var(--foreground)] shadow-[var(--shadow-soft)]">
            {piInstallNotice}
          </div>
        </div>
      ) : null}
      <AppSidebar
        colorMode={colorMode}
        themePreference={themePreference}
        locale={locale}
        view={view}
        settingsSection={settingsSection}
        status={status}
        hostPillState={hostPillState(status, running)}
        runState={runState}
        running={running}
        sessionMarkers={sessionMarkers}
        collapsed={sidebarCollapsed}
        widthPx={sidebarWidthPx}
        translucent={sidebarTranslucent}
        snapshot={snapshot}
        workspacePath={workspacePath}
        workspace={workspace}
        recentWorkspaces={recentWorkspaces}
        threads={threads}
        threadsByCwd={threadsByCwd}
        threadTitle={threadTitle}
        packageCount={
          packages.length > 0
            ? packages.length
            : (snapshot?.configuredPackages.global ?? 0) +
              (snapshot?.configuredPackages.project ?? 0)
        }
        resourceCount={
          resources.length > 0
            ? resources.length
            : snapshot?.resources
              ? snapshot.resources.extensions +
                snapshot.resources.skills +
                snapshot.resources.prompts +
                snapshot.resources.themes +
                snapshot.resources.contextFiles
              : 0
        }
        canFork={timeline.some((item) => item.kind === "user")}
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleTheme={() => toggleColorMode()}
        onToggleCollapse={() => toggleSidebarCollapsed()}
        onResizeWidth={(px) => setSidebarWidthPx(px)}
        onNewThread={() => void newBlankTask()}
        onOpenPackages={() => void openPackages()}
        onOpenResources={() => void openResources()}
        onOpenSettings={() => void openSettings()}
        onBackToApp={() => void openThread()}
        onSettingsSection={(section) => setSettingsSection(section)}
        onOpenWorkspace={() => void openWorkspacePicker()}
        onResumeWorkspace={() => void resumeWorkspace()}
        onToggleTrust={() => void toggleTrust()}
        onOpenRecent={(path) => void openWorkspacePath(path, { resumeRecent: true })}
        onSwitchThread={(path, projectCwd) => void switchThread(path, projectCwd)}
        onForkThread={() => void forkThread()}
        onNewThreadForProject={(path) => void newThreadForProject(path)}
        onRemoveRecent={(path) => void removeRecentWorkspace(path)}
        onRevealInFolder={(path) => void revealWorkspace(path)}
        onRefresh={() => void refresh()}
        onCrash={() => void crash()}
        onStop={() => void stop()}
      />

      {/*
        .shell-content is opaque and inset by the rail, leaving the sidebar area clear
        for the native window vibrancy behind it.
      */}
      <div
        className="shell-content"
        style={{
          paddingLeft: railWidth,
          // When collapsed, content is full width.
          maxWidth: "100%",
        }}
        data-testid="shell-main"
        data-rail-width={railWidth}
      >
        {view === "thread" ? (
          <section
            ref={threadColumnRef}
            className="main-column relative flex h-full min-w-0 flex-1 flex-col"
          >
            {/* Title only when content is ready and the session has messages. */}
            {timelineReady && hasActivity ? (
              <ThreadHeader
                locale={locale}
                title={threadTitle}
                thread={activeThread}
                workspacePath={workspacePath}
                sessionId={snapshot?.sessionId}
                collapsed={sidebarCollapsed}
                envToggleVisible={Boolean(workspacePath) && envPanelFits}
              />
            ) : null}

            {/*
              Env panel:
              - float: sits in right gutter, does not squeeze conversation
              - dock: would cover content if floated → take flex space and squeeze
              - auto-hide when column cannot fit min content + panel
            */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-row">
              {/*
                Scrollport = full main column (below title, full right pane height).
                Floating scrollbar track spans the whole app content column — not just
                the message stack above the composer.
                Messages + composer share one `.thread-content-column` (same width/edges).
                Composer is sticky to the bottom of that full-height scrollport.
              */}
              <div className="thread-pane">
                <MessageScrollerProvider
                  autoScroll={timelineReady && hasActivity}
                  defaultScrollPosition="end"
                  scrollEdgeThreshold={SCROLL_BOTTOM_GAP_PX}
                >
                  <MessageScroller className="size-full min-h-0">
                    <MessageScrollerViewport
                      ref={timelineScrollRef}
                      className={cn(
                        "timeline-scroll thread-pane-scroll size-full min-h-0",
                        !timelineReady && "invisible pointer-events-none",
                      )}
                      aria-busy={!timelineReady}
                      data-ready={timelineReady ? "true" : "false"}
                    >
                      {/*
                        MessageScrollerItems MUST be direct children of Content.
                        Nesting them under `.thread-messages` broke MutationObserver /
                        item-count / scroll-height math (mid-stream collapse).
                      */}
                      <MessageScrollerContent
                        className={cn(
                          "thread-content-column thread-content-column-stack gap-0",
                          hasActivity && "thread-messages-active pt-6 pb-0",
                        )}
                        data-testid="timeline"
                      >
                        {hasActivity ? (
                          <>
                            {timelineBlocks.map((block) => {
                              const messageId = block.type === "process" ? block.id : block.item.id;
                              return (
                                <MessageScrollerItem
                                  key={messageId}
                                  messageId={messageId}
                                  // Do not use scrollAnchor during agent turns: pin-to-user-message
                                  // + spacer math fights streaming growth and collapses earlier rows.
                                  // autoScroll following-bottom is enough for chat.
                                  scrollAnchor={false}
                                  className="w-full"
                                >
                                  {block.type === "process" ? (
                                    <TimelineProcessBlock
                                      locale={locale}
                                      items={block.items}
                                      open={block.open}
                                      running={running}
                                      waiting={waitingForInput}
                                      {...(block.open && liveActivity?.phase
                                        ? { livePhase: liveActivity.phase }
                                        : {})}
                                      {...(block.startedAt ? { startedAt: block.startedAt } : {})}
                                      {...(block.endedAt ? { endedAt: block.endedAt } : {})}
                                      {...(block.durationLabel
                                        ? { durationLabel: block.durationLabel }
                                        : {})}
                                      {...(workspacePath ? { workspacePath } : {})}
                                    />
                                  ) : (
                                    <TimelineRow
                                      item={block.item}
                                      locale={locale}
                                      workspacePath={workspacePath}
                                      editingLocked={running}
                                      onEditUser={(item, text) =>
                                        void editUserAndResend(item, text)
                                      }
                                      onForkAssistant={(item) => {
                                        // pi fork: new session file from this assistant entry.
                                        void forkThread(item.entryId);
                                      }}
                                    />
                                  )}
                                </MessageScrollerItem>
                              );
                            })}
                            {showLiveStatus && liveActivity ? (
                              <MessageScrollerItem
                                messageId={`${sessionKey || "live"}:live-status`}
                                className="w-full"
                              >
                                <TimelineLiveStatus locale={locale} activity={liveActivity} />
                              </MessageScrollerItem>
                            ) : null}
                            <div
                              ref={timelineEndRef}
                              className="h-px w-full shrink-0"
                              aria-hidden
                            />
                          </>
                        ) : timelineReady ? (
                          <div
                            className="thread-messages empty flex min-h-full flex-1 flex-col items-center justify-center px-4 text-center"
                            data-testid="empty-hero"
                          >
                            <PixLogo className="mb-5 size-12" title={t(locale, "app.name")} />
                            <h1 className="m-0 max-w-lg text-[26px] leading-snug font-semibold tracking-[-0.03em] text-[var(--text)]">
                              {workspacePath
                                ? t(locale, "empty.title", { name: workspace.name })
                                : isPureConversation || snapshot || pendingPureConversation
                                  ? t(locale, "empty.titleConversation")
                                  : t(locale, "empty.titleNoWorkspace")}
                            </h1>
                            {!workspacePath ? (
                              <p className="mt-3 max-w-md text-[13px] text-[var(--muted-foreground)]">
                                {isPureConversation || snapshot || pendingPureConversation
                                  ? t(locale, "empty.subtitleConversation")
                                  : t(locale, "empty.subtitleNoWorkspace")}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {/*
                          mt-auto pins the dock to the bottom of the min-h-full column when
                          messages are short; sticky keeps it glued to the scrollport bottom
                          while scrolling long threads. (Flattened MessageScroller items no
                          longer provide a flex-1 message wrapper that used to push this down.)
                        */}
                        <div
                          ref={composerDockRef}
                          className="composer-dock pointer-events-none sticky bottom-0 z-[2] mt-auto w-full shrink-0 bg-[var(--canvas)] pt-1 pb-2"
                          data-mode="sticky"
                          data-testid="composer-dock"
                        >
                          {hasActivity && timelineReady ? (
                            <div
                              className="composer-dock-fade pointer-events-none absolute inset-x-0 top-0 z-[1] h-10 -translate-y-full"
                              aria-hidden
                            />
                          ) : null}
                          <Composer
                            locale={locale}
                            prompt={prompt}
                            onPromptChange={setPrompt}
                            onSubmit={(event) => void sendPrompt(event)}
                            onAbort={() => void abort()}
                            onKeyDown={onComposerKeyDown}
                            running={running}
                            composerRef={composerRef}
                            workspacePath={workspacePath}
                            recentWorkspaces={recentWorkspaces}
                            onOpenProject={(path) =>
                              void openWorkspacePath(path, { resumeRecent: true })
                            }
                            onAddProject={() => void openWorkspacePicker()}
                            showProjectBar={timelineReady && !hasActivity}
                            accessMode={accessMode}
                            onAccessMode={applyAccessMode}
                            accessVisibility={accessVisibility}
                            modelOptions={modelOptions}
                            modelValue={
                              displayModel ? `${displayModel.provider}/${displayModel.id}` : ""
                            }
                            onModelChange={(provider, id) => void changeModel(provider, id)}
                            thinkingLevel={displayThinkingLevel}
                            thinkingLevels={displayThinkingLevels}
                            onThinkingChange={(level) => void changeThinking(level)}
                            speedMode={speedMode}
                            onSpeedMode={(mode) => {
                              setSpeedMode(mode);
                              try {
                                localStorage.setItem("pix.composer.speed", mode);
                              } catch {
                                // ignore
                              }
                            }}
                            contextPercent={snapshot?.usage?.context?.percent ?? undefined}
                            contextTokens={
                              snapshot?.usage?.context?.tokens ??
                              snapshot?.usage?.tokens.total ??
                              undefined
                            }
                            showContextUsage={showContextUsage}
                            projectTrusted={snapshot?.projectTrusted}
                            runState={runState}
                            piThemeLabel={piThemeLabel(snapshot)}
                            attachments={attachments}
                            onPickAttachments={pickComposerAttachments}
                            onRemoveAttachment={(path) =>
                              setAttachments((current) => current.filter((item) => item !== path))
                            }
                            onAddAttachments={(paths) =>
                              setAttachments((current) =>
                                [...new Set([...current, ...paths])].slice(0, 12),
                              )
                            }
                            packages={packages}
                            slashCommands={buildUnifiedSlashCatalog(snapshot, locale).map(
                              (item) => ({
                                name: item.name,
                                description: item.upcoming
                                  ? `${item.description}${t(locale, "slash.upcomingSuffix")}`
                                  : item.description,
                                source:
                                  item.source === "skill" ||
                                  item.source === "prompt" ||
                                  item.source === "extension" ||
                                  item.source === "builtin"
                                    ? item.source
                                    : "builtin",
                                ...(item.argumentHint ? { argumentHint: item.argumentHint } : {}),
                              }),
                            )}
                            queuedMessages={queuedMessages}
                            onClearQueue={() => void clearQueuedMessages()}
                          />
                        </div>
                      </MessageScrollerContent>
                    </MessageScrollerViewport>
                    {timelineReady && hasActivity ? (
                      <MessageScrollerButton
                        data-testid="scroll-to-bottom"
                        direction="end"
                        behavior="smooth"
                        title={t(locale, "thread.scrollToBottom")}
                        aria-label={t(locale, "thread.scrollToBottom")}
                        className={cn(
                          // Position via style only — avoid transform fights with enter/exit animation.
                          "z-20 size-7 rounded-full border border-border bg-popover text-foreground",
                          "shadow-[0_4px_16px_rgb(0_0_0/0.28)] hover:bg-accent",
                        )}
                        style={{
                          left: "50%",
                          marginLeft: -14, // half of size-7 (28px) for true center
                          // Sit above sticky composer dock (not the default bottom-4).
                          bottom: Math.max(composerDockHeight + 12, 72),
                        }}
                      >
                        <ArrowDown className="size-3.5" strokeWidth={2.25} />
                        <span className="sr-only">{t(locale, "thread.scrollToBottom")}</span>
                      </MessageScrollerButton>
                    ) : null}
                  </MessageScroller>
                </MessageScrollerProvider>
              </div>

              <EnvPanel
                locale={locale}
                cwd={workspacePath}
                layout={envPanelLayout}
                open={hasActivity && Boolean(workspacePath) && envPanelOpen && envPanelFits}
                onOpenSettings={() => {
                  setSettingsSection("environment");
                  setView("settings");
                }}
                onOpenProject={(path) => void openWorkspacePath(path, { resumeRecent: true })}
              />
            </div>
          </section>
        ) : view === "packages" ? (
          <PackagesPage
            locale={locale}
            packages={packages}
            loading={ecoLoading}
            onRefresh={() => void openPackages()}
            onBack={() => void openThread()}
            onInstall={(source, scope, options) => installPackage(source, scope, options)}
            onRemove={(source, scope) => removePackage(source, scope)}
            onUpdate={(source) => updatePackages(source)}
            onSetEnabled={(source, scope, enabled) => setPackageEnabled(source, scope, enabled)}
            onRefreshCatalog={() => void refreshModelCatalogFromPackages()}
          />
        ) : view === "resources" ? (
          <ResourcesPage
            locale={locale}
            resources={resources}
            loading={ecoLoading}
            onRefresh={() => void openResources()}
            onBack={() => void openThread()}
          />
        ) : (
          <SettingsPage
            snapshot={snapshot}
            status={status}
            locale={locale}
            section={settingsSection}
            colorMode={colorMode}
            themePreference={themePreference}
            sidebarTranslucent={sidebarTranslucent}
            sidebarWidthPx={sidebarWidthPx}
            accessVisibility={accessVisibility}
            onAccessVisibility={applyAccessVisibility}
            accessMode={accessMode}
            onAccessMode={applyAccessMode}
            showContextUsage={showContextUsage}
            onShowContextUsage={applyShowContextUsage}
            onEnsureHost={() => ensureHost()}
            onSnapshot={acceptSnapshot}
            onLocale={setLocale}
            onThemePreference={setThemePreference}
            onTranslucent={setSidebarTranslucent}
            onSidebarWidth={setSidebarWidthPx}
            onToggleTrust={() => void toggleTrust()}
          />
        )}

        {reviewOpen ? (
          <aside className="review-panel" data-testid="review-panel">
            <header>
              <h2>Review</h2>
              <button type="button" className="btn-ghost" onClick={() => setReviewOpen(false)}>
                Close
              </button>
            </header>
            <div className="review-body">
              <p className="empty-note">Runtime snapshot and recent host events.</p>
              <pre data-testid="runtime-snapshot">
                {snapshot ? JSON.stringify(snapshot, null, 2) : "No runtime snapshot yet."}
              </pre>
              <pre data-testid="event-log" style={{ marginTop: "0.75rem" }}>
                {events.length ? JSON.stringify(events.slice(-12), null, 2) : "No events yet."}
              </pre>
              {/* Keep stream-output for E2E assertions on latest assistant text. */}
              <pre data-testid="stream-output" style={{ marginTop: "0.75rem" }}>
                {timeline
                  .filter((item) => item.kind === "assistant")
                  .map((item) => item.text)
                  .join("\n") || "No model output yet."}
              </pre>
            </div>
          </aside>
        ) : (
          // Hidden mirrors so existing E2E selectors remain available without opening Review.
          <div hidden>
            <pre data-testid="runtime-snapshot">
              {snapshot ? JSON.stringify(snapshot, null, 2) : "No runtime snapshot yet."}
            </pre>
            <pre data-testid="event-log">
              {events.length ? JSON.stringify(events, null, 2) : "No events yet."}
            </pre>
            <pre data-testid="stream-output">
              {timeline
                .filter((item) => item.kind === "assistant")
                .map((item) => item.text)
                .join("\n") || "No model output yet."}
            </pre>
          </div>
        )}
      </div>
      {/* /shell-main — content column right of overlay sidebar */}

      <CommandPalette
        open={paletteOpen}
        locale={locale}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
      <SessionTreePanel
        open={sessionTreeOpen}
        mode={sessionTreeMode}
        locale={locale}
        tree={sessionTree}
        loading={sessionTreeLoading}
        error={sessionTreeError}
        onClose={() => setSessionTreeOpen(false)}
        onRefresh={() => void refreshSessionTree()}
        onNavigate={async (node, options) => {
          try {
            if (sessionTreeMode === "fork") {
              setStatus(t(locale, "sessionTree.busy.forking"));
              await forkThread(node.id);
              setSessionTreeOpen(false);
              focusComposer();
              return;
            }
            if (options?.summarize) {
              setStatus(t(locale, "session.parity.treeSummarizing"));
            } else {
              setStatus(t(locale, "sessionTree.busy.navigating"));
            }
            const opened = await window.pix.session.navigateTree(node.id, options);
            if (opened.cancelled) {
              setStatus(t(locale, "session.parity.treeFailed"));
              return;
            }
            markSessionOpenForBottomScroll();
            applySessionOpen({
              snapshot: opened.snapshot,
              threads: opened.threads,
              history: opened.history,
            });
            // User-message targets: pi rewinds to parent and returns text for re-send.
            if (opened.selectedText !== undefined) {
              setPrompt(opened.selectedText);
            }
            setSessionTreeOpen(false);
            setStatus(t(locale, "session.parity.treeNavigated"));
            focusComposer();
          } catch (error) {
            reportAppError(error, t(locale, "session.parity.treeFailed"));
          }
        }}
      />
      <SessionInfoPanel
        open={sessionInfoOpen}
        locale={locale}
        info={sessionInfo}
        loading={sessionInfoLoading}
        error={sessionInfoError}
        onClose={() => setSessionInfoOpen(false)}
        onRefresh={() => void refreshSessionInfo()}
        onRename={async (name) => {
          if (!name) return;
          try {
            acceptSnapshot(await window.pix.session.setName(name));
            await refreshSessionInfo();
            await refreshThreads();
          } catch (error) {
            reportAppError(error, t(locale, "session.parity.renameFailed"));
          }
        }}
        onExport={async (format) => {
          try {
            const result = await window.pix.session.exportPick(format);
            if (!result) return;
            setStatus(t(locale, "session.parity.exported", { format, path: result.path }));
          } catch (error) {
            reportAppError(error, t(locale, "session.parity.exportFailed"));
          }
        }}
        onShare={async () => {
          try {
            setStatus(t(locale, "session.parity.sharing"));
            const shared = await window.pix.session.share();
            await navigator.clipboard.writeText(shared.url).catch(() => undefined);
            setStatus(t(locale, "session.parity.shared", { url: shared.url }));
            void window.pix.workspace.openExternal(shared.url).catch(() => undefined);
          } catch (error) {
            reportAppError(error, t(locale, "session.parity.shareFailed"));
          }
        }}
        onClone={async () => {
          try {
            const opened = await window.pix.session.clone();
            markSessionOpenForBottomScroll();
            applySessionOpen(opened);
            setSessionInfoOpen(false);
            setStatus(t(locale, "session.parity.cloned"));
          } catch (error) {
            reportAppError(error, t(locale, "session.parity.cloneFailed"));
          }
        }}
        onCompact={async () => {
          try {
            acceptSnapshot(await window.pix.session.compact());
            await refreshSessionInfo();
            setStatus(t(locale, "session.parity.compacted"));
          } catch (error) {
            reportAppError(error, t(locale, "session.parity.compactFailed"));
          }
        }}
      />

      <RenameDialog
        open={sessionNameDialogOpen}
        title={t(locale, "session.renameTitle")}
        label={t(locale, "sessionInfo.name")}
        initialValue={snapshot?.sessionName ?? ""}
        confirmLabel={t(locale, "common.confirm")}
        cancelLabel={t(locale, "common.cancel")}
        testId="session-name-dialog"
        onCancel={() => setSessionNameDialogOpen(false)}
        onConfirm={(value) => {
          setSessionNameDialogOpen(false);
          const name = value.trim();
          if (!name) return;
          void (async () => {
            try {
              if (!useShellStore.getState().snapshot) await ensureHost();
              acceptSnapshot(await window.pix.session.setName(name));
              setStatus(t(locale, "session.parity.named", { name }));
              await refreshThreads();
            } catch (error) {
              reportAppError(error, t(locale, "session.parity.renameFailed"));
            }
          })();
        }}
      />

      <ConfirmDialog
        open={Boolean(editResendConfirm)}
        title={t(locale, "timeline.editConfirmTitle")}
        message={t(locale, "timeline.editConfirmMessage")}
        confirmLabel={t(locale, "timeline.editConfirm")}
        cancelLabel={t(locale, "common.cancel")}
        danger
        testId="timeline-edit-resend-confirm"
        onCancel={() => setEditResendConfirm(null)}
        onConfirm={() => {
          const pending = editResendConfirm;
          setEditResendConfirm(null);
          if (!pending) return;
          void editUserAndResend(pending.item, pending.text, { skipConfirm: true });
        }}
      />

      <ErrorDialog
        open={Boolean(appError)}
        title={t(locale, "error.dialogTitle")}
        message={appError ?? ""}
        confirmLabel={t(locale, "error.dialogOk")}
        onClose={clearAppError}
      />
    </div>
  );
}

function PackagesPage(props: {
  locale: Locale;
  packages: PackageSummary[];
  loading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onInstall: (
    source: string,
    scope: "global" | "project",
    options?: { temporary?: boolean },
  ) => Promise<void>;
  onRemove: (source: string, scope: "global" | "project") => Promise<void>;
  onUpdate: (source?: string) => Promise<void>;
  onSetEnabled: (source: string, scope: "global" | "project", enabled: boolean) => Promise<void>;
  onRefreshCatalog: () => void;
}) {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string>) =>
    t(props.locale, key, vars);
  /** Trial install: like CLI `-e` — not written to settings. */
  const [temporary, setTemporary] = useState(false);
  const [busy, setBusy] = useState(false);
  const CATALOG_PAGE = 20;
  const [tab, setTab] = useState<"installed" | "discover">("installed");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogPackage[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const [installingSource, setInstallingSource] = useState<string>();
  const [discoverScope, setDiscoverScope] = useState<"global" | "project">("global");
  const catalogLoadGen = useRef(0);
  const catalogLoadingMoreRef = useRef(false);
  const catalogEndRef = useRef<HTMLDivElement | null>(null);

  const installedSources = useMemo(() => {
    const set = new Set<string>();
    for (const p of props.packages) {
      set.add(p.source);
      // also match bare name without npm: prefix
      if (p.source.startsWith("npm:")) set.add(p.source.slice(4));
    }
    return set;
  }, [props.packages]);

  const catalogHasMore = catalog.length < catalogTotal;

  async function loadCatalog(query = catalogQuery) {
    const gen = ++catalogLoadGen.current;
    setCatalogLoading(true);
    setCatalogError(undefined);
    setCatalogLoadingMore(false);
    catalogLoadingMoreRef.current = false;
    try {
      const result = await window.pix.packages.searchCatalog(
        query.trim() || undefined,
        CATALOG_PAGE,
        0,
      );
      if (gen !== catalogLoadGen.current) return;
      setCatalog(result.packages);
      setCatalogTotal(result.total);
    } catch (error) {
      if (gen !== catalogLoadGen.current) return;
      setCatalog([]);
      setCatalogTotal(0);
      setCatalogError(error instanceof Error ? error.message : tr("packages.discoverFailed"));
    } finally {
      if (gen === catalogLoadGen.current) setCatalogLoading(false);
    }
  }

  async function loadMoreCatalog() {
    if (!catalogHasMore || catalogLoading || catalogLoadingMoreRef.current) return;
    catalogLoadingMoreRef.current = true;
    setCatalogLoadingMore(true);
    const gen = catalogLoadGen.current;
    const from = catalog.length;
    try {
      const result = await window.pix.packages.searchCatalog(
        catalogQuery.trim() || undefined,
        CATALOG_PAGE,
        from,
      );
      if (gen !== catalogLoadGen.current) return;
      if (result.packages.length === 0) {
        // Registry has no more pages — clamp total so we stop requesting.
        setCatalogTotal(from);
        return;
      }
      setCatalog((prev) => {
        const seen = new Set(prev.map((p) => p.name));
        const next = [...prev];
        for (const item of result.packages) {
          if (seen.has(item.name)) continue;
          seen.add(item.name);
          next.push(item);
        }
        return next;
      });
      setCatalogTotal(result.total);
    } catch (error) {
      if (gen !== catalogLoadGen.current) return;
      setCatalogError(error instanceof Error ? error.message : tr("packages.discoverFailed"));
    } finally {
      if (gen === catalogLoadGen.current) {
        catalogLoadingMoreRef.current = false;
        setCatalogLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    if (tab !== "discover") return;
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "discover") return;
    const handle = window.setTimeout(() => void loadCatalog(catalogQuery), 320);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery]);

  // Infinite scroll: load next page when the list end enters the page-body viewport.
  useEffect(() => {
    if (tab !== "discover" || !catalogHasMore || catalogLoading) return;
    const sentinel = catalogEndRef.current;
    if (!sentinel) return;
    const root = sentinel.closest(".page-body");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMoreCatalog();
      },
      { root: root instanceof Element ? root : null, rootMargin: "160px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, catalogHasMore, catalogLoading, catalogLoadingMore, catalog.length, catalogQuery]);

  async function installFromCatalog(item: CatalogPackage) {
    setInstallingSource(item.source);
    setBusy(true);
    try {
      await props.onInstall(
        item.source,
        discoverScope,
        temporary ? { temporary: true } : undefined,
      );
      props.onRefresh();
    } catch {
      // modal via parent
    } finally {
      setInstallingSource(undefined);
      setBusy(false);
    }
  }

  function formatWeekly(n: number | undefined): string | undefined {
    if (n == null || !Number.isFinite(n)) return undefined;
    if (n >= 1000)
      return tr("packages.discoverWeekly", { n: `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` });
    return tr("packages.discoverWeekly", { n: String(Math.round(n)) });
  }

  return (
    <section className="page" data-testid="packages-page">
      <header className="page-header">
        <h1>{tr("packages.title")}</h1>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn-secondary"
            data-testid="packages-refresh"
            onClick={() => {
              if (tab === "discover") void loadCatalog();
              else props.onRefresh();
            }}
            disabled={props.loading || busy || catalogLoading}
          >
            {props.loading || catalogLoading ? tr("packages.loading") : tr("packages.refresh")}
          </button>
          {tab === "installed" ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                data-testid="packages-refresh-catalog"
                onClick={() => props.onRefreshCatalog()}
                disabled={props.loading || busy}
                title={tr("packages.refreshCatalogHint")}
              >
                {tr("packages.refreshCatalog")}
              </button>
              <button
                type="button"
                className="btn-secondary"
                data-testid="packages-update-all"
                onClick={() => void props.onUpdate()}
                disabled={props.loading || busy || props.packages.length === 0}
              >
                {tr("packages.updateAll")}
              </button>
            </>
          ) : null}
          <button type="button" className="btn-ghost" onClick={props.onBack}>
            {tr("packages.back")}
          </button>
        </div>
      </header>
      <div className="page-tabs" data-testid="packages-tabs">
        <button
          type="button"
          className="page-tab"
          data-active={tab === "installed" ? "true" : "false"}
          data-testid="packages-tab-installed"
          onClick={() => setTab("installed")}
        >
          {tr("packages.tab.installed")}
        </button>
        <button
          type="button"
          className="page-tab"
          data-active={tab === "discover" ? "true" : "false"}
          data-testid="packages-tab-discover"
          onClick={() => setTab("discover")}
        >
          {tr("packages.tab.discover")}
        </button>
      </div>
      <div className="page-body">
        <div className="page-body-inner">
          {tab === "discover" ? (
            <div data-testid="packages-discover">
              {/* One toolbar: search · scope · open web · trial toggle. Install only via list. */}
              <div
                className="mb-3 flex min-w-0 flex-nowrap items-center gap-2"
                data-testid="packages-discover-toolbar"
              >
                <SettingsSearchField
                  testId="packages-discover-search"
                  value={catalogQuery}
                  onChange={setCatalogQuery}
                  placeholder={tr("packages.discoverSearch")}
                  className="min-w-0 flex-1"
                />
                <SettingsSelect
                  testId="packages-discover-scope"
                  size="md"
                  className="h-9 shrink-0"
                  value={discoverScope}
                  onChange={(v) => setDiscoverScope(v as "global" | "project")}
                  disabled={busy || Boolean(installingSource)}
                  options={[
                    { value: "global", label: tr("packages.scopeGlobal") },
                    { value: "project", label: tr("packages.scopeProject") },
                  ]}
                />
                <a
                  className="btn-secondary inline-flex h-9 shrink-0 items-center whitespace-nowrap no-underline"
                  href="https://pi.dev/packages"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="packages-catalog-link"
                >
                  {tr("packages.discoverOpenWeb")}
                </a>
                <div
                  className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-[var(--border)] px-2.5"
                  data-testid="package-temporary-label"
                  title={tr("packages.temporary")}
                >
                  <span className="whitespace-nowrap text-[12px] text-[var(--muted-foreground)]">
                    {tr("packages.installTemp")}
                  </span>
                  <SettingsToggle
                    checked={temporary}
                    onChange={setTemporary}
                    disabled={props.loading || busy}
                    testId="package-temporary"
                    aria-label={tr("packages.temporary")}
                  />
                </div>
              </div>
              {catalogError ? (
                <p className="form-error" data-testid="packages-discover-error">
                  {catalogError}
                </p>
              ) : null}
              {catalogLoading && catalog.length === 0 ? (
                <p className="m-0 text-[13px] text-[var(--muted-foreground)]">
                  {tr("packages.discoverLoading")}
                </p>
              ) : catalog.length === 0 ? (
                <div className="empty-panel" data-testid="packages-discover-empty">
                  <p>{tr("packages.discoverEmpty")}</p>
                </div>
              ) : (
                <div className="item-list" data-testid="packages-discover-list">
                  {catalog.map((item) => {
                    const installed =
                      installedSources.has(item.source) || installedSources.has(item.name);
                    const installing = installingSource === item.source;
                    return (
                      <article
                        key={item.name}
                        className="item-card"
                        data-testid={`catalog-package-${item.name}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="title">{item.name}</div>
                          <div className="meta">
                            v{item.version}
                            {item.publisher ? ` · ${item.publisher}` : ""}
                            {formatWeekly(item.weeklyDownloads)
                              ? ` · ${formatWeekly(item.weeklyDownloads)}`
                              : ""}
                          </div>
                          {item.description ? (
                            <p className="m-0 mt-1.5 text-[12.5px] leading-snug text-[var(--muted-foreground)]">
                              {item.description}
                            </p>
                          ) : null}
                          <div className="mt-1 font-mono text-[11px] text-[var(--text-subtle)]">
                            {item.source}
                          </div>
                        </div>
                        <div className="badges">
                          {item.keywords
                            ?.filter((k) => k !== "pi-package")
                            .slice(0, 3)
                            .map((k) => (
                              <span key={k} className="chip">
                                {k}
                              </span>
                            ))}
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            data-testid={`catalog-install-${item.name}`}
                            disabled={installed || installing || busy || props.loading}
                            onClick={() => void installFromCatalog(item)}
                            title={
                              temporary ? tr("packages.temporary") : tr("packages.discoverInstall")
                            }
                          >
                            {installed
                              ? tr("packages.discoverInstalled")
                              : installing
                                ? tr("packages.discoverInstalling")
                                : temporary
                                  ? tr("packages.installTemp")
                                  : tr("packages.discoverInstall")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  <div
                    ref={catalogEndRef}
                    className="py-2 text-center text-[12px] text-[var(--text-subtle)]"
                    data-testid="packages-discover-scroll-end"
                  >
                    {catalogLoadingMore
                      ? tr("packages.discoverLoadingMore")
                      : catalogHasMore
                        ? null
                        : catalog.length > 0
                          ? tr("packages.discoverEnd")
                          : null}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {props.packages.length === 0 ? (
                <div className="empty-panel" data-testid="packages-empty">
                  <h2>{tr("packages.emptyTitle")}</h2>
                  <p>{tr("packages.emptyBody")}</p>
                </div>
              ) : (
                <div className="item-list" data-testid="packages-list">
                  {props.packages.map((item) => (
                    <article key={`${item.scope}:${item.source}`} className="item-card">
                      <div className="min-w-0">
                        <div className="title">{item.source}</div>
                        <div className="meta">
                          {item.installedPath ? item.installedPath : tr("packages.notResolved")}
                          {item.filtered ? ` · ${tr("packages.filtered")}` : ""}
                          {!item.enabled ? ` · ${tr("packages.disabled")}` : ""}
                        </div>
                      </div>
                      <div className="badges">
                        <span className="chip">{item.scope}</span>
                        <span className="chip">{item.kind}</span>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          data-testid={`package-enable-${item.scope}-${item.source}`}
                          disabled={props.loading || busy}
                          onClick={() =>
                            void props.onSetEnabled(item.source, item.scope, !item.enabled)
                          }
                        >
                          {item.enabled ? tr("packages.disable") : tr("packages.enable")}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          data-testid={`package-update-${item.scope}-${item.source}`}
                          disabled={props.loading || busy || item.kind === "local"}
                          onClick={() => void props.onUpdate(item.source)}
                        >
                          {tr("packages.update")}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm danger"
                          data-testid={`package-remove-${item.scope}-${item.source}`}
                          disabled={props.loading || busy}
                          onClick={() => void props.onRemove(item.source, item.scope)}
                        >
                          {tr("packages.remove")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ResourcesPage(props: {
  locale: Locale;
  resources: ResourceSummary[];
  loading: boolean;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string>) =>
    t(props.locale, key, vars);
  return (
    <section className="page" data-testid="resources-page">
      <header className="page-header">
        <h1>{tr("resources.title")}</h1>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn-secondary"
            data-testid="resources-refresh"
            onClick={props.onRefresh}
            disabled={props.loading}
          >
            {props.loading ? tr("resources.loading") : tr("resources.refresh")}
          </button>
          <button type="button" className="btn-ghost" onClick={props.onBack}>
            {tr("resources.back")}
          </button>
        </div>
      </header>
      <div className="page-body">
        <div className="page-body-inner">
          {props.resources.length === 0 ? (
            <div className="empty-panel" data-testid="resources-empty">
              <h2>{tr("resources.emptyTitle")}</h2>
              <p>{tr("resources.emptyBody")}</p>
            </div>
          ) : (
            <div className="item-list" data-testid="resources-list">
              {props.resources.map((item) => (
                <article key={`${item.kind}:${item.path}:${item.name}`} className="item-card">
                  <div className="min-w-0">
                    <div className="title">{item.name}</div>
                    <div className="meta">
                      {item.path || "—"}
                      {item.source ? ` · ${item.source}` : ""}
                      {item.kind === "context" || item.kind === "system"
                        ? tr("resources.contextHint")
                        : ""}
                    </div>
                  </div>
                  <div className="badges flex items-center gap-2">
                    <span className="chip">{item.kind}</span>
                    {item.path ? (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        data-testid={`resource-open-${item.kind}-${item.name}`}
                        onClick={() => void window.pix.workspace.openFile(item.path)}
                      >
                        {tr("resources.open")}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const root = document.querySelector("#root");
if (!root) throw new Error("Renderer root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
