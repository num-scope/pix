/**
 * Short-lived UI projection store.
 * Host snapshots/events and pi JSONL remain the authority — this store must not
 * persist agent config, session trees, or secrets. Desktop prefs (locale, sidebar
 * chrome) may use localStorage only.
 */
import type {
  HostEvent,
  HostSnapshot,
  PackageSummary,
  QueuedMessages,
  ResourceSummary,
  RuntimeEvent,
  SessionHistoryMessage,
  SessionThreadSummary,
} from "@pix/contracts";
import { create } from "zustand";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../lib/i18n.ts";
import { SHELL_SIDEBAR } from "../lib/layout.ts";
import { SIDEBAR_DEFAULT_TRANSLUCENT, clampSidebarWidth } from "../lib/sidebar-prefs.ts";
import { COMPLETED_MARKER_MS, isBusyRunState, type SessionMarker } from "../lib/session-markers.ts";
import type { ThreadRunState } from "../lib/timeline.ts";
import {
  applyRuntimeEventToLiveStream,
  emptyLiveStream,
  resetLiveStream,
  type LiveStreamState,
} from "../lib/live-stream.ts";
import {
  isThemePreference,
  nextThemePreference,
  resolveColorMode,
  systemPrefersDark,
  type ResolvedColorMode,
  type ThemePreference,
} from "../lib/theme.ts";

/** Timers that clear the completed checkmark back to idle. */
const completedMarkerTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearCompletedTimer(key: string): void {
  const timer = completedMarkerTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    completedMarkerTimers.delete(key);
  }
}

function scheduleCompletedClear(key: string, apply: () => void): void {
  clearCompletedTimer(key);
  completedMarkerTimers.set(
    key,
    setTimeout(() => {
      completedMarkerTimers.delete(key);
      apply();
    }, COMPLETED_MARKER_MS),
  );
}

export type ShellView = "thread" | "packages" | "resources" | "settings";
export type ColorMode = ResolvedColorMode;
export type { ThemePreference, ResolvedColorMode };
/** Implemented settings sections only (no stub / coming-soon nav). */
export type SettingsSection =
  | "general"
  | "appearance"
  | "environment"
  | "worktree"
  | "behavior"
  | "git"
  | "usage"
  | "notifications"
  | "shortcuts"
  | "providers"
  | "models"
  | "piSettings"
  | "archived";

export interface ShellState {
  status: string;
  snapshot: HostSnapshot | undefined;
  events: HostEvent[];
  /**
   * Append-only live timeline for content after `history` (current session).
   * Streamed text only grows; cleared on session switch.
   */
  liveStream: LiveStreamState;
  history: SessionHistoryMessage[];
  threads: SessionThreadSummary[];
  prompt: string;
  sentPrompts: string[];
  queuedMessages: QueuedMessages;
  /** Foreground session is generating (composer stop button). */
  running: boolean;
  /**
   * Per-session run markers for the sidebar (ui-spec §5.2 glyphs).
   * Keys are sessionFile or sessionId (normalized).
   */
  sessionMarkers: Record<string, SessionMarker>;
  /**
   * Sessions with an in-flight agent turn (including background/parked hosts).
   * Derived-compatible with markers; kept for callers that only need busy flags.
   */
  runningSessions: Record<string, true>;
  /** runtimeId → session key, so background settle events can clear the right row. */
  runningRuntimeIds: Record<string, string>;
  reviewOpen: boolean;
  /** Session environment panel (right rail). */
  envPanelOpen: boolean;
  /** Mobile overlay open (narrow layout). */
  sidebarOpen: boolean;
  /** Desktop collapse to icon rail. */
  sidebarCollapsed: boolean;
  sidebarWidthPx: number;
  sidebarTranslucent: boolean;
  locale: Locale;
  settingsSection: SettingsSection;
  lastFailure: string | undefined;
  /** App-level error modal (not agent timeline errors). */
  appError: string | undefined;
  view: ShellView;
  packages: PackageSummary[];
  resources: ResourceSummary[];
  ecoLoading: boolean;
  themePreference: ThemePreference;
  resolvedColorMode: ResolvedColorMode;
  /** Resolved appearance applied to data-theme (alias of resolvedColorMode). */
  colorMode: ResolvedColorMode;
  paletteOpen: boolean;
  runtimeId: string | undefined;
  lastSequence: number;

  setStatus: (status: string) => void;
  setSnapshot: (snapshot: HostSnapshot | undefined) => void;
  setEvents: (events: HostEvent[] | ((current: HostEvent[]) => HostEvent[])) => void;
  /** Apply one runtime event to the append-only live stream log. */
  applyLiveStreamEvent: (
    event: RuntimeEvent,
    prompts: string[],
    options?: { sequence?: number },
  ) => void;
  /** Drop all stream state (session switch). */
  clearLiveStream: () => void;
  setHistory: (history: SessionHistoryMessage[]) => void;
  setThreads: (threads: SessionThreadSummary[]) => void;
  setPrompt: (prompt: string) => void;
  setSentPrompts: (prompts: string[] | ((current: string[]) => string[])) => void;
  setQueuedMessages: (messages: QueuedMessages) => void;
  setRunning: (running: boolean) => void;
  /** Set sidebar marker + busy flag for a session (running / waiting / failed / …). */
  setSessionMarker: (
    sessionKey: string,
    state: ThreadRunState,
    options?: { reason?: string; runtimeId?: string },
  ) => void;
  /** Mark/unmark a session as generating (sidebar marker + foreground running). */
  setSessionRunning: (sessionKey: string, running: boolean, runtimeId?: string) => void;
  /** Settle a session by runtime id (completed flash, failed, aborted, …). */
  settleSessionByRuntime: (
    runtimeId: string,
    state: Extract<ThreadRunState, "completed" | "failed" | "aborted" | "crashed" | "idle">,
    reason?: string,
  ) => void;
  clearSessionRunningByRuntime: (runtimeId: string) => void;
  isSessionRunning: (sessionKey: string | undefined) => boolean;
  /** After switch/open: composer `running` follows the newly focused session only. */
  syncForegroundRunning: () => void;
  setReviewOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  setEnvPanelOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  setSidebarOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarWidthPx: (px: number) => void;
  setSidebarTranslucent: (value: boolean) => void;
  setLocale: (locale: Locale) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setLastFailure: (failure: string | undefined) => void;
  showAppError: (message: string) => void;
  clearAppError: () => void;
  setView: (view: ShellView) => void;
  setPackages: (packages: PackageSummary[]) => void;
  setResources: (resources: ResourceSummary[]) => void;
  setEcoLoading: (loading: boolean) => void;
  setThemePreference: (preference: ThemePreference) => void;
  /** @deprecated use setThemePreference */
  setColorMode: (mode: ThemePreference) => void;
  /** Cycles system → light → dark. */
  toggleColorMode: () => void;
  /** Re-read OS preference when themePreference is system. */
  syncSystemTheme: () => void;
  setPaletteOpen: (open: boolean) => void;
  setRuntimeId: (id: string | undefined) => void;
  setLastSequence: (sequence: number) => void;
  acceptSnapshot: (snapshot: HostSnapshot) => void;
  applySessionOpen: (input: {
    snapshot: HostSnapshot;
    threads: SessionThreadSummary[];
    history: SessionHistoryMessage[];
  }) => void;
  resetAfterStop: () => void;
  resetAfterCrash: (message: string) => void;
}

type RuntimeHostEvent = Extract<HostEvent, { type: "runtime.event" }>;

export type RuntimeEventDelivery = "accept" | "duplicate" | "gap" | "stale-runtime";

/** Normalize session file / id for running-session maps. */
export function sessionRunKey(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function sessionKeyFromSnapshot(
  snapshot: Pick<HostSnapshot, "sessionFile" | "sessionId"> | undefined,
): string {
  if (!snapshot) return "";
  return sessionRunKey(snapshot.sessionFile?.trim() || snapshot.sessionId?.trim() || "");
}

/**
 * Command snapshots can overtake streamed events across Electron IPC channels.
 * Events covered by that snapshot are still valid unless they were already recorded.
 */
export function classifyRuntimeEventDelivery(
  state: Pick<ShellState, "runtimeId" | "lastSequence" | "events">,
  event: RuntimeHostEvent,
): RuntimeEventDelivery {
  if (event.runtimeId !== state.runtimeId) return "stale-runtime";
  const duplicate = state.events.some(
    (item) =>
      item.type === "runtime.event" &&
      item.runtimeId === event.runtimeId &&
      item.sequence === event.sequence,
  );
  if (duplicate) return "duplicate";
  if (event.sequence > state.lastSequence + 1) return "gap";
  return "accept";
}

function loadPref<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = parse(raw);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

function loadLocale(): Locale {
  return loadPref("pix.locale", (raw) => (isLocale(raw) ? raw : undefined), DEFAULT_LOCALE);
}

function loadThemePreference(): ThemePreference {
  return loadPref("pix.colorMode", (raw) => (isThemePreference(raw) ? raw : undefined), "system");
}

function themeState(preference: ThemePreference): {
  themePreference: ThemePreference;
  resolvedColorMode: ResolvedColorMode;
  colorMode: ResolvedColorMode;
} {
  const resolvedColorMode = resolveColorMode(preference, systemPrefersDark());
  return {
    themePreference: preference,
    resolvedColorMode,
    colorMode: resolvedColorMode,
  };
}

function loadSidebarCollapsed(): boolean {
  return loadPref(
    "pix.sidebarCollapsed",
    (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
    false,
  );
}

function loadSidebarWidth(): number {
  return loadPref(
    "pix.sidebarWidth",
    (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) ? clampSidebarWidth(n) : undefined;
    },
    SHELL_SIDEBAR.defaultPx,
  );
}

function loadSidebarTranslucent(): boolean {
  return loadPref(
    "pix.sidebarTranslucent",
    (raw) => (raw === "0" ? false : raw === "1" ? true : undefined),
    SIDEBAR_DEFAULT_TRANSLUCENT,
  );
}

export const useShellStore = create<ShellState>((set, get) => ({
  status: "Agent Host is stopped",
  snapshot: undefined,
  events: [],
  liveStream: emptyLiveStream(),
  history: [],
  threads: [],
  prompt: "",
  sentPrompts: [],
  queuedMessages: { steering: [], followUp: [] },
  running: false,
  sessionMarkers: {},
  runningSessions: {},
  runningRuntimeIds: {},
  reviewOpen: false,
  envPanelOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: loadSidebarCollapsed(),
  sidebarWidthPx: loadSidebarWidth(),
  sidebarTranslucent: loadSidebarTranslucent(),
  locale: loadLocale(),
  settingsSection: "general",
  lastFailure: undefined,
  appError: undefined,
  view: "thread",
  packages: [],
  resources: [],
  ecoLoading: false,
  ...themeState(loadThemePreference()),
  paletteOpen: false,
  runtimeId: undefined,
  lastSequence: 0,

  setStatus: (status) => set({ status }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setEvents: (events) =>
    set((state) => ({
      events: typeof events === "function" ? events(state.events) : events,
    })),
  applyLiveStreamEvent: (event, prompts, options) =>
    set((state) => ({
      liveStream: applyRuntimeEventToLiveStream(state.liveStream, event, prompts, options),
    })),
  clearLiveStream: () => set({ liveStream: resetLiveStream() }),
  setHistory: (history) => set({ history }),
  setThreads: (threads) => set({ threads }),
  setPrompt: (prompt) => set({ prompt }),
  setSentPrompts: (prompts) =>
    set((state) => ({
      sentPrompts: typeof prompts === "function" ? prompts(state.sentPrompts) : prompts,
    })),
  setQueuedMessages: (queuedMessages) => set({ queuedMessages }),
  setRunning: (running) => set({ running }),
  setSessionMarker: (sessionKey, markerState, options) => {
    const key = sessionRunKey(sessionKey);
    // Never toggle global `running` without a session identity — that stuck the
    // composer/sidebar after switches when sessionFile was briefly empty.
    if (!key) return;
    clearCompletedTimer(key);
    set((state) => {
      const sessionMarkers = { ...state.sessionMarkers };
      const runningSessions = { ...state.runningSessions };
      const runningRuntimeIds = { ...state.runningRuntimeIds };
      if (markerState === "idle") {
        delete sessionMarkers[key];
        delete runningSessions[key];
      } else {
        const marker: SessionMarker = { state: markerState };
        if (options?.reason?.trim()) marker.reason = options.reason.trim();
        sessionMarkers[key] = marker;
        if (isBusyRunState(markerState)) runningSessions[key] = true;
        else delete runningSessions[key];
      }
      if (options?.runtimeId) {
        const rid = options.runtimeId;
        if (markerState === "idle") {
          if (runningRuntimeIds[rid] === key) delete runningRuntimeIds[rid];
        } else if (isBusyRunState(markerState)) {
          // Only bind runtime→session while busy. Drop on settle so late events
          // cannot re-light a finished row.
          runningRuntimeIds[rid] = key;
        } else {
          // completed / failed / aborted / crashed — release runtime binding.
          if (runningRuntimeIds[rid] === key) delete runningRuntimeIds[rid];
        }
      }
      // Composer stop tracks the *foreground* session only.
      const fgKey = sessionKeyFromSnapshot(state.snapshot);
      return {
        sessionMarkers,
        runningSessions,
        runningRuntimeIds,
        running: fgKey ? Boolean(runningSessions[fgKey]) : false,
      };
    });
    if (markerState === "completed") {
      scheduleCompletedClear(key, () => {
        const current = get().sessionMarkers[key];
        if (current?.state !== "completed") return;
        get().setSessionMarker(key, "idle");
      });
    }
  },
  setSessionRunning: (sessionKey, runningFlag, runtimeId) => {
    if (runningFlag) {
      get().setSessionMarker(sessionKey, "running", runtimeId ? { runtimeId } : undefined);
      return;
    }
    // End of prompt IPC: keep terminal markers (failed/aborted/completed from events).
    // Do not invent "completed" here — agent.settled owns the success flash.
    const key = sessionRunKey(sessionKey);
    if (!key) return;
    const existing = get().sessionMarkers[key];
    if (existing && !isBusyRunState(existing.state)) {
      set((state) => {
        const fgKey = sessionKeyFromSnapshot(state.snapshot);
        const runningSessions = { ...state.runningSessions };
        delete runningSessions[key];
        return {
          runningSessions,
          running: fgKey ? Boolean(runningSessions[fgKey]) : false,
        };
      });
      return;
    }
    get().setSessionMarker(sessionKey, "idle", runtimeId ? { runtimeId } : undefined);
  },
  settleSessionByRuntime: (runtimeId, markerState, reason) => {
    const key = get().runningRuntimeIds[runtimeId];
    if (!key) return;
    get().setSessionMarker(key, markerState, { runtimeId, ...(reason ? { reason } : {}) });
  },
  clearSessionRunningByRuntime: (runtimeId) => {
    const key = get().runningRuntimeIds[runtimeId];
    if (!key) return;
    get().setSessionMarker(key, "idle", { runtimeId });
  },
  isSessionRunning: (sessionKey) => {
    const key = sessionRunKey(sessionKey);
    return Boolean(key && get().runningSessions[key]);
  },
  syncForegroundRunning: () => {
    const state = get();
    const fgKey = sessionKeyFromSnapshot(state.snapshot);
    set({ running: fgKey ? Boolean(state.runningSessions[fgKey]) : false });
  },
  setReviewOpen: (open) =>
    set((state) => ({
      reviewOpen: typeof open === "function" ? open(state.reviewOpen) : open,
    })),
  setEnvPanelOpen: (open) =>
    set((state) => ({
      envPanelOpen: typeof open === "function" ? open(state.envPanelOpen) : open,
    })),
  setSidebarOpen: (open) =>
    set((state) => ({
      sidebarOpen: typeof open === "function" ? open(state.sidebarOpen) : open,
    })),
  setSidebarCollapsed: (sidebarCollapsed) => {
    savePref("pix.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
    set({ sidebarCollapsed });
  },
  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    get().setSidebarCollapsed(next);
  },
  setSidebarWidthPx: (px) => {
    const sidebarWidthPx = clampSidebarWidth(px);
    savePref("pix.sidebarWidth", String(sidebarWidthPx));
    set({ sidebarWidthPx });
  },
  setSidebarTranslucent: (sidebarTranslucent) => {
    savePref("pix.sidebarTranslucent", sidebarTranslucent ? "1" : "0");
    set({ sidebarTranslucent });
  },
  setLocale: (locale) => {
    savePref("pix.locale", locale);
    set({ locale });
  },
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setLastFailure: (lastFailure) => set({ lastFailure }),
  showAppError: (appError) => set({ appError }),
  clearAppError: () => set({ appError: undefined }),
  setView: (view) => set({ view }),
  setPackages: (packages) => set({ packages }),
  setResources: (resources) => set({ resources }),
  setEcoLoading: (ecoLoading) => set({ ecoLoading }),
  setThemePreference: (preference) => {
    savePref("pix.colorMode", preference);
    set(themeState(preference));
  },
  setColorMode: (preference) => {
    get().setThemePreference(preference);
  },
  toggleColorMode: () => {
    const next = nextThemePreference(get().themePreference);
    get().setThemePreference(next);
  },
  syncSystemTheme: () => {
    const preference = get().themePreference;
    if (preference !== "system") return;
    set(themeState("system"));
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setRuntimeId: (runtimeId) => set({ runtimeId }),
  setLastSequence: (lastSequence) => set({ lastSequence }),
  acceptSnapshot: (snapshot) =>
    set((state) => {
      const key = sessionKeyFromSnapshot(snapshot);
      return {
        snapshot,
        queuedMessages: snapshot.queuedMessages,
        runtimeId: snapshot.runtimeId,
        lastSequence: snapshot.sequence,
        // Never invent busy from a snapshot — only runningSessions (sendPrompt) can.
        running: key ? Boolean(state.runningSessions[key]) : false,
      };
    }),
  applySessionOpen: (input) =>
    set((state) => {
      const key = sessionKeyFromSnapshot(input.snapshot);
      const idKey = sessionRunKey(input.snapshot.sessionId);
      // Integrity: drop busy markers that lost their runningSessions entry (orphans
      // from lifecycle events). Keep markers for sessions still tracked as busy
      // (including background/parked turns).
      const sessionMarkers: Record<string, SessionMarker> = {};
      const runningSessions: Record<string, true> = {};
      for (const [k, marker] of Object.entries(state.sessionMarkers)) {
        if (isBusyRunState(marker.state) && !state.runningSessions[k]) {
          continue; // stale busy — discard
        }
        sessionMarkers[k] = marker;
        if (isBusyRunState(marker.state)) runningSessions[k] = true;
      }
      // Re-sync runningSessions from surviving busy markers only.
      for (const k of Object.keys(state.runningSessions)) {
        if (sessionMarkers[k] && isBusyRunState(sessionMarkers[k]?.state)) {
          runningSessions[k] = true;
        }
      }
      const busyHere = Boolean((key && runningSessions[key]) || (idKey && runningSessions[idKey]));
      return {
        snapshot: input.snapshot,
        runtimeId: input.snapshot.runtimeId,
        lastSequence: input.snapshot.sequence,
        threads:
          input.threads.length > 0
            ? input.threads
            : state.threads.map((t) => ({
                ...t,
                active: t.path === input.snapshot.sessionFile || t.id === input.snapshot.sessionId,
              })),
        history: input.history,
        events: [],
        liveStream: emptyLiveStream(),
        sentPrompts: [],
        queuedMessages: input.snapshot.queuedMessages,
        lastFailure: undefined,
        sessionMarkers,
        runningSessions,
        // Foreground only — never inherit previous session's busy flag.
        running: busyHere,
        view: "thread" as const,
      };
    }),
  resetAfterStop: () => {
    for (const key of completedMarkerTimers.keys()) clearCompletedTimer(key);
    set({
      snapshot: undefined,
      threads: [],
      history: [],
      events: [],
      liveStream: emptyLiveStream(),
      queuedMessages: { steering: [], followUp: [] },
      running: false,
      sessionMarkers: {},
      runningSessions: {},
      runningRuntimeIds: {},
      runtimeId: undefined,
      lastSequence: 0,
      status: "Agent Host stopped",
    });
  },
  resetAfterCrash: (message) =>
    set((state) => {
      // Only clear foreground; background parked hosts may still be fine.
      const fgKey = sessionKeyFromSnapshot(state.snapshot);
      const runningSessions = { ...state.runningSessions };
      const runningRuntimeIds = { ...state.runningRuntimeIds };
      const sessionMarkers = { ...state.sessionMarkers };
      if (fgKey) {
        clearCompletedTimer(fgKey);
        delete runningSessions[fgKey];
        sessionMarkers[fgKey] = { state: "crashed", reason: message };
      }
      if (state.runtimeId) delete runningRuntimeIds[state.runtimeId];
      return {
        runtimeId: undefined,
        lastSequence: 0,
        running: false,
        sessionMarkers,
        runningSessions,
        runningRuntimeIds,
        queuedMessages: { steering: [], followUp: [] },
        snapshot: undefined,
        liveStream: emptyLiveStream(),
        status: message,
      };
    }),
}));
