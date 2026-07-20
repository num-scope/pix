import type {
  HostEvent,
  HostSnapshot,
  PackageSummary,
  ResourceSummary,
  SessionThreadSummary,
} from "@pix/contracts";
import {
  StrictMode,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { Check, Terminal, X } from "lucide-react";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { Composer, type SpeedMode } from "./components/Composer.tsx";
import { SettingsPage } from "./components/settings/SettingsPage.tsx";
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
import { installOverlayScroll } from "./lib/overlay-scroll.ts";
import { sidebarRailWidth } from "./lib/sidebar-prefs.ts";
import { filterRecentWorkspaces, firstLine, workspaceLabel } from "./lib/workspace.ts";
import {
  deriveRunState,
  historyToTimeline,
  projectEventsToTimeline,
  snapshotSummary,
  type TimelineItem,
} from "./lib/timeline.ts";
import { useShellStore } from "./store/shell-store.ts";
import "./styles.css";

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
  const sidebarOpen = useShellStore((s) => s.sidebarOpen);
  const lastFailure = useShellStore((s) => s.lastFailure);
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
  const setSidebarOpen = useShellStore((s) => s.setSidebarOpen);
  const setLastFailure = useShellStore((s) => s.setLastFailure);
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingComposerFocus = useRef(false);
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
            setStatus(error instanceof Error ? error.message : "Failed to set trust");
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
   * Selected project for composer chrome. Survives global "新建任务" which clears the
   * live session snapshot but must not drop the chosen project.
   */
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | undefined>();

  const workspacePath = snapshot?.cwd ?? selectedWorkspacePath;
  const workspace = workspaceLabel(workspacePath);

  useEffect(() => {
    if (snapshot?.cwd) setSelectedWorkspacePath(snapshot.cwd);
  }, [snapshot?.cwd]);
  const runState = deriveRunState({ hostStatus: status, running, lastFailure });
  const timeline = useMemo(
    () => [...historyToTimeline(history), ...projectEventsToTimeline(events, sentPrompts)],
    [history, events, sentPrompts],
  );
  const hasActivity = timeline.length > 0;
  const activeThread = threads.find((thread) => thread.active);
  const threadTitle =
    activeThread?.title ||
    (sentPrompts[0]
      ? firstLine(sentPrompts[0])
      : snapshot
        ? t(locale, "thread.current")
        : t(locale, "thread.new"));

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

  useEffect(
    () =>
      window.pix.host.onEvent((event) => {
        const store = useShellStore.getState();
        if (event.type === "host.ready" || event.type === "runtime.snapshot") {
          store.acceptSnapshot(event.snapshot);
        } else if (event.type === "host.restarted") {
          store.acceptSnapshot(event.snapshot);
          store.setStatus("Agent Host restarted");
        } else if (event.type === "host.crashed") {
          store.resetAfterCrash(event.message);
        } else if (event.type === "session.list") {
          store.setThreads(event.threads);
        } else if (event.type === "session.opened") {
          store.applySessionOpen(event);
        } else if (event.type === "packages.progress") {
          if (event.message) store.setStatus(event.message);
        } else if (event.type === "packages.changed") {
          store.setPackages(event.packages);
        } else if (event.type === "runtime.event") {
          if (event.runtimeId !== store.runtimeId) return;
          if (event.sequence !== store.lastSequence + 1) {
            void window.pix.host.snapshot().then(store.acceptSnapshot);
            return;
          }
          store.setLastSequence(event.sequence);
          if (event.event.type === "message.failed") {
            store.setLastFailure(event.event.message);
          }
        } else if (event.type === "extensionUi.request") {
          if (event.runtimeId !== store.runtimeId) return;
          void respondToExtensionUi(event);
        }
        store.setEvents((current) => [...current.slice(-80), event]);
      }),
    [],
  );

  useEffect(() => {
    if (!hasActivity) return;
    timelineEndRef.current?.scrollIntoView({ block: "end" });
  }, [timeline, hasActivity, running]);

  async function ensureHost(): Promise<HostSnapshot> {
    const store = useShellStore.getState();
    if (store.snapshot && store.runtimeId) return store.snapshot;
    const knownCwd =
      store.snapshot?.cwd ??
      selectedWorkspacePath ??
      (await window.pix.workspace.getCwd().catch(() => undefined));
    if (!knownCwd) {
      throw new Error("未选择工作区，请先从侧边栏打开文件夹");
    }
    setSelectedWorkspacePath(knownCwd);
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
    return value;
  }

  async function refresh() {
    try {
      acceptSnapshot(await window.pix.host.snapshot());
      await refreshThreads();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Snapshot failed");
    }
  }

  async function sendPrompt(event?: FormEvent) {
    event?.preventDefault();
    const message = prompt.trim();
    if (!message) return;
    setRunning(true);
    setLastFailure(undefined);
    setStatus("Agent running...");
    // Optimistic UI: only keep the prompt in the timeline after host accepts start.
    try {
      if (!snapshot) await ensureHost();
      setSentPrompts((current) => [...current, message]);
      acceptSnapshot(await window.pix.agent.prompt(message));
      setStatus("Agent settled");
      setPrompt("");
      await refreshThreads();
    } catch (error) {
      const textMessage = error instanceof Error ? error.message : "发送失败";
      setLastFailure(textMessage);
      setStatus(textMessage);
    } finally {
      setRunning(false);
    }
  }

  async function abort() {
    try {
      acceptSnapshot(await window.pix.agent.abort());
      setStatus("Agent aborted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Abort failed");
    } finally {
      setRunning(false);
    }
  }

  async function crash() {
    try {
      await window.pix.m0.crashHost();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Crash command failed");
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
      await ensureHost();
      setPackages(await window.pix.packages.list());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to list packages");
    } finally {
      setEcoLoading(false);
    }
  }

  async function openResources() {
    setView("resources");
    setSidebarOpen(false);
    setEcoLoading(true);
    try {
      await ensureHost();
      setResources(await window.pix.resources.list());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to list resources");
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(loc, "packages.status.installFailed"));
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(loc, "packages.status.removeFailed"));
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(loc, "packages.status.updateFailed"));
      throw error;
    } finally {
      setEcoLoading(false);
    }
  }

  async function refreshRecentWorkspaces() {
    try {
      const listed = await window.pix.workspace.listRecent();
      // Only exclude the live open project (snapshot cwd). After global 新建会话 the
      // snapshot is cleared — previous project must still appear in the sidebar group.
      const cwd = useShellStore.getState().snapshot?.cwd;
      setRecentWorkspaces(
        filterRecentWorkspaces(listed, cwd ? { current: cwd, max: 12 } : { max: 12 }),
      );
    } catch {
      setRecentWorkspaces([]);
    }
  }

  async function openWorkspacePath(cwd: string, options?: { resumeRecent?: boolean }) {
    setStatus(options?.resumeRecent ? `Resuming ${cwd}…` : `Opening workspace ${cwd}…`);
    setEvents([]);
    setSentPrompts([]);
    useShellStore.getState().setHistory([]);
    setSelectedWorkspacePath(cwd);
    const snap = await window.pix.workspace.openPath(cwd, {
      resumeRecent: options?.resumeRecent === true,
    });
    acceptSnapshot(snap);
    setStatus("Agent Host ready");
    await refreshThreads();
    await refreshRecentWorkspaces();
    if (options?.resumeRecent) {
      const listed = await window.pix.session.list();
      setThreads(listed.threads);
      const active = listed.threads.find((thread) => thread.active);
      if (active) {
        const opened = await window.pix.session.switch(active.path);
        applySessionOpen(opened);
      }
    }
  }

  async function openWorkspacePicker() {
    try {
      const picked = await window.pix.workspace.pickFolder();
      if (!picked) return;
      await openWorkspacePath(picked, { resumeRecent: false });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open workspace");
    }
  }

  async function resumeWorkspace() {
    try {
      const cwd = (await window.pix.workspace.getCwd()) ?? workspacePath;
      if (!cwd) {
        setStatus("No workspace to resume");
        return;
      }
      await openWorkspacePath(cwd, { resumeRecent: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to resume workspace");
    }
  }

  async function toggleTrust() {
    try {
      const next = !(snapshot?.projectTrusted ?? false);
      setStatus(next ? "Trusting project…" : "Untrusting project…");
      acceptSnapshot(await window.pix.trust.set(next));
      setStatus("Agent Host ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to set trust");
    }
  }

  async function changeModel(provider: string, id: string) {
    try {
      setStatus(`Switching model ${provider}/${id}…`);
      acceptSnapshot(await window.pix.models.set(provider, id));
      setStatus("Agent Host ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to set model");
    }
  }

  async function changeThinking(level: string) {
    try {
      setStatus(`Thinking level ${level}…`);
      acceptSnapshot(await window.pix.thinking.set(level));
      setStatus("Agent Host ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to set thinking level");
    }
  }

  async function openThread() {
    setView("thread");
    setSidebarOpen(false);
  }

  /**
   * Global「新建会话」(sidebar top / 对话 section):
   * Clean session with NO project association — clear project chrome and host cwd.
   * Only the project-row「新建会话」creates a session bound to a project.
   */
  async function newBlankTask() {
    setView("thread");
    setSidebarOpen(false);
    setPrompt("");
    setReviewOpen(false);
    setEvents([]);
    setSentPrompts([]);
    setThreads([]);
    setLastFailure(undefined);
    setAttachments([]);
    setModelOptions([]);
    setSelectedWorkspacePath(undefined);
    useShellStore.getState().setHistory([]);
    setRuntimeId(undefined);
    setLastSequence(0);
    useShellStore.getState().setSnapshot(undefined);

    try {
      // Detach project: stop host + clear active workspace (not just UI).
      await window.pix.workspace.clearActive();
      const cwd = await window.pix.workspace.getCwd().catch(() => undefined);
      if (cwd) {
        // Isolated/e2e still has fixture cwd after clearActive — start a clean session there.
        setSelectedWorkspacePath(cwd);
        setStatus("Creating thread...");
        const value = await window.pix.host.start({ cwd });
        acceptSnapshot(value);
        const opened = await window.pix.session.create();
        applySessionOpen(opened);
        setStatus("Agent Host ready");
        await refreshThreads();
      } else {
        // Product: truly unbound clean session UI (pick a project before send).
        setStatus(t(locale, "empty.titleNoWorkspace"));
      }
      await refreshRecentWorkspaces();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "无法开始新会话");
    }
  }

  /** Project-row only: open that project if needed, then create a new session under it. */
  async function newThreadForProject(path: string) {
    try {
      setView("thread");
      setSidebarOpen(false);
      setPrompt("");
      setReviewOpen(false);
      setAttachments([]);
      setSelectedWorkspacePath(path);
      const current = useShellStore.getState().snapshot?.cwd;
      if (!current || normalizeCwdKey(current) !== normalizeCwdKey(path)) {
        await openWorkspacePath(path, { resumeRecent: false });
      } else if (!useShellStore.getState().runtimeId) {
        await ensureHost();
      }
      setStatus("Creating thread...");
      const opened = await window.pix.session.create();
      applySessionOpen(opened);
      setStatus("Agent Host ready");
      await refreshThreads();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "无法在项目下新建会话");
    }
  }

  async function removeRecentWorkspace(path: string) {
    try {
      const listed = await window.pix.workspace.removeRecent(path);
      const cwd = useShellStore.getState().snapshot?.cwd;
      setRecentWorkspaces(
        filterRecentWorkspaces(listed, cwd ? { current: cwd, max: 12 } : { max: 12 }),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to remove project");
    }
  }

  async function revealWorkspace(path: string) {
    try {
      await window.pix.workspace.revealInFolder(path);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to reveal folder");
    }
  }

  async function forkThread(entryId?: string) {
    if (running) return;
    try {
      setStatus("Forking thread...");
      const opened = await window.pix.session.fork(entryId);
      applySessionOpen(opened);
      setStatus("Agent Host ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to fork thread");
    }
  }

  async function switchThread(sessionPath: string, projectCwd?: string) {
    if (running) return;
    try {
      const current = useShellStore.getState().snapshot?.cwd;
      if (projectCwd && current && normalizeCwdKey(projectCwd) !== normalizeCwdKey(current)) {
        setStatus(`Opening ${projectCwd}…`);
        await openWorkspacePath(projectCwd, { resumeRecent: false });
      }
      setStatus("Switching thread...");
      const opened = await window.pix.session.switch(sessionPath);
      applySessionOpen(opened);
      setStatus("Agent Host ready");
      await refreshThreads();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to switch thread");
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
      }),
    // handlers close over latest store setters; recompute lightly when mode/view changes
    [colorMode, view, running],
  );

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!useShellStore.getState().paletteOpen);
        return;
      }
      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void newBlankTask();
        return;
      }
      if (meta && event.key.toLowerCase() === "p" && !event.shiftKey) {
        event.preventDefault();
        void openPackages();
        return;
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        void openSettings();
        return;
      }
      if (meta && event.key.toLowerCase() === "j") {
        event.preventDefault();
        focusComposer();
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        toggleColorMode();
        return;
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        void forkThread();
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
      data-testid="pix-m0-app"
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

      {/* Content sits to the right of the overlay rail; full-bleed canvas shows under frosted glass. */}
      <div
        className="flex h-full min-w-0 flex-1"
        style={{
          marginLeft: railWidth,
          width: `calc(100% - ${railWidth}px)`,
          maxWidth: `calc(100% - ${railWidth}px)`,
        }}
        data-testid="shell-main"
      >
        {view === "thread" ? (
          <section className="main-column relative flex h-full min-w-0 flex-1 flex-col">
            {hasActivity ? (
              <header className="thread-header">
                <div>
                  <h2>{threadTitle}</h2>
                  <div className="subtitle">{snapshotSummary(snapshot)}</div>
                </div>
                <div className="header-controls">
                  <button
                    type="button"
                    className="btn-ghost"
                    data-testid="sidebar-menu-toggle"
                    onClick={() => toggleSidebarCollapsed()}
                  >
                    {t(locale, "composer.menu")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    data-testid="toggle-review"
                    onClick={() => setReviewOpen((open) => !open)}
                  >
                    {reviewOpen ? t(locale, "composer.hideReview") : t(locale, "composer.review")}
                  </button>
                </div>
              </header>
            ) : (
              // Keep testids available on empty state without a sparse floating header.
              <div className="sr-only">
                <button
                  type="button"
                  data-testid="sidebar-menu-toggle"
                  onClick={() => toggleSidebarCollapsed()}
                />
                <button
                  type="button"
                  data-testid="toggle-review"
                  onClick={() => setReviewOpen((o) => !o)}
                />
              </div>
            )}

            <div className="timeline-scroll">
              <div
                className={cn(
                  "mx-auto w-[min(760px,100%)] px-6",
                  hasActivity ? "pt-6 pb-36" : "empty flex min-h-full flex-col p-0",
                )}
                data-testid="timeline"
              >
                {hasActivity ? (
                  <>
                    {timeline.map((item) => (
                      <TimelineRow key={item.id} item={item} />
                    ))}
                    <div ref={timelineEndRef} />
                  </>
                ) : (
                  <div
                    className="flex min-h-full flex-1 flex-col items-center justify-center px-4 pb-36 pt-8 text-center"
                    data-testid="empty-hero"
                  >
                    <h1 className="m-0 max-w-lg text-[26px] leading-snug font-semibold tracking-[-0.03em] text-[var(--text)]">
                      {workspacePath
                        ? t(locale, "empty.title", { name: workspace.name })
                        : t(locale, "empty.titleNoWorkspace")}
                    </h1>
                    <p className="mt-3 max-w-md text-[13px] text-[var(--muted-foreground)]">
                      {workspacePath
                        ? t(locale, "empty.subtitle")
                        : t(locale, "empty.subtitleNoWorkspace")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div
              className={cn(
                // Always dock to bottom of main column (OpenCowork-style input bar).
                "composer-dock pointer-events-none absolute inset-x-0 bottom-0 z-5 bg-gradient-to-b from-transparent via-[var(--canvas)]/80 to-[var(--canvas)] px-6 pb-6 pt-10",
              )}
              data-mode={hasActivity || running ? "bottom" : "centered"}
              data-testid="composer-dock"
            >
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
                accessMode={accessMode}
                onAccessMode={applyAccessMode}
                accessVisibility={accessVisibility}
                modelOptions={modelOptions}
                modelValue={
                  snapshot?.model ? `${snapshot.model.provider}/${snapshot.model.id}` : ""
                }
                onModelChange={(provider, id) => void changeModel(provider, id)}
                thinkingLevel={snapshot?.thinkingLevel ?? "off"}
                thinkingLevels={
                  snapshot?.availableThinkingLevels?.length
                    ? snapshot.availableThinkingLevels
                    : [snapshot?.thinkingLevel ?? "off"]
                }
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
                contextTokens={snapshot?.usage?.tokens.total ?? undefined}
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
    } catch (error) {
      setFormError(error instanceof Error ? error.message : tr("packages.installFailed"));
    } finally {
      setBusy(false);
    }
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
            onClick={props.onRefresh}
            disabled={props.loading || busy}
          >
            {props.loading ? tr("packages.loading") : tr("packages.refresh")}
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
          <a
            className="btn-secondary"
            href="https://pi.dev/packages"
            target="_blank"
            rel="noreferrer"
            data-testid="packages-catalog-link"
          >
            {tr("packages.openGallery")}
          </a>
          <button type="button" className="btn-ghost" onClick={props.onBack}>
            {tr("packages.back")}
          </button>
        </div>
      </header>
      <div className="page-tabs">
        <span className="page-tab" data-active="true">
          {tr("packages.tab.installed")}
        </span>
        <span className="page-tab" data-active="false" title={tr("packages.tab.discoverHint")}>
          {tr("packages.tab.discover")}
        </span>
        <span className="page-tab" data-active="false">
          {tr("packages.tab.updates")}
        </span>
      </div>
      <div className="page-body">
        <div className="page-body-inner">
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

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "user") {
    return (
      <article className="mb-7" data-kind="user">
        <p className="m-0 text-[14.5px] leading-relaxed wrap-break-word whitespace-pre-wrap text-[var(--foreground)]">
          {item.text}
        </p>
      </article>
    );
  }
  if (item.kind === "assistant") {
    return (
      <article className="mb-7" data-kind="assistant">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/10 text-[10px] font-semibold text-violet-300">
            π
          </span>
          <span className="font-medium">pi</span>
        </div>
        <p className="m-0 text-[14.5px] leading-relaxed wrap-break-word whitespace-pre-wrap text-[var(--foreground)]/90">
          {item.text}
        </p>
      </article>
    );
  }
  if (item.kind === "tool") {
    // OpenCowork CompactToolCallHeader-style row
    return (
      <article className="mb-2.5" data-kind="tool">
        <div
          className={cn(
            "group inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
            item.isError
              ? "border-red-500/25 bg-red-500/[0.06] text-red-600"
              : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
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
    <article className="mb-4" data-kind="system">
      <p className="m-0 text-[12.5px] text-[var(--muted-foreground)]">{item.text}</p>
    </article>
  );
}

const root = document.querySelector("#root");
if (!root) throw new Error("Renderer root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
