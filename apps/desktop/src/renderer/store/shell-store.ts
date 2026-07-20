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
  ResourceSummary,
  SessionHistoryMessage,
  SessionThreadSummary,
} from "@pix/contracts";
import { create } from "zustand";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../lib/i18n.ts";
import { SHELL_SIDEBAR } from "../lib/layout.ts";
import { SIDEBAR_DEFAULT_TRANSLUCENT, clampSidebarWidth } from "../lib/sidebar-prefs.ts";
import {
  isThemePreference,
  nextThemePreference,
  resolveColorMode,
  systemPrefersDark,
  type ResolvedColorMode,
  type ThemePreference,
} from "../lib/theme.ts";

export type ShellView = "thread" | "packages" | "resources" | "settings";
export type ColorMode = ResolvedColorMode;
export type { ThemePreference, ResolvedColorMode };
/** Implemented settings sections only (no stub / coming-soon nav). */
export type SettingsSection =
  | "general"
  | "appearance"
  | "providers"
  | "models"
  | "piSettings"
  | "archived";

export interface ShellState {
  status: string;
  snapshot: HostSnapshot | undefined;
  events: HostEvent[];
  history: SessionHistoryMessage[];
  threads: SessionThreadSummary[];
  prompt: string;
  sentPrompts: string[];
  running: boolean;
  reviewOpen: boolean;
  /** Mobile overlay open (narrow layout). */
  sidebarOpen: boolean;
  /** Desktop collapse to icon rail. */
  sidebarCollapsed: boolean;
  sidebarWidthPx: number;
  sidebarTranslucent: boolean;
  locale: Locale;
  settingsSection: SettingsSection;
  lastFailure: string | undefined;
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
  setHistory: (history: SessionHistoryMessage[]) => void;
  setThreads: (threads: SessionThreadSummary[]) => void;
  setPrompt: (prompt: string) => void;
  setSentPrompts: (prompts: string[] | ((current: string[]) => string[])) => void;
  setRunning: (running: boolean) => void;
  setReviewOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  setSidebarOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarWidthPx: (px: number) => void;
  setSidebarTranslucent: (value: boolean) => void;
  setLocale: (locale: Locale) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setLastFailure: (failure: string | undefined) => void;
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
    // ignore
  }
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

function loadLocale(): Locale {
  return loadPref("pix.locale", (raw) => (isLocale(raw) ? raw : undefined), DEFAULT_LOCALE);
}

function loadSidebarCollapsed(): boolean {
  return loadPref("pix.sidebarCollapsed", (raw) => raw === "1", false);
}

function loadSidebarWidth(): number {
  return loadPref(
    "pix.sidebarWidthPx",
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
  history: [],
  threads: [],
  prompt: "",
  sentPrompts: [],
  running: false,
  reviewOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: loadSidebarCollapsed(),
  sidebarWidthPx: loadSidebarWidth(),
  sidebarTranslucent: loadSidebarTranslucent(),
  locale: loadLocale(),
  settingsSection: "general",
  lastFailure: undefined,
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
  setHistory: (history) => set({ history }),
  setThreads: (threads) => set({ threads }),
  setPrompt: (prompt) => set({ prompt }),
  setSentPrompts: (prompts) =>
    set((state) => ({
      sentPrompts: typeof prompts === "function" ? prompts(state.sentPrompts) : prompts,
    })),
  setRunning: (running) => set({ running }),
  setReviewOpen: (open) =>
    set((state) => ({
      reviewOpen: typeof open === "function" ? open(state.reviewOpen) : open,
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
    savePref("pix.sidebarCollapsed", next ? "1" : "0");
    set({ sidebarCollapsed: next });
  },
  setSidebarWidthPx: (px) => {
    const sidebarWidthPx = clampSidebarWidth(px);
    savePref("pix.sidebarWidthPx", String(sidebarWidthPx));
    set({ sidebarWidthPx, sidebarCollapsed: false });
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
    savePref("pix.colorMode", next);
    set(themeState(next));
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
    set({
      snapshot,
      runtimeId: snapshot.runtimeId,
      lastSequence: snapshot.sequence,
    }),
  applySessionOpen: (input) =>
    set({
      snapshot: input.snapshot,
      runtimeId: input.snapshot.runtimeId,
      lastSequence: input.snapshot.sequence,
      threads: input.threads,
      history: input.history,
      events: [],
      sentPrompts: [],
      lastFailure: undefined,
      running: false,
      view: "thread",
    }),
  resetAfterStop: () =>
    set({
      snapshot: undefined,
      threads: [],
      history: [],
      events: [],
      running: false,
      runtimeId: undefined,
      lastSequence: 0,
      status: "Agent Host stopped",
    }),
  resetAfterCrash: (message) =>
    set({
      runtimeId: undefined,
      lastSequence: 0,
      running: false,
      snapshot: undefined,
      status: message,
    }),
}));
