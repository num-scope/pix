import type {
  CatalogPackage,
  HostEvent,
  HostSnapshot,
  PackageSummary,
  ResourceSummary,
  SessionThreadSummary,
} from "@pix/contracts";
import {
  StrictMode,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { ArrowDown, Check, Search, Terminal, X } from "lucide-react";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { Composer, type SpeedMode } from "./components/Composer.tsx";
import { ErrorDialog } from "./components/ErrorDialog.tsx";
import { SettingsPage } from "./components/settings/SettingsPage.tsx";
import {
  EnvPanel,
  envPanelLayoutForWidth,
  type EnvPanelLayoutMode,
} from "./components/EnvPanel.tsx";
import { MarkdownContent } from "./components/MarkdownContent.tsx";
import { PixLogo } from "./components/PixLogo.tsx";
import { ThreadHeader } from "./components/ThreadHeader.tsx";
import { buildShellCommands } from "./lib/commands.ts";
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
import { installOverlayScroll } from "./lib/overlay-scroll.ts";
import { sidebarRailWidth } from "./lib/sidebar-prefs.ts";
import { matchShortcut } from "./lib/shortcuts.ts";
import {
  filterRecentWorkspaces,
  firstLine,
  isNonProjectWorkspacePath,
  prependRecentPath,
  workspaceLabel,
} from "./lib/workspace.ts";
import {
  deriveRunState,
  historyToTimeline,
  projectEventsToTimeline,
  type TimelineItem,
} from "./lib/timeline.ts";
import { useShellStore } from "./store/shell-store.ts";
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
  if (prefs.onlyWhenUnfocused && document.hasFocus()) return;
  const locale = useShellStore.getState().locale;
  const title =
    kind === "complete"
      ? t(locale, "notify.completeTitle")
      : kind === "error"
        ? t(locale, "notify.errorTitle")
        : t(locale, "notify.crashTitle");
  void window.pix.notifications.show({
    title,
    ...(body?.trim() ? { body: body.trim() } : {}),
    silent: !prefs.sound,
  });
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
  const history = useShellStore((s) => s.history);
  const threads = useShellStore((s) => s.threads);
  const prompt = useShellStore((s) => s.prompt);
  const sentPrompts = useShellStore((s) => s.sentPrompts);
  const running = useShellStore((s) => s.running);
  const reviewOpen = useShellStore((s) => s.reviewOpen);
  const envPanelOpen = useShellStore((s) => s.envPanelOpen);
  const sidebarOpen = useShellStore((s) => s.sidebarOpen);
  const lastFailure = useShellStore((s) => s.lastFailure);
  const appError = useShellStore((s) => s.appError);
  const view = useShellStore((s) => s.view);
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
  const setReviewOpen = useShellStore((s) => s.setReviewOpen);
  const setEnvPanelOpen = useShellStore((s) => s.setEnvPanelOpen);
  /** Whether env panel can be shown at current thread-column width. */
  const [envPanelFits, setEnvPanelFits] = useState(true);
  /** float = overlay without squeeze; dock = flex squeeze. */
  const [envPanelLayout, setEnvPanelLayout] = useState<Exclude<EnvPanelLayoutMode, "none">>(
    "dock",
  );
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
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
    pendingPureConversation ||
    Boolean(snapshot?.cwd && isNonProjectWorkspacePath(snapshot.cwd));
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
    const items = [
      ...historyToTimeline(history),
      ...projectEventsToTimeline(events, sentPrompts),
    ];
    // Prefix ids with session so React does not reuse rows across switches.
    if (!sessionKey) return items;
    return items.map((item) => ({ ...item, id: `${sessionKey}:${item.id}` }));
  }, [history, events, sentPrompts, sessionKey]);
  const hasActivity = timeline.length > 0;
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
  const displayThinkingLevels =
    snapshot?.availableThinkingLevels?.length
      ? snapshot.availableThinkingLevels
      : lastComposerChromeRef.current.availableThinkingLevels?.length
        ? lastComposerChromeRef.current.availableThinkingLevels
        : [displayThinkingLevel];

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

  useEffect(() => {
    applyDocumentTheme(colorMode);
  }, [colorMode]);

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
  }, [workspacePath, recentWorkspaces]);

  // Cold start: recent projects + pi packages/resources regardless of open project.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshRecentWorkspaces();
      if (cancelled) return;
      await refreshPiStatus({ ensure: true });
    })();
    return () => {
      cancelled = true;
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
          if (event.runtimeId !== store.runtimeId) return;
          if (event.sequence !== store.lastSequence + 1) {
            void window.pix.host.snapshot().then(store.acceptSnapshot);
            return;
          }
          store.setLastSequence(event.sequence);
          if (event.event.type === "message.failed") {
            store.setLastFailure(event.event.message);
            maybeNotify("error", event.event.message);
          } else if (event.event.type === "agent.settled") {
            maybeNotify("complete");
          }
        } else if (event.type === "extensionUi.request") {
          if (event.runtimeId !== store.runtimeId) return;
          void respondToExtensionUi(event);
        }
        store.setEvents((current) => [...current.slice(-80), event]);
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
  }

  function scrollTimelineToBottom(behavior: ScrollBehavior = "smooth") {
    pinTimelineScrollport(behavior);
    setShowScrollToBottom(false);
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
    setShowScrollToBottom(false);
  }

  function requestContentReveal() {
    setRevealToken((n) => n + 1);
  }

  function finishBlankHold() {
    holdBlankRef.current = false;
    pendingScrollBottomRef.current = false;
    setShowScrollToBottom(false);
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
      setShowScrollToBottom(false);
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
            setShowScrollToBottom(false);
          });
        });
      });
    };

    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [sessionKey, history.length, timeline.length, composerDockHeight, revealToken]);

  // Track composer height only so scroll-to-bottom / settle re-run when the dock resizes
  // (composer is in-flow now — content area bottom is the dock top, not the window edge).
  useEffect(() => {
    const dock = composerDockRef.current;
    if (!dock || typeof ResizeObserver === "undefined") return;
    const apply = () => setComposerDockHeight(Math.ceil(dock.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(dock);
    return () => ro.disconnect();
  }, [hasActivity, showScrollToBottom, showContextUsage, accessVisibility, timelineReady]);

  /** Pixels from scrollport bottom before we consider "not at bottom" (show jump chip). */
  const SCROLL_BOTTOM_GAP_PX = 64;

  useEffect(() => {
    if (!hasActivity || !timelineReady) return;
    const el = timelineScrollRef.current;
    if (!el) return;
    // Streaming: auto-stick only while already near the scrollport bottom.
    if (pendingScrollBottomRef.current || holdBlankRef.current) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < SCROLL_BOTTOM_GAP_PX) {
      pinTimelineScrollport("auto");
      setShowScrollToBottom(false);
    }
  }, [timeline, hasActivity, running, composerDockHeight, timelineReady]);

  useEffect(() => {
    if (!hasActivity || !timelineReady) {
      setShowScrollToBottom(false);
      return;
    }
    const el = timelineScrollRef.current;
    if (!el) return;

    const update = () => {
      // Always attach listeners — pending is a ref and must not skip subscription
      // (otherwise after switch settle we never re-bind scroll and the chip never appears).
      if (pendingScrollBottomRef.current || holdBlankRef.current) {
        setShowScrollToBottom(false);
        return;
      }
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      const overflows = el.scrollHeight > el.clientHeight + 4;
      setShowScrollToBottom(overflows && gap > SCROLL_BOTTOM_GAP_PX);
    };

    // Defer so layout (absolute scrollport height) is settled after paint.
    const measure = () => requestAnimationFrame(update);
    measure();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", measure, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : undefined;
    ro?.observe(el);
    // After session open, pending clears async — re-measure a few times.
    const t1 = window.setTimeout(update, 120);
    const t2 = window.setTimeout(update, 400);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", measure);
      ro?.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [hasActivity, timeline.length, composerDockHeight, timelineReady, revealToken]);

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
      const models = await window.pix.models.list();
      setModelOptions(models.map((m) => ({ provider: m.provider, id: m.id, name: m.name })));
    } catch {
      setModelOptions([]);
    }
    await refreshThreads();
    await refreshRecentWorkspaces();
    return value;
  }

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

  async function sendPrompt(event?: FormEvent) {
    event?.preventDefault();
    const message = prompt.trim();
    if (!message) return;
    setRunning(true);
    setLastFailure(undefined);
    setStatus("Agent running...");
    // Clear the box immediately — do not wait for the full agent turn.
    setPrompt("");
    setSentPrompts((current) => [...current, message]);
    // If the user switches sessions mid-generation, ignore late host results.
    const sessionAtStart =
      useShellStore.getState().snapshot?.sessionFile ??
      useShellStore.getState().snapshot?.sessionId ??
      "";
    const stillSameSession = () => {
      const s = useShellStore.getState().snapshot;
      const key = s?.sessionFile ?? s?.sessionId ?? "";
      return key === sessionAtStart;
    };
    try {
      if (!useShellStore.getState().snapshot) await ensureHost();
      if (!stillSameSession()) return;
      const next = await window.pix.agent.prompt(message);
      if (!stillSameSession()) return;
      acceptSnapshot(next);
      setStatus("Agent settled");
      await refreshThreads();
    } catch (error) {
      // Switched away / aborted for navigation — do not restore draft into the new session.
      if (!stillSameSession()) return;
      // Host/workspace/IPC failures → modal + restore draft for retry.
      setPrompt(message);
      setSentPrompts((current) => {
        const idx = current.lastIndexOf(message);
        if (idx < 0) return current;
        return [...current.slice(0, idx), ...current.slice(idx + 1)];
      });
      reportAppError(error, "发送失败");
    } finally {
      if (stillSameSession()) setRunning(false);
    }
  }

  async function abort() {
    try {
      acceptSnapshot(await window.pix.agent.abort());
      setStatus("Agent aborted");
    } catch (error) {
      reportAppError(error, "Abort failed");
    } finally {
      setRunning(false);
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

  async function installPackage(source: string, scope: "global" | "project") {
    const loc = useShellStore.getState().locale;
    setEcoLoading(true);
    setStatus(t(loc, "packages.status.installing", { scope }));
    try {
      await ensureHost();
      const next = await window.pix.packages.install(source, scope);
      setPackages(next);
      setStatus(t(loc, "packages.status.installed"));
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshPiStatus({ ensure: false });
    } catch (error) {
      reportAppError(error, t(loc, "packages.status.installFailed"));
      throw error;
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

  /**
   * Global「新建会话」(sidebar top + 对话 section header):
   * Pure conversation — NOT bound to any project.
   * Host cwd = Documents/Pix/conversations (hidden from 项目 rail / recent).
   * Only the project-row ✏️ creates a session under that project.
   *
   * UI rules (no intermediate flash):
   * - Keep last model/thinking chrome until the new snapshot arrives
   * - Keep previous project on the rail via recentWorkspaces (never a missing frame)
   * - Empty hero shows「开始对话」immediately, never「打开工作区以开始」
   */
  async function newBlankTask() {
    // Leaving a generating session — abort first so the host is free for a new thread.
    if (useShellStore.getState().running) {
      try {
        acceptSnapshot(await window.pix.agent.abort());
      } catch {
        // ignore
      } finally {
        setRunning(false);
      }
    }
    setView("thread");
    setSidebarOpen(false);
    setPrompt("");
    setReviewOpen(false);
    setEvents([]);
    setSentPrompts([]);
    setLastFailure(undefined);
    setAttachments([]);
    useShellStore.getState().setHistory([]);

    const prevSnap = useShellStore.getState().snapshot;
    const prevProject =
      asProjectPath(selectedWorkspacePath) ?? asProjectPath(prevSnap?.cwd);
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

    try {
      await window.pix.workspace.clearActive();
      selectWorkspacePath(undefined);

      // After clearActive: e2e may keep PIX_WORKSPACE fixture; product returns undefined.
      const afterClear = await window.pix.workspace.getCwd().catch(() => undefined);
      // Product: Documents/Pix/conversations — never listed under 项目.
      const convCwd = afterClear ?? (await window.pix.workspace.ensureConversation());

      const live = useShellStore.getState();
      const alreadyOnConvHost =
        Boolean(live.runtimeId && live.snapshot?.cwd) &&
        isNonProjectWorkspacePath(live.snapshot!.cwd) &&
        normalizeCwdKey(live.snapshot!.cwd) === normalizeCwdKey(convCwd);

      if (!alreadyOnConvHost) {
        setStatus("Creating conversation...");
        // Drop runtime identity so events from the dying project host are ignored.
        setRuntimeId(undefined);
        setLastSequence(0);
        const value = await window.pix.host.start({ cwd: convCwd });
        acceptSnapshot(value);
        try {
          const models = await window.pix.models.list();
          setModelOptions(models.map((m) => ({ provider: m.provider, id: m.id, name: m.name })));
        } catch {
          // keep previous modelOptions
        }
      }

      const opened = await window.pix.session.create();
      markSessionOpenForBottomScroll();
      applySessionOpen(opened);
      requestContentReveal();
      // Pure conversation — never select conversation/scratch as a project.
      selectWorkspacePath(undefined);
      pendingPureConversationRef.current = false;
      setPendingPureConversation(false);
      setStatus("Agent Host ready");
      await refreshThreads();
      await refreshRecentWorkspaces();
    } catch (error) {
      pendingPureConversationRef.current = false;
      setPendingPureConversation(false);
      reportAppError(error, "无法开始新会话");
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    }
  }

  /** Project-row only: open that project if needed, then create a new session under it. */
  async function newThreadForProject(path: string) {
    if (useShellStore.getState().running) {
      try {
        acceptSnapshot(await window.pix.agent.abort());
      } catch {
        // ignore
      } finally {
        setRunning(false);
      }
    }
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
      selectWorkspacePath(path);
      const current = useShellStore.getState().snapshot?.cwd;
      if (!current || normalizeCwdKey(current) !== normalizeCwdKey(path)) {
        await openWorkspacePath(path, { resumeRecent: false });
      } else if (!useShellStore.getState().runtimeId) {
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
    try {
      if (!useShellStore.getState().runtimeId) await ensureHost();
      setStatus("Forking thread...");
      const opened = await window.pix.session.fork(entryId);
      markSessionOpenForBottomScroll();
      applySessionOpen(opened);
      requestContentReveal();
      setStatus("Agent Host ready");
    } catch (error) {
      reportAppError(error, "Failed to fork thread");
      setTimelineReady(true);
      pendingScrollBottomRef.current = false;
    }
  }

  async function switchThread(sessionPath: string, projectCwd?: string) {
    // Allow switching while AI is generating — abort the in-flight turn first.
    if (useShellStore.getState().running) {
      try {
        acceptSnapshot(await window.pix.agent.abort());
      } catch {
        // Host may already be settling; still proceed with the switch.
      } finally {
        setRunning(false);
      }
    }
    switchingSessionRef.current = true;
    // Blank immediately: no empty-hero, no project protrusion, no stale messages.
    markSessionOpenForBottomScroll();
    setEvents([]);
    setSentPrompts([]);
    // Drop prior history so empty chrome cannot paint even if ready flips early.
    useShellStore.getState().setHistory([]);
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
      if (!running) void sendPrompt();
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
      buildShellCommands({
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
      }),
    // handlers close over latest store setters; recompute lightly when mode/view changes
    [colorMode, view, running, envPanelFits, workspacePath, hasActivity],
  );

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
        // Relative shell: sidebar is an overlay so frosted translucency can sample canvas/content.
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
            : (snapshot?.resources
                ? snapshot.resources.extensions +
                  snapshot.resources.skills +
                  snapshot.resources.prompts +
                  snapshot.resources.themes +
                  snapshot.resources.contextFiles
                : 0)
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
        True glass stack:
        - .app-shell-ambient is full-bleed (behind the frosted rail for blur/vibrancy)
        - .shell-content is opaque and inset by the rail (no solid paint under the glass)
      */}
      <div className="app-shell-ambient" aria-hidden />
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
                Column layout: scrollport ends at the composer top (not the window bottom).
                Composer is in normal flow below the content area.
              */}
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="relative min-h-0 min-w-0 flex-1">
                  <div
                    className={cn(
                      "timeline-scroll absolute inset-0",
                      // Hold fully blank while switching — empty-hero must not flash either.
                      !timelineReady && "invisible pointer-events-none",
                    )}
                    ref={timelineScrollRef}
                    aria-busy={!timelineReady}
                    data-ready={timelineReady ? "true" : "false"}
                  >
                    <div
                      className={cn(
                        "mx-auto w-[min(760px,100%)] px-6",
                        hasActivity ? "pt-6 pb-4" : "empty flex min-h-full flex-col p-0",
                      )}
                      data-testid="timeline"
                    >
                      {hasActivity ? (
                        <>
                          {timeline.map((item) => (
                            <TimelineRow key={item.id} item={item} />
                          ))}
                          <div ref={timelineEndRef} className="h-px w-full shrink-0" aria-hidden />
                        </>
                      ) : timelineReady ? (
                        <div
                          className="flex min-h-full flex-1 flex-col items-center justify-center px-4 text-center"
                          data-testid="empty-hero"
                        >
                          <PixLogo
                            className="mb-5 size-12"
                            title={t(locale, "app.name")}
                          />
                          <h1 className="m-0 max-w-lg text-[26px] leading-snug font-semibold tracking-[-0.03em] text-[var(--text)]">
                            {workspacePath
                              ? t(locale, "empty.title", { name: workspace.name })
                              : isPureConversation || snapshot || pendingPureConversation
                                ? t(locale, "empty.titleConversation")
                                : t(locale, "empty.titleNoWorkspace")}
                          </h1>
                          {/* Workspace empty state has title only — no subtitle under「构建什么？」. */}
                          {!workspacePath ? (
                            <p className="mt-3 max-w-md text-[13px] text-[var(--muted-foreground)]">
                              {isPureConversation || snapshot || pendingPureConversation
                                ? t(locale, "empty.subtitleConversation")
                                : t(locale, "empty.subtitleNoWorkspace")}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {/* Soft fade at the content area bottom edge (just above composer). */}
                  {hasActivity && timelineReady ? (
                    <div
                      className="composer-dock-fade pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-10"
                      aria-hidden
                    />
                  ) : null}
                </div>

                <div
                  ref={composerDockRef}
                  className="composer-dock pointer-events-none relative z-[2] shrink-0 bg-[var(--canvas)] px-6 pt-1 pb-6"
                  data-mode="flow"
                  data-testid="composer-dock"
                >
                  {/*
                    Jump chip: absolutely overlaid on the horizontal center of the composer,
                    just above it. Must not participate in layout — otherwise showing it
                    grows the dock and shifts the content fade range.
                  */}
                  {showScrollToBottom && timelineReady && hasActivity ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex -translate-y-[calc(100%+20px)] justify-center"
                      data-testid="scroll-to-bottom-wrap"
                    >
                      <button
                        type="button"
                        data-testid="scroll-to-bottom"
                        title={t(locale, "thread.scrollToBottom")}
                        aria-label={t(locale, "thread.scrollToBottom")}
                        className={cn(
                          // Match send button: h-7 w-7 circle; ArrowDown is inverse of send's ArrowUp.
                          "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full",
                          "border border-[var(--border)] bg-[var(--popover)] text-[var(--foreground)]",
                          "shadow-[0_4px_16px_rgb(0_0_0/0.28)] transition-colors",
                          "hover:bg-[var(--hover-fill)]",
                        )}
                        onClick={() => scrollTimelineToBottom("smooth")}
                      >
                        <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.25} />
                      </button>
                    </div>
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
                    onOpenProject={(path) => void openWorkspacePath(path, { resumeRecent: true })}
                    onAddProject={() => void openWorkspacePicker()}
                    // Project protrusion only when empty chrome is settled (never mid-switch).
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
                    onAttachFiles={(files) => {
                      if (!files?.length) return;
                      setAttachments((current) => {
                        const next = [...current];
                        for (const file of Array.from(files)) {
                          if (!next.includes(file.name)) next.push(file.name);
                        }
                        return next.slice(0, 12);
                      });
                    }}
                    onRemoveAttachment={(name) =>
                      setAttachments((current) => current.filter((item) => item !== name))
                    }
                  />
                </div>
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
            onInstall={(source, scope) => installPackage(source, scope)}
            onRemove={(source, scope) => removePackage(source, scope)}
            onUpdate={(source) => updatePackages(source)}
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
        commands={commands}
        onClose={() => setPaletteOpen(false)}
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
  onInstall: (source: string, scope: "global" | "project") => Promise<void>;
  onRemove: (source: string, scope: "global" | "project") => Promise<void>;
  onUpdate: (source?: string) => Promise<void>;
}) {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string>) =>
    t(props.locale, key, vars);
  const [source, setSource] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
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

  async function submitInstall(event: FormEvent) {
    event.preventDefault();
    const value = source.trim();
    if (!value) {
      setFormError(tr("packages.sourceRequired"));
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      await props.onInstall(value, scope);
      setSource("");
    } catch {
      // Parent install path already surfaces a modal via reportAppError.
    } finally {
      setBusy(false);
    }
  }

  async function installFromCatalog(item: CatalogPackage) {
    setInstallingSource(item.source);
    try {
      await props.onInstall(item.source, discoverScope);
    } catch {
      // modal via parent
    } finally {
      setInstallingSource(undefined);
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
            <button
              type="button"
              className="btn-secondary"
              data-testid="packages-update-all"
              onClick={() => void props.onUpdate()}
              disabled={props.loading || busy || props.packages.length === 0}
            >
              {tr("packages.updateAll")}
            </button>
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
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label className="settings-rail-search min-w-0 flex-1 !rounded-[12px]">
                  <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
                  <input
                    data-testid="packages-discover-search"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder={tr("packages.discoverSearch")}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-subtle)]"
                  />
                </label>
                <select
                  className="settings-select h-8 max-w-[9rem]"
                  data-testid="packages-discover-scope"
                  value={discoverScope}
                  onChange={(e) => setDiscoverScope(e.target.value as "global" | "project")}
                  disabled={busy || Boolean(installingSource)}
                >
                  <option value="global">{tr("packages.scopeGlobal")}</option>
                  <option value="project">{tr("packages.scopeProject")}</option>
                </select>
                <a
                  className="btn-secondary inline-flex items-center no-underline"
                  href="https://pi.dev/packages"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="packages-catalog-link"
                >
                  {tr("packages.discoverOpenWeb")}
                </a>
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
                          >
                            {installed
                              ? tr("packages.discoverInstalled")
                              : installing
                                ? tr("packages.discoverInstalling")
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
              <form
                className="install-form"
                data-testid="package-install-form"
                onSubmit={(e) => void submitInstall(e)}
              >
                <label className="install-label">
                  {tr("packages.source")}
                  <input
                    data-testid="package-source-input"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder={tr("packages.sourcePlaceholder")}
                    disabled={props.loading || busy}
                  />
                </label>
                <label className="install-label">
                  {tr("packages.scope")}
                  <select
                    data-testid="package-scope-select"
                    value={scope}
                    onChange={(event) => setScope(event.target.value as "global" | "project")}
                    disabled={props.loading || busy}
                  >
                    <option value="global">{tr("packages.scopeGlobal")}</option>
                    <option value="project">{tr("packages.scopeProject")}</option>
                  </select>
                </label>
                <div className="install-actions">
                  <button
                    type="submit"
                    className="btn-primary"
                    data-testid="package-install-button"
                    disabled={props.loading || busy || !source.trim()}
                  >
                    {busy ? tr("packages.working") : tr("packages.install")}
                  </button>
                </div>
              </form>
              {formError ? (
                <p className="form-error" data-testid="package-form-error">
                  {formError}
                </p>
              ) : null}
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
                        </div>
                      </div>
                      <div className="badges">
                        <span className="chip">{item.scope}</span>
                        <span className="chip">{item.kind}</span>
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
                    </div>
                  </div>
                  <div className="badges">
                    <span className="chip">{item.kind}</span>
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

const TimelineRow = memo(function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "user") {
    return (
      <article className="mb-7 mt-1 flex justify-end" data-kind="user">
        {/*
          Theme-aligned bubble: dark→dark surface + light text, light→light surface + dark text.
          More margin from surrounding messages; tighter radius than assistant chrome.
        */}
        <div
          className={cn(
            "max-w-[min(72%,26rem)] px-3 py-1.5",
            "bg-[var(--user-bubble)] text-[var(--user-bubble-fg)]",
          )}
          style={{ borderRadius: "var(--radius-field)" }}
        >
          <p className="m-0 text-[13px] leading-snug wrap-break-word whitespace-pre-wrap">
            {item.text}
          </p>
        </div>
      </article>
    );
  }
  if (item.kind === "assistant") {
    return (
      <article className="mb-6 w-full" data-kind="assistant">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/10 text-[10px] font-semibold text-violet-300">
            π
          </span>
          <span className="font-medium">pi</span>
        </div>
        <MarkdownContent className="w-full text-[14px] leading-relaxed text-[var(--foreground)]">
          {item.text}
        </MarkdownContent>
      </article>
    );
  }
  if (item.kind === "tool") {
    return (
      <article className="mb-2.5 w-full" data-kind="tool">
        <div
          className={cn(
            "group inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
            item.isError
              ? "border-red-500/25 bg-red-500/[0.06] text-red-600"
              : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)]",
          )}
        >
          <span
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-transparent",
              item.isError
                ? "border-red-500/35 text-red-600"
                : "border-emerald-500/40 text-emerald-600",
            )}
            aria-hidden
          >
            {item.isError ? <X className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
          </span>
          <Terminal className="h-3 w-3 shrink-0 opacity-60" strokeWidth={1.75} />
          <span className="font-medium text-[var(--foreground)]">{item.toolName}</span>
          <span className="min-w-0 truncate opacity-70">{item.detail}</span>
        </div>
      </article>
    );
  }
  return (
    <article className="mb-4 w-full" data-kind="system">
      <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">{item.text}</p>
    </article>
  );
});

const root = document.querySelector("#root");
if (!root) throw new Error("Renderer root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
