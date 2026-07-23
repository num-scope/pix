/**
 * Codex / ChatGPT–style settings content column.
 * Large left-aligned title · section labels · grouped cards with rows.
 */
import type {
  CustomModelApi,
  HostSnapshot,
  ModelSummary,
  PiSettingsPatch,
  PiSettingsView,
  ProviderAuthSummary,
  ProviderOAuthEvent,
  ProviderOAuthPrompt,
  ProviderOAuthUpdate,
  ProviderUsageSnapshot,
} from "@pix/contracts";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  LoaderCircle,
  LogIn,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, type Locale, type MessageKey } from "../../lib/i18n.ts";
import { groupModelsByProvider } from "../../lib/model-groups.ts";
import {
  deleteThreadLocal,
  loadArchivedThreadMeta,
  loadArchivedThreads,
  loadProjectAliases,
  loadThreadAliases,
  projectDisplayName,
  saveArchivedThreadMeta,
  threadDisplayTitle,
  unarchiveThread,
  type ArchivedThreadMeta,
} from "../../lib/project-prefs.ts";
import {
  loadEnvPanelVisibility,
  setEnvPanelSectionVisible,
  type EnvPanelSectionId,
} from "../../lib/env-panel-prefs.ts";
import {
  loadNotificationPrefs,
  patchNotificationPrefs,
  type NotificationPrefs,
} from "../../lib/notification-prefs.ts";
import {
  comboToDisplayParts,
  eventToCombo,
  formatComboDisplay,
  getEffectiveCombo,
  loadShortcutOverrides,
  resetAllShortcuts,
  setShortcutOverride,
  SHORTCUT_DEFINITIONS,
  type ShortcutId,
  type ShortcutOverrides,
} from "../../lib/shortcuts.ts";
import {
  loadConfirmArchive,
  loadConfirmDelete,
  saveConfirmArchive,
  saveConfirmDelete,
} from "../../lib/behavior-prefs.ts";
import {
  formatResetCountdown,
  formatUsageUpdatedAt,
  formatWindowDuration,
  remainingPercent,
  usageTone,
} from "../../lib/auth-usage-limits.ts";
// loadConfirmDelete also used by archived list bulk actions
import {
  loadPreventSleep,
  loadSuggestions,
  savePreventSleep,
  saveSuggestions,
  type AccessMode,
  type AccessVisibility,
} from "../../lib/settings-prefs.ts";
import type { ThemePreference } from "../../lib/theme.ts";
import { cn } from "../../lib/utils.ts";
import { workspaceLabel } from "../../lib/workspace.ts";
import { useShellStore, type SettingsSection } from "../../store/shell-store.ts";
import {
  SettingsButton,
  SettingsIconButton,
  SettingsInput,
  SettingsPageShell,
  SettingsPillButton,
  SettingsRow,
  SettingsSectionBlock,
  SettingsSelect,
  SettingsTextarea,
  SettingsToggle,
} from "./SettingsPrimitives.tsx";

export interface SettingsPageProps {
  snapshot: HostSnapshot | undefined;
  status: string;
  locale: Locale;
  section: SettingsSection;
  colorMode: "light" | "dark";
  themePreference: ThemePreference;
  sidebarTranslucent: boolean;
  sidebarWidthPx: number;
  /** Which composer permission options are shown (independent toggles). */
  accessVisibility: AccessVisibility;
  onAccessVisibility: (visibility: AccessVisibility) => void;
  /** Currently selected permission mode (composer). */
  accessMode: AccessMode;
  onAccessMode: (mode: AccessMode) => void;
  showContextUsage: boolean;
  onShowContextUsage: (value: boolean) => void;
  onEnsureHost: () => Promise<HostSnapshot>;
  onSnapshot: (snapshot: HostSnapshot) => void;
  onLocale: (locale: Locale) => void;
  onThemePreference: (mode: ThemePreference) => void;
  onTranslucent: (value: boolean) => void;
  onSidebarWidth: (px: number) => void;
  onToggleTrust: () => void;
}

export function SettingsPage(props: SettingsPageProps) {
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(props.locale, key, vars);

  return (
    <section className="page settings-page" data-testid="settings-page">
      {/* Solid top cap (titlebar-height): keeps scrolled content off the window edge — no divider. */}
      <div className="settings-page-top-cap" aria-hidden data-testid="settings-top-cap" />
      <div className="settings-page-body">
        {props.section === "general" ? (
          <GeneralSection {...props} tr={tr} />
        ) : props.section === "appearance" ? (
          <AppearanceSection {...props} tr={tr} />
        ) : props.section === "behavior" ? (
          <BehaviorSection {...props} tr={tr} />
        ) : props.section === "environment" ? (
          <EnvironmentSection {...props} tr={tr} />
        ) : props.section === "worktree" ? (
          <WorktreeSection {...props} tr={tr} />
        ) : props.section === "git" ? (
          <GitSection {...props} tr={tr} />
        ) : props.section === "usage" ? (
          <UsageLimitsSection {...props} tr={tr} />
        ) : props.section === "notifications" ? (
          <NotificationsSection {...props} tr={tr} />
        ) : props.section === "shortcuts" ? (
          <ShortcutsSection {...props} tr={tr} />
        ) : props.section === "providers" ? (
          <ProvidersSection {...props} tr={tr} />
        ) : props.section === "models" ? (
          <ModelsSection {...props} tr={tr} />
        ) : props.section === "piSettings" ? (
          <PiSettingsSection {...props} tr={tr} />
        ) : (
          <ArchivedSection locale={props.locale} tr={tr} />
        )}
      </div>
    </section>
  );
}

function formatArchivedDate(iso: string | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}

function normalizeCwdKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

type ArchivedSessionRow = {
  id: string;
  title: string;
  cwd: string;
  projectName: string;
  archivedAt?: string;
};

function ArchivedSection(props: {
  locale: Locale;
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
}) {
  const { tr, locale } = props;
  const [sessionIds, setSessionIds] = useState(loadArchivedThreads);
  const [meta, setMeta] = useState(loadArchivedThreadMeta);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const projectAliases = loadProjectAliases();
  const threadAliases = loadThreadAliases();

  function refresh() {
    setSessionIds(loadArchivedThreads());
    setMeta(loadArchivedThreadMeta());
  }

  useEffect(() => {
    if (!openGroupMenu) return;
    const onDoc = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setOpenGroupMenu(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openGroupMenu]);

  const rows: ArchivedSessionRow[] = useMemo(() => {
    return sessionIds.map((id) => {
      const m: ArchivedThreadMeta | undefined = meta[id];
      const cwd = m?.cwd || m?.path || "";
      const cwdKey = cwd ? normalizeCwdKey(cwd) : "__none__";
      const projectName = cwd
        ? projectDisplayName(cwd, projectAliases, workspaceLabel(cwd).name)
        : tr("settings.archived.unknownProject");
      const title = threadDisplayTitle(id, threadAliases, m?.title ?? `Session ${id.slice(0, 8)}`);
      const row: ArchivedSessionRow = {
        id,
        title,
        cwd: cwdKey,
        projectName,
      };
      if (m?.archivedAt) row.archivedAt = m.archivedAt;
      return row;
    });
  }, [sessionIds, meta, projectAliases, threadAliases, tr]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (!map.has(row.cwd)) map.set(row.cwd, row.projectName);
    }
    return [...map.entries()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (projectFilter !== "all" && row.cwd !== projectFilter) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.projectName.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, projectFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: ArchivedSessionRow[] }>();
    for (const row of filtered) {
      const g = map.get(row.cwd) ?? { name: row.projectName, items: [] };
      g.items.push(row);
      map.set(row.cwd, g);
    }
    // sort items by archivedAt desc within group
    for (const g of map.values()) {
      g.items.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
    }
    return [...map.entries()];
  }, [filtered]);

  function unarchiveSession(id: string) {
    unarchiveThread(id);
    const m = { ...loadArchivedThreadMeta() };
    delete m[id];
    saveArchivedThreadMeta(m);
    refresh();
  }

  function deleteSession(id: string) {
    const name = rows.find((r) => r.id === id)?.title ?? id.slice(0, 8);
    if (loadConfirmDelete()) {
      const ok = window.confirm(tr("confirm.deleteMessage", { name }));
      if (!ok) return;
    }
    deleteThreadLocal(id);
    unarchiveThread(id);
    const m = { ...loadArchivedThreadMeta() };
    delete m[id];
    saveArchivedThreadMeta(m);
    refresh();
  }

  function deleteAllInProject(cwdKey: string) {
    const name = rows.find((r) => r.cwd === cwdKey)?.projectName ?? cwdKey;
    if (loadConfirmDelete()) {
      const ok = window.confirm(tr("confirm.deleteMessage", { name }));
      if (!ok) return;
    }
    const ids = rows.filter((r) => r.cwd === cwdKey).map((r) => r.id);
    for (const id of ids) {
      deleteThreadLocal(id);
      unarchiveThread(id);
    }
    const m = { ...loadArchivedThreadMeta() };
    for (const id of ids) delete m[id];
    saveArchivedThreadMeta(m);
    setOpenGroupMenu(null);
    refresh();
  }

  function deleteAll() {
    if (loadConfirmDelete()) {
      const ok = window.confirm(
        tr("confirm.deleteMessage", { name: tr("settings.archived.deleteAll") }),
      );
      if (!ok) return;
    }
    for (const id of sessionIds) {
      deleteThreadLocal(id);
      unarchiveThread(id);
    }
    saveArchivedThreadMeta({});
    refresh();
  }

  return (
    <SettingsPageShell
      title={tr("section.archived")}
      testId="settings-archived"
      titleAction={
        sessionIds.length > 0 ? (
          <SettingsButton
            variant="secondary"
            size="sm"
            testId="archived-delete-all"
            className="archived-delete-all"
            onClick={deleteAll}
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            {tr("settings.archived.deleteAll")}
          </SettingsButton>
        ) : null
      }
    >
      <div className="archived-toolbar" data-testid="archived-toolbar">
        <label className="archived-search">
          <Search className="size-3.5 shrink-0 text-[var(--text-subtle)]" strokeWidth={1.75} />
          <SettingsInput
            data-testid="archived-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("settings.archived.search")}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
        </label>
        <SettingsSelect
          className="w-auto"
          testId="archived-filter-sessions"
          value="all"
          onChange={() => {
            /* reserved: all sessions only for now */
          }}
          options={[{ value: "all", label: tr("settings.archived.filterAll") }]}
        />
        <SettingsSelect
          className="w-auto"
          testId="archived-filter-projects"
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: "all", label: tr("settings.archived.filterAllProjects") },
            ...projectOptions.map(([key, name]) => ({ value: key, label: name })),
          ]}
        />
      </div>

      {groups.length === 0 ? (
        <p
          className="m-0 px-1 text-[13px] text-[var(--muted-foreground)]"
          data-testid="archived-empty"
        >
          {tr("settings.archived.empty")}
        </p>
      ) : (
        groups.map(([cwdKey, group]) => (
          <section key={cwdKey} className="archived-group" data-testid="archived-project-group">
            <div className="archived-group-header">
              <div className="archived-group-name">
                <Folder className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="truncate">{group.name}</span>
              </div>
              <div className="archived-group-meta">
                <span>{tr("settings.archived.count", { n: String(group.items.length) })}</span>
                <div
                  className="archived-group-menu"
                  ref={openGroupMenu === cwdKey ? menuRef : null}
                >
                  <SettingsIconButton
                    testId="archived-project-menu"
                    aria-label="More"
                    size="icon-sm"
                    onClick={() => setOpenGroupMenu((v) => (v === cwdKey ? null : cwdKey))}
                  >
                    <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
                  </SettingsIconButton>
                  {openGroupMenu === cwdKey ? (
                    <div className="archived-group-menu-panel" role="menu">
                      <SettingsButton
                        variant="ghost"
                        testId="archived-project-delete-all"
                        className="archived-group-menu-item h-auto w-full justify-start rounded-none text-red-400"
                        onClick={() => deleteAllInProject(cwdKey)}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                        {tr("settings.archived.deleteProjectAll")}
                      </SettingsButton>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="archived-card">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="archived-item"
                  data-testid={`archived-session-${item.id}`}
                >
                  <div className="archived-item-copy">
                    <div className="archived-item-title">{item.title}</div>
                    <div className="archived-item-date">
                      {formatArchivedDate(item.archivedAt, locale)}
                    </div>
                  </div>
                  <div className="archived-item-actions">
                    <SettingsIconButton
                      testId={`archived-session-delete-${item.id}`}
                      title={tr("settings.archived.delete")}
                      aria-label={tr("settings.archived.delete")}
                      className="archived-icon-btn"
                      onClick={() => deleteSession(item.id)}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </SettingsIconButton>
                    <SettingsButton
                      variant="secondary"
                      size="sm"
                      testId={`archived-session-unarchive-${item.id}`}
                      className="archived-unarchive-btn"
                      onClick={() => unarchiveSession(item.id)}
                    >
                      {tr("settings.archived.unarchive")}
                    </SettingsButton>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </SettingsPageShell>
  );
}

function ShortcutsSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<ShortcutOverrides>(loadShortcutOverrides);
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [conflict, setConflict] = useState<string>();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_DEFINITIONS;
    return SHORTCUT_DEFINITIONS.filter((def) => {
      const label = tr(def.labelKey as MessageKey).toLowerCase();
      const combo = formatComboDisplay(getEffectiveCombo(def.id, overrides)).toLowerCase();
      return label.includes(q) || def.id.includes(q) || combo.includes(q);
    });
  }, [query, overrides, tr]);

  useEffect(() => {
    if (!recordingId) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingId(null);
        setConflict(undefined);
        return;
      }
      // Backspace / Delete alone → clear binding (no shortcut).
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setOverrides(setShortcutOverride(recordingId, ""));
        setRecordingId(null);
        setConflict(undefined);
        return;
      }
      const combo = eventToCombo(event);
      if (!combo) return;
      // Conflict check (skip unbound rows)
      for (const def of SHORTCUT_DEFINITIONS) {
        if (def.id === recordingId) continue;
        const other = getEffectiveCombo(def.id, overrides);
        if (!other) continue;
        if (other === combo) {
          setConflict(tr("shortcuts.conflict", { name: tr(def.labelKey as MessageKey) }));
          return;
        }
      }
      setOverrides(setShortcutOverride(recordingId, combo));
      setRecordingId(null);
      setConflict(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId, overrides, tr]);

  return (
    <SettingsPageShell
      title={tr("section.shortcuts")}
      testId="settings-shortcuts"
      titleAction={
        <SettingsPillButton
          label={tr("shortcuts.resetAll")}
          testId="shortcuts-reset-all"
          onClick={() => {
            setOverrides(resetAllShortcuts());
            setRecordingId(null);
            setConflict(undefined);
          }}
        />
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <label className="settings-rail-search min-w-0 flex-1 !rounded-[12px]">
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
          <SettingsInput
            data-testid="shortcuts-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("shortcuts.search")}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
        </label>
      </div>
      {conflict ? (
        <p className="mb-2 text-[12px] text-red-400" data-testid="shortcuts-conflict">
          {conflict}
        </p>
      ) : null}
      <SettingsSectionBlock label={tr("section.shortcuts")} testId="settings-shortcuts-list">
        {filtered.length === 0 ? (
          <div className="settings-row settings-row-last">
            <div className="settings-row-desc">{tr("shortcuts.searchEmpty")}</div>
          </div>
        ) : (
          filtered.map((def, index) => {
            const effective = getEffectiveCombo(def.id, overrides);
            const isCustom = Object.prototype.hasOwnProperty.call(overrides, def.id);
            const unbound = isCustom && !effective;
            const recording = recordingId === def.id;
            const keyParts = comboToDisplayParts(effective);
            return (
              <div
                key={def.id}
                className={cn(
                  "settings-row items-center",
                  index === filtered.length - 1 && "settings-row-last",
                )}
                data-testid={`shortcut-row-${def.id}`}
              >
                <div className="settings-row-copy min-w-0 flex-1">
                  <div className="settings-row-title">{tr(def.labelKey as MessageKey)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <SettingsButton
                    type="button"
                    variant="outline"
                    size="sm"
                    testId={`shortcut-bind-${def.id}`}
                    className={cn(
                      "shortcut-bind h-auto min-h-8",
                      recording && "shortcut-bind-recording",
                      !recording && !keyParts.length && "shortcut-bind-empty",
                    )}
                    aria-label={
                      recording
                        ? tr("shortcuts.pressKeys")
                        : effective
                          ? formatComboDisplay(effective)
                          : tr("shortcuts.none")
                    }
                    onClick={() => {
                      setConflict(undefined);
                      setRecordingId(recording ? null : def.id);
                    }}
                  >
                    {recording ? (
                      <>
                        <span className="shortcut-bind-dot" aria-hidden />
                        <span className="shortcut-bind-hint">{tr("shortcuts.pressKeysHint")}</span>
                      </>
                    ) : keyParts.length > 0 ? (
                      keyParts.map((part, i) => (
                        <kbd key={`${def.id}-${part}-${i}`} className="shortcut-key">
                          {part}
                        </kbd>
                      ))
                    ) : (
                      <span className="shortcut-bind-hint">
                        {unbound || isCustom ? tr("shortcuts.none") : tr("shortcuts.clickToBind")}
                      </span>
                    )}
                  </SettingsButton>
                  <SettingsIconButton
                    className="shortcut-action-btn"
                    testId={`shortcut-reset-${def.id}`}
                    title={tr("shortcuts.reset")}
                    aria-label={tr("shortcuts.reset")}
                    disabled={!isCustom}
                    onClick={() => {
                      setOverrides(setShortcutOverride(def.id, null));
                      setConflict(undefined);
                      setRecordingId(null);
                    }}
                  >
                    <RotateCcw className="size-3.5" strokeWidth={1.75} />
                  </SettingsIconButton>
                  <SettingsIconButton
                    className="shortcut-action-btn shortcut-action-delete"
                    testId={`shortcut-clear-${def.id}`}
                    title={tr("shortcuts.clear")}
                    aria-label={tr("shortcuts.clear")}
                    disabled={!effective}
                    onClick={() => {
                      setOverrides(setShortcutOverride(def.id, ""));
                      setConflict(undefined);
                      setRecordingId(null);
                    }}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </SettingsIconButton>
                </div>
              </div>
            );
          })
        )}
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

function NotificationsSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const showAppError = useShellStore((s) => s.showAppError);
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadNotificationPrefs);
  const [testing, setTesting] = useState(false);

  function update(patch: Partial<NotificationPrefs>) {
    setPrefs(patchNotificationPrefs(patch));
  }

  async function sendTest() {
    setTesting(true);
    try {
      // Test always posts even when focused (diagnostics).
      const ok = await window.pix.notifications.show({
        title: tr("notify.testTitle"),
        body: tr("notify.testBody"),
        silent: !prefs.sound,
        force: true,
      });
      if (!ok) {
        showAppError(tr("notify.testFailed"));
      }
    } catch (error) {
      showAppError(error instanceof Error ? error.message : tr("notify.testFailed"));
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsPageShell title={tr("section.notifications")} testId="settings-notifications">
      <SettingsSectionBlock label={tr("section.notifications")} testId="settings-notify-options">
        <SettingsRow
          title={tr("notify.master")}
          description={tr("notify.masterHint")}
          control={
            <SettingsToggle
              checked={prefs.enabled}
              onChange={(on) => update({ enabled: on })}
              testId="settings-notify-enabled"
              aria-label={tr("notify.master")}
            />
          }
        />
        <SettingsRow
          title={tr("notify.onComplete")}
          description={tr("notify.onCompleteHint")}
          control={
            <SettingsToggle
              checked={prefs.onComplete}
              onChange={(on) => update({ onComplete: on })}
              testId="settings-notify-complete"
              disabled={!prefs.enabled}
              aria-label={tr("notify.onComplete")}
            />
          }
        />
        <SettingsRow
          title={tr("notify.onError")}
          description={tr("notify.onErrorHint")}
          control={
            <SettingsToggle
              checked={prefs.onError}
              onChange={(on) => update({ onError: on })}
              testId="settings-notify-error"
              disabled={!prefs.enabled}
              aria-label={tr("notify.onError")}
            />
          }
        />
        <SettingsRow
          title={tr("notify.onHostCrash")}
          description={tr("notify.onHostCrashHint")}
          control={
            <SettingsToggle
              checked={prefs.onHostCrash}
              onChange={(on) => update({ onHostCrash: on })}
              testId="settings-notify-crash"
              disabled={!prefs.enabled}
              aria-label={tr("notify.onHostCrash")}
            />
          }
        />
        <SettingsRow
          title={tr("notify.onlyWhenUnfocused")}
          description={tr("notify.onlyWhenUnfocusedHint")}
          control={
            <SettingsToggle
              checked={prefs.onlyWhenUnfocused}
              onChange={(on) => update({ onlyWhenUnfocused: on })}
              testId="settings-notify-unfocused"
              disabled={!prefs.enabled}
              aria-label={tr("notify.onlyWhenUnfocused")}
            />
          }
        />
        <SettingsRow
          title={tr("notify.sound")}
          description={tr("notify.soundHint")}
          control={
            <SettingsToggle
              checked={prefs.sound}
              onChange={(on) => update({ sound: on })}
              testId="settings-notify-sound"
              disabled={!prefs.enabled}
              aria-label={tr("notify.sound")}
            />
          }
          last
        />
      </SettingsSectionBlock>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SettingsPillButton
          label={testing ? "…" : tr("notify.test")}
          testId="settings-notify-test"
          disabled={!prefs.enabled || testing}
          onClick={() => void sendTest()}
        />
        <SettingsPillButton
          label={tr("notify.openSystem")}
          testId="settings-notify-open-system"
          onClick={() => void window.pix.notifications.openSystemSettings()}
        />
      </div>
    </SettingsPageShell>
  );
}

function EnvironmentSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [visibility, setVisibility] = useState(loadEnvPanelVisibility);

  function toggle(id: EnvPanelSectionId, on: boolean) {
    const next = setEnvPanelSectionVisible(id, on);
    setVisibility(next);
    window.dispatchEvent(new Event("pix-env-panel-prefs"));
  }

  const rows: Array<{ id: EnvPanelSectionId; titleKey: MessageKey; descKey: MessageKey }> = [
    { id: "changes", titleKey: "env.section.changes", descKey: "env.section.changesDesc" },
    { id: "cwd", titleKey: "env.section.cwd", descKey: "env.section.cwdDesc" },
    { id: "branch", titleKey: "env.section.branch", descKey: "env.section.branchDesc" },
    {
      id: "gitActions",
      titleKey: "env.section.gitActions",
      descKey: "env.section.gitActionsDesc",
    },
    { id: "openIn", titleKey: "env.section.openIn", descKey: "env.section.openInDesc" },
    {
      id: "localServices",
      titleKey: "env.section.localServices",
      descKey: "env.section.localServicesDesc",
    },
  ];

  return (
    <SettingsPageShell title={tr("section.environment")} testId="settings-environment">
      <SettingsSectionBlock label={tr("env.title")} testId="settings-env-visibility">
        {rows.map((row, index) => (
          <SettingsRow
            key={row.id}
            title={tr(row.titleKey)}
            description={tr(row.descKey)}
            control={
              <SettingsToggle
                checked={visibility[row.id]}
                onChange={(on) => toggle(row.id, on)}
                testId={`settings-env-${row.id}`}
                aria-label={tr(row.titleKey)}
              />
            }
            last={index === rows.length - 1}
          />
        ))}
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

function WorktreeSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [wtRoot, setWtRoot] = useState("");
  /** Last persisted configured value — avoid blur/save when unchanged. */
  const [wtRootSaved, setWtRootSaved] = useState("");
  const [wtDefaultRoot, setWtDefaultRoot] = useState("");
  const [wtAutoDelete, setWtAutoDelete] = useState(true);
  const [wtLimit, setWtLimit] = useState(10);
  const [wtLoading, setWtLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.pix.workspace
      .getWorktreePrefs(props.snapshot?.cwd)
      .then((p) => {
        if (cancelled) return;
        setWtRoot(p.rootConfigured);
        setWtRootSaved(p.rootConfigured);
        setWtDefaultRoot(p.defaultRoot);
        setWtAutoDelete(p.autoDelete);
        setWtLimit(p.autoDeleteLimit);
      })
      .catch(() => {
        /* host may be stopped */
      });
    return () => {
      cancelled = true;
    };
  }, [props.snapshot?.cwd]);

  async function persistWorktree(patch: {
    rootConfigured?: string;
    autoDelete?: boolean;
    autoDeleteLimit?: number;
  }) {
    setWtLoading(true);
    try {
      const p = await window.pix.workspace.setWorktreePrefs(patch);
      // Only rewrite root field when this save touched it — empty field must stay empty
      // and not flip when auto-delete / limit saves recompute defaultRoot for another cwd.
      if (patch.rootConfigured !== undefined) {
        setWtRoot(p.rootConfigured);
        setWtRootSaved(p.rootConfigured);
      }
      setWtAutoDelete(p.autoDelete);
      setWtLimit(p.autoDeleteLimit);
      if (p.defaultRoot) setWtDefaultRoot(p.defaultRoot);
    } catch (error) {
      useShellStore
        .getState()
        .showAppError(error instanceof Error ? error.message : "Failed to save worktree prefs");
    } finally {
      setWtLoading(false);
    }
  }

  return (
    <SettingsPageShell title={tr("section.worktree")} testId="settings-worktree">
      <SettingsSectionBlock label={tr("worktree.settings")} testId="settings-worktree-options">
        <div className="settings-row settings-row-last !flex-col !items-stretch gap-3">
          <div>
            <div className="settings-row-title">{tr("worktree.root")}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <SettingsInput
                data-testid="worktree-root-input"
                mono
                className="min-w-0 flex-1"
                value={wtRoot}
                placeholder={wtDefaultRoot || tr("worktree.rootPlaceholder")}
                disabled={wtLoading}
                onChange={(e) => setWtRoot(e.target.value)}
                onBlur={() => {
                  if (wtRoot.trim() === wtRootSaved.trim()) return;
                  void persistWorktree({ rootConfigured: wtRoot });
                }}
              />
              <SettingsPillButton
                label={tr("worktree.pickRoot")}
                testId="worktree-root-pick"
                disabled={wtLoading}
                onClick={() => {
                  void window.pix.workspace.pickFolder().then((folder) => {
                    if (!folder) return;
                    setWtRoot(folder);
                    void persistWorktree({ rootConfigured: folder });
                  });
                }}
              />
              <SettingsPillButton
                label={tr("worktree.clearRoot")}
                testId="worktree-root-clear"
                disabled={wtLoading || !wtRoot.trim()}
                onClick={() => {
                  setWtRoot("");
                  void persistWorktree({ rootConfigured: "" });
                }}
              />
            </div>
          </div>
          <div className="settings-divider flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="settings-row-title">{tr("worktree.autoDelete")}</div>
              <div className="settings-row-desc">{tr("worktree.autoDeleteHint")}</div>
            </div>
            <SettingsToggle
              checked={wtAutoDelete}
              onChange={(on) => {
                setWtAutoDelete(on);
                void persistWorktree({ autoDelete: on });
              }}
              testId="worktree-auto-delete"
              disabled={wtLoading}
              aria-label={tr("worktree.autoDelete")}
            />
          </div>
          <div className="settings-divider flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="settings-row-title">{tr("worktree.autoDeleteLimit")}</div>
              <div className="settings-row-desc">{tr("worktree.autoDeleteLimitHint")}</div>
            </div>
            <SettingsInput
              type="number"
              min={1}
              max={100}
              data-testid="worktree-auto-delete-limit"
              className="w-20 text-right"
              value={wtLimit}
              disabled={wtLoading || !wtAutoDelete}
              onChange={(e) => setWtLimit(Number(e.target.value) || 1)}
              onBlur={() => void persistWorktree({ autoDeleteLimit: wtLimit })}
            />
          </div>
        </div>
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

function GitSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [branchPrefix, setBranchPrefix] = useState("pix/");
  const [pullMode, setPullMode] = useState<"merge" | "squash">("merge");
  const [forcePush, setForcePush] = useState(false);
  const [draftPr, setDraftPr] = useState(false);
  const [customCommit, setCustomCommit] = useState("");
  const [customPr, setCustomPr] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.pix.workspace
      .getGitPrefs()
      .then((p) => {
        if (cancelled) return;
        setBranchPrefix(p.branchPrefix);
        setPullMode(p.pullMode);
        setForcePush(p.forcePush);
        setDraftPr(p.draftPr);
        setCustomCommit(p.customCommitCommand);
        setCustomPr(p.customPrCommand);
        setModelKey(p.modelProvider && p.modelId ? `${p.modelProvider}/${p.modelId}` : "");
      })
      .catch(() => {
        /* host may be stopped */
      });
    void (async () => {
      try {
        await props.onEnsureHost();
        const list = await window.pix.models.list();
        if (!cancelled) setModels(list);
      } catch {
        if (!cancelled) setModels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.onEnsureHost]);

  async function persist(patch: Parameters<typeof window.pix.workspace.setGitPrefs>[0]) {
    setLoading(true);
    try {
      const p = await window.pix.workspace.setGitPrefs(patch);
      setBranchPrefix(p.branchPrefix);
      setPullMode(p.pullMode);
      setForcePush(p.forcePush);
      setDraftPr(p.draftPr);
      setCustomCommit(p.customCommitCommand);
      setCustomPr(p.customPrCommand);
      setModelKey(p.modelProvider && p.modelId ? `${p.modelProvider}/${p.modelId}` : "");
    } catch (error) {
      useShellStore
        .getState()
        .showAppError(error instanceof Error ? error.message : "Failed to save git prefs");
    } finally {
      setLoading(false);
    }
  }

  const modelOptions = useMemo(() => {
    const opts = [
      { value: "", label: tr("git.modelDefault") },
      ...models.map((m) => ({
        value: `${m.provider}/${m.id}`,
        label: `${m.name || m.id} (${m.provider})`,
      })),
    ];
    // Keep current selection visible even if host list is empty temporarily.
    if (modelKey && !opts.some((o) => o.value === modelKey)) {
      opts.push({ value: modelKey, label: modelKey });
    }
    return opts;
  }, [models, modelKey, tr]);

  return (
    <SettingsPageShell title={tr("section.git")} testId="settings-git">
      <SettingsSectionBlock label={tr("git.settings")} testId="settings-git-options">
        <div className="settings-row items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="settings-row-title">{tr("git.model")}</div>
            <div className="settings-row-desc">{tr("git.modelHint")}</div>
          </div>
          <SettingsSelect
            testId="git-model"
            value={modelKey}
            onChange={(v) => {
              setModelKey(v);
              if (!v) {
                void persist({ modelProvider: "", modelId: "" });
                return;
              }
              const slash = v.indexOf("/");
              const provider = slash >= 0 ? v.slice(0, slash) : v;
              const id = slash >= 0 ? v.slice(slash + 1) : "";
              void persist({ modelProvider: provider, modelId: id });
            }}
            options={modelOptions}
            disabled={loading}
          />
        </div>
        <div className="settings-row !flex-col !items-stretch gap-2.5">
          <div>
            <div className="settings-row-title">{tr("git.branchPrefix")}</div>
            <div className="settings-row-desc">{tr("git.branchPrefixHint")}</div>
          </div>
          <div className="mt-1">
            <SettingsInput
              data-testid="git-branch-prefix"
              mono
              value={branchPrefix}
              placeholder={tr("git.branchPrefixPlaceholder")}
              disabled={loading}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => setBranchPrefix(e.target.value)}
              onBlur={() => void persist({ branchPrefix })}
            />
          </div>
        </div>
        <div className="settings-row items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="settings-row-title">{tr("git.pullMode")}</div>
            <div className="settings-row-desc">{tr("git.pullModeHint")}</div>
          </div>
          <SettingsSelect
            testId="git-pull-mode"
            value={pullMode}
            onChange={(v) => {
              const mode = v === "squash" ? "squash" : "merge";
              setPullMode(mode);
              void persist({ pullMode: mode });
            }}
            options={[
              { value: "merge", label: tr("git.pullMerge") },
              { value: "squash", label: tr("git.pullSquash") },
            ]}
            disabled={loading}
          />
        </div>
        <SettingsRow
          title={tr("git.forcePush")}
          description={tr("git.forcePushHint")}
          control={
            <SettingsToggle
              checked={forcePush}
              onChange={(on) => {
                setForcePush(on);
                void persist({ forcePush: on });
              }}
              testId="git-force-push"
              disabled={loading}
              aria-label={tr("git.forcePush")}
            />
          }
        />
        <SettingsRow
          title={tr("git.draftPr")}
          description={tr("git.draftPrHint")}
          control={
            <SettingsToggle
              checked={draftPr}
              onChange={(on) => {
                setDraftPr(on);
                void persist({ draftPr: on });
              }}
              testId="git-draft-pr"
              disabled={loading}
              aria-label={tr("git.draftPr")}
            />
          }
        />
        <div className="settings-row !flex-col !items-stretch gap-2.5">
          <div>
            <div className="settings-row-title">{tr("git.customCommit")}</div>
            <div className="settings-row-desc">{tr("git.customCommitHint")}</div>
          </div>
          <SettingsTextarea
            data-testid="git-custom-commit"
            value={customCommit}
            placeholder={tr("git.customCommitPlaceholder")}
            disabled={loading}
            rows={4}
            onChange={(e) => setCustomCommit(e.target.value)}
            onBlur={() => void persist({ customCommitCommand: customCommit })}
          />
        </div>
        <div className="settings-row settings-row-last !flex-col !items-stretch gap-2.5">
          <div>
            <div className="settings-row-title">{tr("git.customPr")}</div>
            <div className="settings-row-desc">{tr("git.customPrHint")}</div>
          </div>
          <SettingsTextarea
            data-testid="git-custom-pr"
            value={customPr}
            placeholder={tr("git.customPrPlaceholder")}
            disabled={loading}
            rows={4}
            onChange={(e) => setCustomPr(e.target.value)}
            onBlur={() => void persist({ customPrCommand: customPr })}
          />
        </div>
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

function BehaviorSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [confirmDelete, setConfirmDelete] = useState(loadConfirmDelete);
  const [confirmArchive, setConfirmArchive] = useState(loadConfirmArchive);
  return (
    <SettingsPageShell title={tr("section.behavior")} testId="settings-behavior">
      <SettingsSectionBlock label={tr("settings.behavior")} testId="settings-behavior-options">
        <SettingsRow
          title={tr("settings.confirmDelete")}
          description={tr("settings.confirmDeleteHint")}
          control={
            <SettingsToggle
              checked={confirmDelete}
              onChange={(next) => {
                setConfirmDelete(next);
                saveConfirmDelete(next);
              }}
              testId="settings-confirm-delete"
              aria-label={tr("settings.confirmDelete")}
            />
          }
        />
        <SettingsRow
          title={tr("settings.confirmArchive")}
          description={tr("settings.confirmArchiveHint")}
          control={
            <SettingsToggle
              checked={confirmArchive}
              onChange={(next) => {
                setConfirmArchive(next);
                saveConfirmArchive(next);
              }}
              testId="settings-confirm-archive"
              aria-label={tr("settings.confirmArchive")}
            />
          }
          last
        />
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

const USAGE_LABEL_KEYS: Record<string, MessageKey> = {
  "5h": "usage.metricSession5h",
  Weekly: "usage.metricWeekly",
  Session: "usage.metricSession",
  Sonnet: "usage.metricSonnet",
  Opus: "usage.metricOpus",
  Credits: "usage.metricCredits",
  "Key limit": "usage.metricKeyLimit",
  Chat: "usage.metricChat",
  Completions: "usage.metricCompletions",
  "Web searches": "usage.metricWebSearches",
  Balance: "usage.metricBalance",
  Today: "usage.metricToday",
  "This week": "usage.metricThisWeek",
  "This month": "usage.metricThisMonth",
  "Extra usage": "usage.metricExtraUsage",
};

function usageMetricLabel(
  label: string,
  tr: (key: MessageKey, vars?: Record<string, string>) => string,
): string {
  const key = USAGE_LABEL_KEYS[label];
  return key ? tr(key) : label;
}

function usagePercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function usageProviderDetail(
  provider: ProviderUsageSnapshot,
  tr: (key: MessageKey, vars?: Record<string, string>) => string,
): string | undefined {
  if (provider.status === "needs-auth") return tr("usage.needsAuthHint");
  if (provider.status !== "error") return provider.detail;
  const status = provider.detail?.match(/HTTP (\d{3})/)?.[1];
  return status ? tr("usage.requestFailed", { status }) : tr("usage.endpointUnavailable");
}

function UsageLimitsSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [usage, setUsage] = useState<ProviderUsageSnapshot[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestIdRef = useRef(0);

  async function refresh() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      await props.onEnsureHost();
      const snapshots = await window.pix.providers.usage();
      if (requestId === requestIdRef.current) setUsage(snapshots);
    } catch {
      if (requestId === requestIdRef.current) {
        setUsage((current) => current ?? []);
        setLoadFailed(true);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SettingsPageShell
      title={tr("section.usage")}
      testId="settings-usage"
      titleAction={
        <SettingsPillButton
          label={loading ? tr("usage.refreshing") : tr("usage.refresh")}
          testId="usage-refresh"
          disabled={loading}
          onClick={() => void refresh()}
        />
      }
    >
      {usage === undefined ? (
        <div className="usage-loading" data-testid="usage-loading" aria-label={tr("usage.loading")}>
          <span />
          <span />
        </div>
      ) : usage.length === 0 ? (
        <div className="usage-empty" data-testid="usage-empty">
          <div className="usage-empty-title">
            {loadFailed ? tr("usage.loadFailed") : tr("usage.empty")}
          </div>
          <p>{loadFailed ? tr("usage.loadFailedHint") : tr("usage.emptyHint")}</p>
        </div>
      ) : (
        <div className="usage-provider-list" data-testid="usage-limits-list">
          {usage.map((provider) => {
            const updated = formatUsageUpdatedAt(provider.updatedAt, props.locale);
            const providerDetail = usageProviderDetail(provider, tr);
            return (
              <section
                key={provider.provider}
                className="usage-provider-card"
                data-status={provider.status}
                data-testid={`usage-card-${provider.provider}`}
              >
                <header className="usage-provider-header">
                  <div className="usage-provider-identity">
                    <div className="usage-provider-name-row">
                      <h3>{provider.displayName}</h3>
                      {provider.planName ? (
                        <span className="usage-plan-pill">{provider.planName}</span>
                      ) : null}
                    </div>
                    <div className="usage-provider-meta">
                      <span>{provider.provider}</span>
                      {updated ? <span>{tr("usage.updated", { time: updated })}</span> : null}
                    </div>
                  </div>
                  <span className="usage-status-pill" data-status={provider.status}>
                    {provider.status === "ok"
                      ? tr("usage.statusLive")
                      : provider.status === "needs-auth"
                        ? tr("usage.statusNeedsAuth")
                        : tr("usage.statusError")}
                  </span>
                </header>

                {provider.status === "ok" ? (
                  <div className="usage-meter-list">
                    {provider.limits.map((limit, index) => {
                      const remaining = remainingPercent(limit);
                      const tone = usageTone(limit);
                      const cadence =
                        formatResetCountdown(limit.resetsAt, props.locale) ??
                        formatWindowDuration(limit.windowDurationMins, props.locale);
                      return (
                        <div
                          className="usage-meter"
                          data-tone={tone}
                          data-testid={`usage-limit-${provider.provider}-${index}`}
                          key={`${limit.label}-${index}`}
                        >
                          <div className="usage-meter-heading">
                            <span>{usageMetricLabel(limit.label, tr)}</span>
                            <strong>
                              {tr("usage.remaining", {
                                percent: usagePercent(remaining, props.locale),
                              })}
                            </strong>
                          </div>
                          <div
                            className="usage-meter-track"
                            role="progressbar"
                            aria-label={usageMetricLabel(limit.label, tr)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={remaining}
                          >
                            <span style={{ width: `${remaining}%` }} />
                          </div>
                          <div className="usage-meter-footnote">
                            <span>
                              {tr("usage.used", {
                                percent: usagePercent(limit.usedPercent, props.locale),
                              })}
                              {limit.detail ? ` · ${limit.detail}` : ""}
                            </span>
                            {cadence ? <span>{cadence}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {provider.usageLines.length > 0 ? (
                  <dl className="usage-line-grid">
                    {provider.usageLines.map((line, index) => (
                      <div key={`${line.label}-${index}`}>
                        <dt>{usageMetricLabel(line.label, tr)}</dt>
                        <dd>{line.value}</dd>
                        {line.subtitle ? <small>{line.subtitle}</small> : null}
                      </div>
                    ))}
                  </dl>
                ) : null}

                {provider.status === "ok" &&
                provider.limits.length === 0 &&
                provider.usageLines.length === 0 ? (
                  <p className="usage-provider-detail">{tr("usage.noData")}</p>
                ) : providerDetail ? (
                  <p className="usage-provider-detail">{providerDetail}</p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </SettingsPageShell>
  );
}

function GeneralSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [preventSleep, setPreventSleep] = useState(loadPreventSleep);
  const [suggestions, setSuggestions] = useState(loadSuggestions);
  const visibility = props.accessVisibility;
  const trusted = Boolean(props.snapshot?.projectTrusted);

  function setVisibility(key: keyof AccessVisibility, on: boolean) {
    props.onAccessVisibility({ ...visibility, [key]: on });
  }

  return (
    <SettingsPageShell title={tr("section.general")} testId="settings-general">
      <SettingsSectionBlock label={tr("settings.permissions")} testId="settings-permissions">
        <SettingsRow
          title={tr("settings.defaultAccess")}
          description={tr("settings.defaultAccessHint")}
          control={
            <SettingsToggle
              checked={visibility.default}
              onChange={(on) => setVisibility("default", on)}
              testId="settings-default-access"
              aria-label={tr("settings.defaultAccess")}
            />
          }
        />
        <SettingsRow
          title={tr("settings.autoReview")}
          description={tr("settings.autoReviewHint")}
          control={
            <SettingsToggle
              checked={visibility.autoReview}
              onChange={(on) => setVisibility("autoReview", on)}
              testId="settings-auto-review"
              aria-label={tr("settings.autoReview")}
            />
          }
        />
        <SettingsRow
          title={tr("settings.fullAccess")}
          description={tr("settings.fullAccessHint")}
          control={
            <SettingsToggle
              checked={visibility.full}
              onChange={(on) => setVisibility("full", on)}
              testId="settings-full-access"
              aria-label={tr("settings.fullAccess")}
            />
          }
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("settings.section.general")} testId="settings-general-card">
        <SettingsRow
          title={tr("settings.projectTrusted")}
          description={tr("settings.projectTrustedHint")}
          control={
            <SettingsToggle
              checked={trusted}
              onChange={() => props.onToggleTrust()}
              disabled={!props.snapshot}
              testId="settings-project-trust"
              aria-label={tr("settings.projectTrusted")}
            />
          }
        />
        <SettingsRow
          title={tr("settings.language")}
          description={tr("settings.languageHint")}
          control={
            <SettingsSelect
              testId="appearance-locale"
              value={props.locale}
              onChange={(v) => props.onLocale(v as Locale)}
              options={[
                { value: "zh", label: tr("appearance.languageZh") },
                { value: "en", label: tr("appearance.languageEn") },
              ]}
            />
          }
        />
        <SettingsRow
          title={tr("settings.preventSleep")}
          description={tr("settings.preventSleepHint")}
          control={
            <SettingsToggle
              checked={preventSleep}
              onChange={(next) => {
                setPreventSleep(next);
                savePreventSleep(next);
              }}
              testId="settings-prevent-sleep"
              aria-label={tr("settings.preventSleep")}
            />
          }
        />
        <SettingsRow
          title={tr("settings.suggestions")}
          description={tr("settings.suggestionsHint")}
          control={
            <SettingsToggle
              checked={suggestions}
              onChange={(next) => {
                setSuggestions(next);
                saveSuggestions(next);
              }}
              testId="settings-suggestions"
              aria-label={tr("settings.suggestions")}
            />
          }
        />
        <SettingsRow
          title={tr("settings.importAgent")}
          description={tr("settings.importAgentHint")}
          control={<SettingsPillButton label={tr("settings.importAgain")} disabled />}
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("settings.section.editor")} testId="settings-editor">
        <SettingsRow
          title={tr("settings.showContextUsage")}
          description={tr("settings.showContextUsageHint")}
          control={
            <SettingsToggle
              checked={props.showContextUsage}
              onChange={props.onShowContextUsage}
              testId="settings-show-context-usage"
              aria-label={tr("settings.showContextUsage")}
            />
          }
          last
        />
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

function AppearanceSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;

  return (
    <SettingsPageShell title={tr("section.appearance")} testId="settings-appearance">
      <SettingsSectionBlock label={tr("appearance.theme")}>
        <SettingsRow
          title={tr("appearance.theme")}
          description={tr("settings.themeHint")}
          control={
            <SettingsSelect
              testId="appearance-theme"
              value={props.themePreference}
              onChange={(v) => props.onThemePreference(v as ThemePreference)}
              options={[
                { value: "system", label: tr("appearance.themeSystem") },
                { value: "dark", label: tr("appearance.themeDark") },
                { value: "light", label: tr("appearance.themeLight") },
              ]}
            />
          }
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("appearance.sidebarTranslucent")}>
        <SettingsRow
          title={tr("appearance.sidebarTranslucent")}
          description={tr("appearance.sidebarTranslucentHint")}
          control={
            <SettingsToggle
              checked={props.sidebarTranslucent}
              onChange={props.onTranslucent}
              testId="appearance-translucent"
              aria-label={tr("appearance.sidebarTranslucent")}
            />
          }
        />
        <SettingsRow
          title={tr("appearance.sidebarWidth")}
          description={
            <div className="mt-2 flex items-center gap-3">
              <SettingsInput
                type="range"
                min={232}
                max={360}
                step={4}
                data-testid="appearance-sidebar-width"
                className="min-w-0 flex-1"
                value={props.sidebarWidthPx}
                onChange={(e) => props.onSidebarWidth(Number(e.target.value))}
              />
              <span className="shrink-0 tabular-nums text-[12px] text-[var(--muted-foreground)]">
                {props.sidebarWidthPx}px
              </span>
            </div>
          }
          control={<span className="sr-only">{props.sidebarWidthPx}</span>}
          last
        />
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}

type OAuthPromptUpdate = Extract<ProviderOAuthUpdate, { stage: "prompt" }>;
type OAuthAuthUrlUpdate = Extract<ProviderOAuthUpdate, { stage: "auth_url" }>;
type OAuthDeviceCodeUpdate = Extract<ProviderOAuthUpdate, { stage: "device_code" }>;

interface OAuthDialogState {
  operationId: string;
  provider: string;
  displayName: string;
  prompt?: OAuthPromptUpdate;
  authUrl?: OAuthAuthUrlUpdate;
  deviceCode?: OAuthDeviceCodeUpdate;
  message?: string;
  links?: Array<{ url: string; label?: string }>;
  terminal?: "complete" | "error" | "cancelled";
}

function applyOAuthEvent(state: OAuthDialogState, event: ProviderOAuthEvent): OAuthDialogState {
  if (event.operationId !== state.operationId) return state;
  const { update } = event;
  switch (update.stage) {
    case "prompt": {
      const next = { ...state, prompt: update };
      delete next.message;
      return next;
    }
    case "auth_url":
      return { ...state, authUrl: update };
    case "device_code":
      return { ...state, deviceCode: update };
    case "info":
      return {
        ...state,
        message: update.message,
        ...(update.links ? { links: update.links } : {}),
      };
    case "progress":
      return { ...state, message: update.message };
    case "complete": {
      const next: OAuthDialogState = { ...state, terminal: "complete" };
      delete next.prompt;
      delete next.message;
      return next;
    }
    case "error": {
      const next: OAuthDialogState = { ...state, terminal: "error", message: update.message };
      delete next.prompt;
      return next;
    }
    case "cancelled": {
      const next: OAuthDialogState = { ...state, terminal: "cancelled" };
      delete next.prompt;
      delete next.message;
      return next;
    }
  }
}

function ProvidersSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [providers, setProviders] = useState<ProviderAuthSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyProvider, setKeyProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [oauthDialog, setOAuthDialog] = useState<OAuthDialogState>();
  const [oauthValue, setOAuthValue] = useState("");
  const [oauthBusy, setOAuthBusy] = useState(false);
  const oauthOperationId = useRef<string | undefined>(undefined);
  const openedOAuthUrls = useRef(new Set<string>());
  const showAppError = useShellStore((s) => s.showAppError);

  async function refreshProviders() {
    setLoading(true);
    try {
      await props.onEnsureHost();
      const list = await window.pix.providers.list();
      setProviders(list);
      if (!keyProvider && list[0]) setKeyProvider(list[0].provider);
      for (const row of list) {
        if ("key" in row || "apiKey" in row || "token" in row) {
          throw new Error("Provider projection leaked secrets");
        }
      }
    } catch (error) {
      showAppError(error instanceof Error ? error.message : "Failed to list providers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.pix.providers.onOAuthEvent((event) => {
      if (event.operationId !== oauthOperationId.current) return;
      setOAuthBusy(false);
      setOAuthDialog((current) => (current ? applyOAuthEvent(current, event) : current));
      if (event.update.stage === "prompt") setOAuthValue("");
      const url =
        event.update.stage === "auth_url"
          ? event.update.url
          : event.update.stage === "device_code"
            ? event.update.verificationUri
            : undefined;
      if (url && !openedOAuthUrls.current.has(url)) {
        openedOAuthUrls.current.add(url);
        void window.pix.workspace.openExternal(url).catch((error: unknown) => {
          showAppError(error instanceof Error ? error.message : "Failed to open OAuth URL");
        });
      }
      if (event.update.stage === "complete") {
        void window.pix.providers
          .list()
          .then(setProviders)
          .catch((error: unknown) => {
            showAppError(error instanceof Error ? error.message : "Failed to refresh providers");
          });
      }
    });
  }, [showAppError]);

  const filteredProviders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter((provider) => {
      const haystack =
        `${provider.provider} ${provider.displayName} ${provider.source ?? ""} ${provider.label ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [providers, query]);

  async function saveApiKey(event: FormEvent) {
    event.preventDefault();
    if (!keyProvider.trim() || !apiKey.trim()) {
      showAppError(tr("auth.apiKeyRequired"));
      return;
    }
    setLoading(true);
    try {
      const list = await window.pix.providers.setApiKey(keyProvider.trim(), apiKey.trim());
      setProviders(list);
      setApiKey("");
    } catch (error) {
      showAppError(error instanceof Error ? error.message : "Failed to save API key");
    } finally {
      setLoading(false);
    }
  }

  async function clearAuth(provider: string) {
    setLoading(true);
    try {
      setProviders(await window.pix.providers.clearAuth(provider));
    } catch (error) {
      showAppError(error instanceof Error ? error.message : "Failed to clear auth");
    } finally {
      setLoading(false);
    }
  }

  async function startOAuth(provider: ProviderAuthSummary) {
    const operationId = crypto.randomUUID();
    oauthOperationId.current = operationId;
    openedOAuthUrls.current.clear();
    setOAuthValue("");
    setOAuthBusy(true);
    setOAuthDialog({
      operationId,
      provider: provider.provider,
      displayName: provider.displayName,
    });
    try {
      await window.pix.providers.startOAuth(provider.provider, operationId);
    } catch (error) {
      setOAuthBusy(false);
      setOAuthDialog((current) =>
        current?.operationId === operationId
          ? {
              ...current,
              terminal: "error",
              message: error instanceof Error ? error.message : "Failed to start OAuth login",
            }
          : current,
      );
    }
  }

  async function respondOAuth(prompt: OAuthPromptUpdate, value: string, cancelled = false) {
    if (!oauthDialog) return;
    setOAuthBusy(true);
    try {
      await window.pix.providers.respondOAuth(
        oauthDialog.operationId,
        prompt.promptId,
        value,
        cancelled,
      );
    } catch (error) {
      setOAuthBusy(false);
      showAppError(error instanceof Error ? error.message : "Failed to continue OAuth login");
    }
  }

  function closeOAuthDialog() {
    const dialog = oauthDialog;
    oauthOperationId.current = undefined;
    setOAuthDialog(undefined);
    setOAuthBusy(false);
    setOAuthValue("");
    if (dialog && !dialog.terminal) {
      void window.pix.providers.cancelOAuth(dialog.operationId).catch(() => undefined);
    }
  }

  const oauthPrompt: ProviderOAuthPrompt | undefined = oauthDialog?.prompt?.prompt;

  return (
    <SettingsPageShell title={tr("section.auth")} testId="settings-providers">
      <div className="mb-3 flex items-center gap-2">
        <label className="settings-rail-search min-w-0 flex-1 !rounded-[12px]">
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
          <SettingsInput
            data-testid="providers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("auth.search")}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
        </label>
        <SettingsPillButton
          label={loading ? "…" : tr("auth.refresh")}
          testId="providers-refresh"
          onClick={() => void refreshProviders()}
          disabled={loading}
        />
      </div>

      <SettingsSectionBlock label={tr("auth.apiKey")}>
        <form
          className="settings-provider-form"
          data-testid="provider-key-form"
          onSubmit={(e) => void saveApiKey(e)}
        >
          <label className="settings-field">
            <span>{tr("auth.provider")}</span>
            <SettingsSelect
              testId="provider-select"
              fullWidth
              value={keyProvider || (providers[0]?.provider ?? "")}
              onChange={setKeyProvider}
              disabled={loading}
              options={
                providers.length === 0
                  ? [{ value: "", label: "—" }]
                  : providers.map((p) => ({ value: p.provider, label: p.displayName }))
              }
            />
          </label>
          <label className="settings-field">
            <span>{tr("auth.apiKey")}</span>
            <div className="settings-key-row">
              <SettingsInput
                data-testid="provider-api-key-input"
                type="password"
                autoComplete="off"
                className="min-w-0 flex-1"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
              />
              <SettingsButton
                type="submit"
                variant="default"
                testId="provider-save-key"
                disabled={loading || !keyProvider || !apiKey.trim()}
              >
                {loading ? tr("auth.saving") : tr("auth.saveKey")}
              </SettingsButton>
            </div>
          </label>
        </form>
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("section.auth")}>
        <div className="settings-provider-list" data-testid="providers-list">
          {filteredProviders.map((provider, index) => (
            <div
              key={provider.provider}
              className={cn(
                "settings-row",
                index === filteredProviders.length - 1 && "settings-row-last",
              )}
              data-testid={`provider-row-${provider.provider}`}
            >
              <div className="settings-row-copy min-w-0 flex-1">
                <div className="settings-row-title">{provider.displayName}</div>
                <div className="settings-row-desc">
                  {provider.provider} · {provider.modelCount}
                  {provider.source ? ` · ${provider.source}` : ""}
                  {provider.oauthActive ? ` · ${tr("auth.oauthActive")}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="settings-status-chip"
                  data-testid={`provider-configured-${provider.provider}`}
                >
                  {provider.configured ? tr("auth.configured") : tr("auth.missing")}
                </span>
                {provider.oauthSupported ? (
                  <SettingsPillButton
                    label={provider.oauthActive ? tr("auth.oauthRelogin") : tr("auth.oauthSignIn")}
                    testId={`provider-oauth-${provider.provider}`}
                    disabled={loading || Boolean(oauthDialog)}
                    onClick={() => void startOAuth(provider)}
                  />
                ) : null}
                <SettingsPillButton
                  label={tr("auth.clear")}
                  danger
                  testId={`provider-clear-${provider.provider}`}
                  disabled={loading || !provider.configured}
                  onClick={() => void clearAuth(provider.provider)}
                />
              </div>
            </div>
          ))}
          {filteredProviders.length === 0 ? (
            <div className="settings-row settings-row-last">
              <div className="settings-row-desc">
                {query.trim()
                  ? tr("auth.searchEmpty")
                  : providers.length === 0
                    ? tr("auth.listEmpty")
                    : tr("auth.searchEmpty")}
              </div>
            </div>
          ) : null}
        </div>
      </SettingsSectionBlock>

      {oauthDialog && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4"
              data-testid="provider-oauth-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="provider-oauth-dialog-title"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeOAuthDialog();
              }}
            >
              <div
                className="provider-oauth-dialog surface-panel w-full max-w-[32rem] overflow-hidden shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="provider-oauth-header">
                  <div className="provider-oauth-heading">
                    <span className="provider-oauth-icon" aria-hidden>
                      <LogIn size={17} strokeWidth={1.8} />
                    </span>
                    <div>
                      <h2 id="provider-oauth-dialog-title" className="provider-oauth-title">
                        {tr("auth.oauthTitle", { provider: oauthDialog.displayName })}
                      </h2>
                      <p>{tr("auth.oauthHint")}</p>
                    </div>
                  </div>
                  <SettingsIconButton
                    className="provider-oauth-close"
                    aria-label={tr("auth.oauthClose")}
                    onClick={closeOAuthDialog}
                  >
                    <X size={16} />
                  </SettingsIconButton>
                </div>

                <div className="provider-oauth-body">
                  {!oauthDialog.terminal && oauthDialog.authUrl ? (
                    <div className="provider-oauth-step" data-testid="provider-oauth-browser-step">
                      <div className="provider-oauth-step-copy">
                        <strong>{tr("auth.oauthBrowser")}</strong>
                        <span>
                          {oauthDialog.authUrl.instructions || tr("auth.oauthBrowserHint")}
                        </span>
                      </div>
                      <SettingsButton
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          void window.pix.workspace.openExternal(oauthDialog.authUrl?.url ?? "")
                        }
                      >
                        <ExternalLink size={13} />
                        {tr("auth.oauthOpenBrowser")}
                      </SettingsButton>
                    </div>
                  ) : null}

                  {!oauthDialog.terminal && oauthDialog.deviceCode ? (
                    <div className="provider-oauth-device" data-testid="provider-oauth-device-step">
                      <span>{tr("auth.oauthDeviceCode")}</span>
                      <SettingsButton
                        type="button"
                        variant="outline"
                        className="provider-oauth-code h-auto"
                        testId="provider-oauth-device-code"
                        onClick={() =>
                          void navigator.clipboard.writeText(oauthDialog.deviceCode?.userCode ?? "")
                        }
                      >
                        {oauthDialog.deviceCode.userCode}
                        <Copy size={14} />
                      </SettingsButton>
                      <SettingsButton
                        type="button"
                        variant="link"
                        className="provider-oauth-link h-auto p-0"
                        onClick={() =>
                          void window.pix.workspace.openExternal(
                            oauthDialog.deviceCode?.verificationUri ?? "",
                          )
                        }
                      >
                        {oauthDialog.deviceCode.verificationUri}
                        <ExternalLink size={12} />
                      </SettingsButton>
                    </div>
                  ) : null}

                  {oauthDialog.message ? (
                    <div
                      className={cn(
                        "provider-oauth-message",
                        oauthDialog.terminal === "error" && "provider-oauth-message-error",
                      )}
                      data-testid="provider-oauth-message"
                    >
                      <p className="m-0">{oauthDialog.message}</p>
                      {oauthDialog.terminal === "error" &&
                      /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|proxy/i.test(
                        oauthDialog.message,
                      ) ? (
                        <p
                          className="m-0 mt-2 opacity-90"
                          data-testid="provider-oauth-network-hint"
                        >
                          {tr("auth.oauthNetworkHint")}
                          {oauthDialog.provider === "xai"
                            ? ` ${tr("auth.oauthNetworkHintXai")}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {!oauthDialog.terminal && oauthDialog.links?.length ? (
                    <div className="provider-oauth-links">
                      {oauthDialog.links.map((link) => (
                        <SettingsButton
                          key={link.url}
                          type="button"
                          variant="link"
                          className="h-auto p-0"
                          onClick={() => void window.pix.workspace.openExternal(link.url)}
                        >
                          {link.label || link.url}
                          <ExternalLink size={12} />
                        </SettingsButton>
                      ))}
                    </div>
                  ) : null}

                  {oauthDialog.terminal === "complete" ? (
                    <div className="provider-oauth-result" data-testid="provider-oauth-complete">
                      <span className="provider-oauth-result-icon provider-oauth-result-success">
                        <Check size={19} strokeWidth={2} />
                      </span>
                      <div>
                        <strong>{tr("auth.oauthSuccess")}</strong>
                        <p>{tr("auth.oauthSuccessHint")}</p>
                      </div>
                    </div>
                  ) : oauthDialog.terminal === "cancelled" ? (
                    <div className="provider-oauth-result" data-testid="provider-oauth-cancelled">
                      <span className="provider-oauth-result-icon">
                        <X size={18} />
                      </span>
                      <div>
                        <strong>{tr("auth.oauthCancelled")}</strong>
                      </div>
                    </div>
                  ) : null}

                  {!oauthDialog.terminal && oauthPrompt?.type === "select" ? (
                    <div className="provider-oauth-prompt" data-testid="provider-oauth-select">
                      <strong>{oauthPrompt.message}</strong>
                      <div className="provider-oauth-options">
                        {oauthPrompt.options.map((option) => (
                          <SettingsButton
                            key={option.id}
                            type="button"
                            variant="outline"
                            className="h-auto w-full justify-between"
                            disabled={oauthBusy}
                            onClick={() => void respondOAuth(oauthDialog.prompt!, option.id, false)}
                          >
                            <span className="flex min-w-0 flex-col items-start text-left">
                              <span>{option.label}</span>
                              {option.description ? <small>{option.description}</small> : null}
                            </span>
                            <ChevronRight size={15} />
                          </SettingsButton>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!oauthDialog.terminal && oauthPrompt && oauthPrompt.type !== "select" ? (
                    <form
                      className="provider-oauth-prompt"
                      data-testid="provider-oauth-prompt"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (oauthDialog.prompt) {
                          void respondOAuth(oauthDialog.prompt, oauthValue, false);
                        }
                      }}
                    >
                      <label htmlFor="provider-oauth-input">{oauthPrompt.message}</label>
                      <div className="provider-oauth-input-row">
                        <SettingsInput
                          id="provider-oauth-input"
                          data-testid="provider-oauth-input"
                          type={oauthPrompt.type === "secret" ? "password" : "text"}
                          value={oauthValue}
                          placeholder={oauthPrompt.placeholder}
                          autoComplete="off"
                          autoFocus
                          disabled={oauthBusy}
                          onChange={(event) => setOAuthValue(event.target.value)}
                        />
                        <SettingsButton
                          type="submit"
                          variant="default"
                          testId="provider-oauth-continue"
                          disabled={oauthBusy}
                        >
                          {tr("auth.oauthContinue")}
                        </SettingsButton>
                      </div>
                    </form>
                  ) : null}

                  {!oauthDialog.terminal && !oauthPrompt ? (
                    <div className="provider-oauth-waiting" data-testid="provider-oauth-waiting">
                      <LoaderCircle className="animate-spin" size={16} />
                      <span>{tr("auth.oauthWaiting")}</span>
                    </div>
                  ) : null}
                </div>

                <div className="provider-oauth-footer">
                  <SettingsPillButton
                    label={oauthDialog.terminal ? tr("auth.oauthClose") : tr("common.cancel")}
                    onClick={closeOAuthDialog}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </SettingsPageShell>
  );
}

const CUSTOM_MODEL_API_OPTIONS: Array<{ value: CustomModelApi; label: string }> = [
  { value: "openai-completions", label: "openai-completions" },
  { value: "openai-responses", label: "openai-responses" },
  { value: "anthropic-messages", label: "anthropic-messages" },
  { value: "google-generative-ai", label: "google-generative-ai" },
];

function ModelsSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [scopedModels, setScopedModels] = useState<
    Array<{ provider: string; id: string; name?: string }>
  >([]);
  /** Editable enabledModels patterns (pi scope). */
  const [scopedPatternsText, setScopedPatternsText] = useState("");
  const [scopedSelected, setScopedSelected] = useState<Set<string>>(() => new Set());
  const [scopedBusy, setScopedBusy] = useState(false);
  const [defaultKey, setDefaultKey] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  /** When set, dialog is editing this models.json entry. */
  const [editingOrigin, setEditingOrigin] = useState<{ provider: string; modelId: string } | null>(
    null,
  );
  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<CustomModelApi>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [authHeader, setAuthHeader] = useState(false);
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "text-image">("text");
  const [contextWindow, setContextWindow] = useState("128000");
  const [maxTokens, setMaxTokens] = useState("16384");
  const [costInput, setCostInput] = useState("0");
  const [costOutput, setCostOutput] = useState("0");
  const [costCacheRead, setCostCacheRead] = useState("0");
  const [costCacheWrite, setCostCacheWrite] = useState("0");
  const sessionKey =
    props.snapshot?.model != null
      ? `${props.snapshot.model.provider}/${props.snapshot.model.id}`
      : "";

  const showAppError = useShellStore((s) => s.showAppError);

  function showError(err: unknown, fallback: string) {
    const raw = err instanceof Error ? err.message : fallback;
    const message =
      raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, "").trim() || fallback;
    showAppError(message);
  }

  function parseOptionalNumber(raw: string): number | undefined {
    const t = raw.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }

  function resetCustomForm() {
    setEditingOrigin(null);
    setProviderId("");
    setBaseUrl("");
    setApi("openai-completions");
    setApiKey("");
    setAuthHeader(false);
    setModelId("");
    setModelName("");
    setReasoning(false);
    setInputMode("text");
    setContextWindow("128000");
    setMaxTokens("16384");
    setCostInput("0");
    setCostOutput("0");
    setCostCacheRead("0");
    setCostCacheWrite("0");
  }

  async function refresh() {
    setLoading(true);
    try {
      await props.onEnsureHost();
      // Prefer catalog reload so models.json / extension providers re-resolve (#16/#17).
      const [list, settings, scoped] = await Promise.all([
        window.pix.models.refreshCatalog().catch(() => window.pix.models.list()),
        window.pix.settings.get(),
        window.pix.models.listScoped().catch(() => []),
      ]);
      setModels(list);
      setScopedModels(scoped);
      const patterns = settings.enabledModels ?? [];
      setScopedPatternsText(patterns.join("\n"));
      const selected = new Set<string>();
      for (const pattern of patterns) {
        // Exact provider/id pattern → tick matching checkbox.
        if (pattern.includes("/") && !pattern.includes("*") && !pattern.includes("?")) {
          const bare = pattern.split(":")[0] ?? pattern;
          selected.add(bare);
        }
      }
      for (const item of scoped) {
        selected.add(`${item.provider}/${item.id}`);
      }
      setScopedSelected(selected);
      setDefaultKey(
        settings.defaultProvider && settings.defaultModel
          ? `${settings.defaultProvider}/${settings.defaultModel}`
          : "",
      );
    } catch (err) {
      showError(err, "Failed to list models");
    } finally {
      setLoading(false);
    }
  }

  function toggleScopedModel(provider: string, id: string) {
    const key = `${provider}/${id}`;
    setScopedSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Keep free-form patterns that are not exact model keys.
      const freeform = scopedPatternsText
        .split(/[\n,]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => {
          if (line.includes("*") || line.includes("?")) return true;
          const bare = (line.split(":")[0] ?? line).trim();
          return !next.has(bare) && bare !== key && !bare.includes("/");
        });
      const exact = [...next];
      setScopedPatternsText([...exact, ...freeform].join("\n"));
      return next;
    });
  }

  async function saveScopedModels(patterns: string[]) {
    setScopedBusy(true);
    try {
      await props.onEnsureHost();
      await window.pix.settings.patch({ enabledModels: patterns });
      await refresh();
      useShellStore.getState().setStatus(tr("models.scopedSaved"));
    } catch (err) {
      showError(err, tr("models.scopedSaveFailed"));
    } finally {
      setScopedBusy(false);
    }
  }

  function patternsFromEditor(): string[] {
    return scopedPatternsText
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !dialogBusy) {
        ev.preventDefault();
        setDialogOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialogOpen, dialogBusy]);

  function openCustomDialog() {
    resetCustomForm();
    setDialogOpen(true);
  }

  async function openEditCustomDialog(model: ModelSummary) {
    resetCustomForm();
    setEditingOrigin({ provider: model.provider, modelId: model.id });
    setProviderId(model.provider);
    setModelId(model.id);
    setModelName(model.name || model.id);
    setReasoning(Boolean(model.reasoning));
    setDialogOpen(true);
    setDialogBusy(true);
    try {
      await props.onEnsureHost();
      const config = await window.pix.models.getConfig();
      const provider = config.providers.find((row) => row.provider === model.provider);
      if (!provider) {
        showError(new Error("Model not found in models.json"), "Custom model missing");
        return;
      }
      if (provider.baseUrl) setBaseUrl(provider.baseUrl);
      if (
        provider.api === "openai-completions" ||
        provider.api === "openai-responses" ||
        provider.api === "anthropic-messages" ||
        provider.api === "google-generative-ai"
      ) {
        setApi(provider.api);
      }
      setAuthHeader(provider.authHeader === true);
      const entry = provider.models.find((row) => row.id === model.id);
      if (entry) {
        if (entry.name) setModelName(entry.name);
        if (typeof entry.reasoning === "boolean") setReasoning(entry.reasoning);
        if (entry.input === "text" || entry.input === "text-image") setInputMode(entry.input);
        if (entry.contextWindow != null) setContextWindow(String(entry.contextWindow));
        if (entry.maxTokens != null) setMaxTokens(String(entry.maxTokens));
        if (entry.costInput != null) setCostInput(String(entry.costInput));
        if (entry.costOutput != null) setCostOutput(String(entry.costOutput));
        if (entry.costCacheRead != null) setCostCacheRead(String(entry.costCacheRead));
        if (entry.costCacheWrite != null) setCostCacheWrite(String(entry.costCacheWrite));
      }
    } catch (err) {
      showError(err, "Failed to load custom model");
    } finally {
      setDialogBusy(false);
    }
  }

  function closeCustomDialog() {
    if (dialogBusy) return;
    setDialogOpen(false);
    setEditingOrigin(null);
  }

  async function useInSession(model: ModelSummary) {
    setLoading(true);
    try {
      await window.pix.models.set(model.provider, model.id);
      await refresh();
    } catch (err) {
      showError(err, "Failed to set model");
    } finally {
      setLoading(false);
    }
  }

  async function setAsDefault(model: ModelSummary) {
    setLoading(true);
    try {
      await window.pix.settings.patch({
        defaultProvider: model.provider,
        defaultModel: model.id,
      });
      setDefaultKey(`${model.provider}/${model.id}`);
    } catch (err) {
      showError(err, "Failed to save default");
    } finally {
      setLoading(false);
    }
  }

  async function saveCustomProvider(event: FormEvent) {
    event.preventDefault();
    if (!providerId.trim() || !baseUrl.trim() || !modelId.trim()) {
      showAppError(tr("models.customRequired"));
      return;
    }
    setDialogBusy(true);
    try {
      await props.onEnsureHost();
      const payload: Parameters<typeof window.pix.models.upsertCustomProvider>[0] = {
        provider: providerId.trim(),
        baseUrl: baseUrl.trim(),
        api,
        modelId: modelId.trim(),
        input: inputMode,
      };
      if (modelName.trim()) payload.modelName = modelName.trim();
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      // Always persist authHeader when editing so unchecking clears models.json flag.
      payload.authHeader = authHeader;
      if (reasoning) payload.reasoning = true;
      const ctx = parseOptionalNumber(contextWindow);
      if (ctx != null) payload.contextWindow = ctx;
      const maxOut = parseOptionalNumber(maxTokens);
      if (maxOut != null) payload.maxTokens = maxOut;
      const cIn = parseOptionalNumber(costInput);
      if (cIn != null) payload.costInput = cIn;
      const cOut = parseOptionalNumber(costOutput);
      if (cOut != null) payload.costOutput = cOut;
      const cRead = parseOptionalNumber(costCacheRead);
      if (cRead != null) payload.costCacheRead = cRead;
      const cWrite = parseOptionalNumber(costCacheWrite);
      if (cWrite != null) payload.costCacheWrite = cWrite;
      if (editingOrigin) {
        payload.previousProvider = editingOrigin.provider;
        payload.previousModelId = editingOrigin.modelId;
      }
      await window.pix.models.upsertCustomProvider(payload);
      resetCustomForm();
      setDialogOpen(false);
      await refresh();
    } catch (err) {
      showError(err, "Failed to save custom model");
    } finally {
      setDialogBusy(false);
    }
  }

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => {
      const haystack = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [models, query]);

  const builtinModels = useMemo(
    () => filteredModels.filter((model) => model.source !== "custom"),
    [filteredModels],
  );
  const customModels = useMemo(
    () => filteredModels.filter((model) => model.source === "custom"),
    [filteredModels],
  );

  /** Same grouping as composer model picker (brand-cased provider labels). */
  const builtinProviderGroups = useMemo(
    () => groupModelsByProvider(builtinModels, tr("models.group.custom")),
    [builtinModels, props.locale],
  );

  function renderModelRow(
    model: ModelSummary,
    options?: { last?: boolean; hideProviderPrefix?: boolean; allowEdit?: boolean },
  ) {
    const key = `${model.provider}/${model.id}`;
    const isDefault = defaultKey === key;
    const isSession = sessionKey === key;
    return (
      <div
        key={key}
        className={cn(
          "settings-row",
          options?.last && "settings-row-last",
          (isDefault || isSession) && "bg-[color-mix(in_srgb,var(--ring,#0a84ff)_6%,transparent)]",
        )}
        data-testid={`model-row-${model.provider}-${model.id}`}
        data-default={isDefault ? "true" : "false"}
        data-session={isSession ? "true" : "false"}
      >
        <div className="settings-row-copy min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="settings-row-title truncate">{model.name || model.id}</span>
            {isDefault ? (
              <span className="settings-model-badge settings-model-badge-default">
                {tr("models.badgeDefault")}
              </span>
            ) : null}
            {isSession ? (
              <span className="settings-model-badge settings-model-badge-session">
                {tr("models.badgeSession")}
              </span>
            ) : null}
          </div>
          <div className="settings-row-desc">
            {options?.hideProviderPrefix ? model.id : `${model.provider}/${model.id}`}
            {model.reasoning ? " · reasoning" : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {options?.allowEdit ? (
            <SettingsPillButton
              label={tr("models.customEdit")}
              disabled={loading || dialogBusy}
              onClick={() => void openEditCustomDialog(model)}
              testId={`model-edit-${model.provider}-${model.id}`}
            />
          ) : null}
          <SettingsPillButton
            label={tr("models.useSession")}
            disabled={loading || isSession}
            onClick={() => void useInSession(model)}
            testId={`model-use-${model.id}`}
          />
          <SettingsPillButton
            label={tr("models.setDefault")}
            disabled={loading || isDefault}
            onClick={() => void setAsDefault(model)}
            testId={`model-default-${model.id}`}
          />
        </div>
      </div>
    );
  }

  function renderModelRows(
    list: ModelSummary[],
    emptyLabel: string,
    options?: { allowEdit?: boolean },
  ) {
    if (list.length === 0) {
      return (
        <div className="settings-row settings-row-last">
          <div className="settings-row-desc">{emptyLabel}</div>
        </div>
      );
    }
    return list.map((model, index) =>
      renderModelRow(model, {
        last: index === list.length - 1,
        ...(options?.allowEdit ? { allowEdit: true } : {}),
      }),
    );
  }

  const searching = query.trim().length > 0;

  /**
   * Built-in providers as first-class settings groups (same chrome as other config cards).
   * Models render as normal settings rows under each provider label.
   */
  function renderBuiltinProviderSections(emptyLabel: string) {
    // builtinProviderGroups only contains non-custom (same as Settings list of catalog providers).
    if (builtinProviderGroups.length === 0) {
      return (
        <SettingsSectionBlock label={tr("models.group.builtin")} testId="models-builtin">
          <div className="settings-row settings-row-last">
            <div className="settings-row-desc">{emptyLabel}</div>
          </div>
        </SettingsSectionBlock>
      );
    }
    return (
      <>
        {builtinProviderGroups.map((group) => (
          <SettingsSectionBlock
            key={group.key}
            label={group.label}
            testId={`models-builtin-group-${group.key}`}
          >
            <div data-testid={`models-list-${group.key}`}>
              {group.models.map((model, index) =>
                renderModelRow(model, {
                  last: index === group.models.length - 1,
                  hideProviderPrefix: true,
                }),
              )}
            </div>
          </SettingsSectionBlock>
        ))}
      </>
    );
  }

  return (
    <SettingsPageShell title={tr("section.models")} testId="settings-models">
      <div className="mb-3 flex items-center gap-2">
        <label className="settings-rail-search min-w-0 flex-1 !rounded-[12px]">
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
          <SettingsInput
            data-testid="models-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("models.search")}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
        </label>
        <SettingsPillButton
          label={tr("models.customAdd")}
          onClick={openCustomDialog}
          disabled={loading}
          testId="models-add-custom"
        />
        <SettingsPillButton
          label={loading ? "…" : tr("auth.refresh")}
          onClick={() => void refresh()}
          disabled={loading}
          testId="models-refresh"
        />
      </div>

      <SettingsSectionBlock label={tr("models.group.scoped")} testId="models-scoped">
        <div className="space-y-3 px-3 py-3">
          <p className="text-[12px] leading-relaxed text-[var(--text-subtle)]">
            {tr("models.scopedHint")}
          </p>
          {scopedModels.length > 0 ? (
            <div data-testid="models-scoped-list">
              <div className="mb-1 text-[11px] font-medium text-[var(--text-subtle)]">
                {tr("models.scopedActive")}
              </div>
              <div className="space-y-1 text-xs">
                {scopedModels.map((model) => (
                  <div key={`${model.provider}/${model.id}`}>
                    {model.provider}/{model.id}
                    {model.name ? ` · ${model.name}` : ""}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs opacity-60" data-testid="models-scoped-empty">
              {tr("models.scopedEmpty")}
            </div>
          )}
          <div>
            <div className="mb-1 text-[11px] font-medium text-[var(--text-subtle)]">
              {tr("models.scopedPatterns")}
            </div>
            <SettingsTextarea
              data-testid="models-scoped-patterns"
              className="min-h-[88px] w-full font-mono text-sm"
              value={scopedPatternsText}
              onChange={(e) => setScopedPatternsText(e.target.value)}
              placeholder={tr("models.scopedPatternsPh")}
              disabled={loading || scopedBusy}
            />
            <div className="mt-1 text-[11px] opacity-60">
              {tr("models.scopedCount", {
                count: String(patternsFromEditor().length),
              })}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-[var(--text-subtle)]">
              {tr("models.scopedPick")}
            </div>
            <div
              className="pix-scroll max-h-[220px] space-y-0.5 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border)] p-1"
              data-testid="models-scoped-picker"
            >
              {models.length === 0 ? (
                <div className="px-2 py-3 text-xs opacity-60">{tr("models.empty")}</div>
              ) : (
                models.map((model) => {
                  const key = `${model.provider}/${model.id}`;
                  const checked = scopedSelected.has(key);
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[12px]",
                        checked ? "bg-[var(--hover-fill)]" : "hover:bg-[var(--hover-fill)]",
                      )}
                    >
                      <SettingsInput
                        type="checkbox"
                        className="size-3.5 shrink-0"
                        checked={checked}
                        disabled={loading || scopedBusy}
                        onChange={() => toggleScopedModel(model.provider, model.id)}
                        data-testid={`models-scoped-check-${model.provider}-${model.id}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {model.name || model.id}
                      </span>
                      <span className="shrink-0 truncate text-[11px] text-[var(--text-subtle)]">
                        {model.provider}/{model.id}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SettingsPillButton
              label={scopedBusy ? tr("models.scopedSaving") : tr("models.scopedSave")}
              testId="models-scoped-save"
              disabled={loading || scopedBusy}
              onClick={() => void saveScopedModels(patternsFromEditor())}
            />
            <SettingsPillButton
              label={tr("models.scopedClear")}
              testId="models-scoped-clear"
              disabled={loading || scopedBusy}
              onClick={() => {
                setScopedPatternsText("");
                setScopedSelected(new Set());
                void saveScopedModels([]);
              }}
            />
          </div>
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("models.group.custom")} testId="models-custom">
        <div data-testid="models-list-custom">
          {renderModelRows(
            customModels,
            searching ? tr("models.searchEmpty") : tr("models.group.customEmpty"),
            { allowEdit: true },
          )}
        </div>
      </SettingsSectionBlock>

      {renderBuiltinProviderSections(
        searching ? tr("models.searchEmpty") : tr("models.group.builtinEmpty"),
      )}

      {dialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4"
              data-testid="models-custom-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="models-custom-dialog-title"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeCustomDialog();
              }}
            >
              <div
                className="models-custom-dialog surface-panel flex max-h-[min(88vh,720px)] w-full max-w-[40rem] flex-col overflow-hidden shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="models-custom-dialog-header">
                  <h2 id="models-custom-dialog-title" className="models-custom-dialog-title">
                    {editingOrigin ? tr("models.customEditTitle") : tr("models.customAdd")}
                  </h2>
                </div>

                <form
                  className="flex min-h-0 flex-1 flex-col"
                  data-testid="models-custom-form"
                  onSubmit={(e) => void saveCustomProvider(e)}
                >
                  <div className="models-custom-dialog-body pix-scroll">
                    <div className="models-custom-form-grid">
                      <label className="models-custom-field">
                        <span>{tr("models.customProvider")}</span>
                        <SettingsInput
                          data-testid="models-custom-provider"
                          value={providerId}
                          onChange={(e) => setProviderId(e.target.value)}
                          placeholder={tr("models.customProviderPh")}
                          disabled={dialogBusy}
                          autoComplete="off"
                          autoFocus
                        />
                      </label>
                      <label className="models-custom-field">
                        <span>{tr("models.customApi")}</span>
                        <SettingsSelect
                          testId="models-custom-api"
                          fullWidth
                          value={api}
                          onChange={(v) => setApi(v as CustomModelApi)}
                          disabled={dialogBusy}
                          options={CUSTOM_MODEL_API_OPTIONS.map((opt) => ({
                            value: opt.value,
                            label: opt.label,
                          }))}
                        />
                      </label>
                      <label className="models-custom-field models-custom-field-span">
                        <span>{tr("models.customBaseUrl")}</span>
                        <SettingsInput
                          data-testid="models-custom-base-url"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder={tr("models.customBaseUrlPh")}
                          disabled={dialogBusy}
                          autoComplete="off"
                        />
                      </label>
                      <label className="models-custom-field models-custom-field-span">
                        <span>{tr("models.customApiKey")}</span>
                        <SettingsInput
                          data-testid="models-custom-api-key"
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={tr("models.customApiKeyPh")}
                          disabled={dialogBusy}
                          autoComplete="off"
                        />
                      </label>
                      <label className="models-custom-field">
                        <span>{tr("models.customModelId")}</span>
                        <SettingsInput
                          data-testid="models-custom-model-id"
                          value={modelId}
                          onChange={(e) => setModelId(e.target.value)}
                          placeholder={tr("models.customModelIdPh")}
                          disabled={dialogBusy}
                          autoComplete="off"
                        />
                      </label>
                      <label className="models-custom-field">
                        <span>{tr("models.customModelName")}</span>
                        <SettingsInput
                          data-testid="models-custom-model-name"
                          value={modelName}
                          onChange={(e) => setModelName(e.target.value)}
                          disabled={dialogBusy}
                          autoComplete="off"
                        />
                      </label>
                      <label className="models-custom-field">
                        <span>{tr("models.customContextWindow")}</span>
                        <SettingsInput
                          data-testid="models-custom-context-window"
                          inputMode="numeric"
                          value={contextWindow}
                          onChange={(e) => setContextWindow(e.target.value)}
                          disabled={dialogBusy}
                          autoComplete="off"
                        />
                      </label>
                      <label className="models-custom-field">
                        <span>{tr("models.customMaxTokens")}</span>
                        <SettingsInput
                          data-testid="models-custom-max-tokens"
                          inputMode="numeric"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(e.target.value)}
                          disabled={dialogBusy}
                          autoComplete="off"
                        />
                      </label>

                      <div className="models-custom-toolbar">
                        <label
                          className="models-custom-chip"
                          data-active={inputMode === "text" ? "true" : "false"}
                        >
                          <SettingsInput
                            type="radio"
                            name="models-custom-input"
                            data-testid="models-custom-input-text"
                            checked={inputMode === "text"}
                            onChange={() => setInputMode("text")}
                            disabled={dialogBusy}
                          />
                          {tr("models.customInputText")}
                        </label>
                        <label
                          className="models-custom-chip"
                          data-active={inputMode === "text-image" ? "true" : "false"}
                        >
                          <SettingsInput
                            type="radio"
                            name="models-custom-input"
                            data-testid="models-custom-input"
                            checked={inputMode === "text-image"}
                            onChange={() => setInputMode("text-image")}
                            disabled={dialogBusy}
                          />
                          {tr("models.customInputTextImage")}
                        </label>
                        <label
                          className="models-custom-check"
                          data-on={reasoning ? "true" : "false"}
                        >
                          <SettingsInput
                            type="checkbox"
                            data-testid="models-custom-reasoning"
                            checked={reasoning}
                            onChange={(e) => setReasoning(e.target.checked)}
                            disabled={dialogBusy}
                          />
                          {tr("models.customReasoning")}
                        </label>
                        <label
                          className="models-custom-check"
                          data-on={authHeader ? "true" : "false"}
                        >
                          <SettingsInput
                            type="checkbox"
                            data-testid="models-custom-auth-header"
                            checked={authHeader}
                            onChange={(e) => setAuthHeader(e.target.checked)}
                            disabled={dialogBusy}
                          />
                          {tr("models.customAuthHeader")}
                        </label>
                      </div>

                      <details className="models-custom-advanced">
                        <summary>{tr("models.customSectionAdvanced")}</summary>
                        <div className="models-custom-advanced-body">
                          <label className="models-custom-field">
                            <span>{tr("models.customCostInput")}</span>
                            <SettingsInput
                              data-testid="models-custom-cost-input"
                              inputMode="decimal"
                              value={costInput}
                              onChange={(e) => setCostInput(e.target.value)}
                              disabled={dialogBusy}
                              autoComplete="off"
                            />
                          </label>
                          <label className="models-custom-field">
                            <span>{tr("models.customCostOutput")}</span>
                            <SettingsInput
                              data-testid="models-custom-cost-output"
                              inputMode="decimal"
                              value={costOutput}
                              onChange={(e) => setCostOutput(e.target.value)}
                              disabled={dialogBusy}
                              autoComplete="off"
                            />
                          </label>
                          <label className="models-custom-field">
                            <span>{tr("models.customCostCacheRead")}</span>
                            <SettingsInput
                              data-testid="models-custom-cost-cache-read"
                              inputMode="decimal"
                              value={costCacheRead}
                              onChange={(e) => setCostCacheRead(e.target.value)}
                              disabled={dialogBusy}
                              autoComplete="off"
                            />
                          </label>
                          <label className="models-custom-field">
                            <span>{tr("models.customCostCacheWrite")}</span>
                            <SettingsInput
                              data-testid="models-custom-cost-cache-write"
                              inputMode="decimal"
                              value={costCacheWrite}
                              onChange={(e) => setCostCacheWrite(e.target.value)}
                              disabled={dialogBusy}
                              autoComplete="off"
                            />
                          </label>
                        </div>
                      </details>
                    </div>
                  </div>

                  <div className="models-custom-dialog-footer">
                    <SettingsButton
                      type="button"
                      variant="ghost"
                      testId="models-custom-cancel"
                      className="h-9 px-3.5"
                      disabled={dialogBusy}
                      onClick={closeCustomDialog}
                    >
                      {tr("common.cancel")}
                    </SettingsButton>
                    <SettingsButton
                      type="submit"
                      variant="default"
                      className="h-9 px-4"
                      testId="models-custom-save"
                      disabled={dialogBusy}
                    >
                      {dialogBusy ? tr("models.customSaving") : tr("models.customSave")}
                    </SettingsButton>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </SettingsPageShell>
  );
}

/**
 * Only surface pi settings that help the desktop GUI.
 * CLI/TUI-only options (theme, quietStartup, skill commands, free-text model ids)
 * stay in ~/.pi/agent and the Models page.
 */
function PiSettingsSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [view, setView] = useState<PiSettingsView | undefined>();
  const [loading, setLoading] = useState(false);
  const showAppError = useShellStore((s) => s.showAppError);

  async function refresh() {
    setLoading(true);
    try {
      await props.onEnsureHost();
      setView(await window.pix.settings.get());
    } catch (err) {
      showAppError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apply(patch: PiSettingsPatch) {
    setLoading(true);
    try {
      const result = await window.pix.settings.patch(patch);
      setView(result.settings);
      props.onSnapshot(result.snapshot);
    } catch (err) {
      showAppError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  }

  const thinkingLevels = view?.availableThinkingLevels?.length
    ? view.availableThinkingLevels
    : ["off", "minimal", "low", "medium", "high"];

  return (
    <SettingsPageShell title={tr("section.piSettings")} testId="settings-pi">
      <SettingsSectionBlock label={tr("piSettings.sessionDefaults")}>
        <SettingsRow
          title={tr("piSettings.defaultThinking")}
          description={tr("piSettings.defaultThinkingHint")}
          control={
            <SettingsSelect
              testId="pi-default-thinking"
              size="sm"
              value={String(view?.defaultThinkingLevel ?? "off")}
              onChange={(v) => void apply({ defaultThinkingLevel: v })}
              options={thinkingLevels.map((level) => ({ value: level, label: level }))}
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.defaultTrust")}
          description={tr("piSettings.defaultTrustHint")}
          control={
            <SettingsSelect
              testId="pi-default-trust"
              size="md"
              value={String(view?.defaultProjectTrust ?? "ask")}
              onChange={(v) => void apply({ defaultProjectTrust: v as "ask" | "always" | "never" })}
              options={[
                { value: "ask", label: tr("piSettings.trustAsk") },
                { value: "always", label: tr("piSettings.trustAlways") },
                { value: "never", label: tr("piSettings.trustNever") },
              ]}
              disabled={loading || !view}
            />
          }
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("piSettings.agentBehavior")}>
        <SettingsRow
          title={tr("piSettings.compaction")}
          description={tr("piSettings.compactionHint")}
          control={
            <SettingsToggle
              checked={Boolean(view?.compactionEnabled)}
              onChange={(on) => void apply({ compactionEnabled: on })}
              testId="pi-compaction"
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.compactionReserve")}
          description={tr("piSettings.compactionReserveHint")}
          control={
            <SettingsInput
              type="number"
              min={1024}
              step={1024}
              className="w-24 text-right tabular-nums"
              data-testid="pi-compaction-reserve"
              disabled={loading || !view}
              value={view?.compactionReserveTokens ?? 16384}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                void apply({ compactionReserveTokens: n });
              }}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.compactionKeepRecent")}
          description={tr("piSettings.compactionKeepRecentHint")}
          control={
            <SettingsInput
              type="number"
              min={1024}
              step={1024}
              className="w-24 text-right tabular-nums"
              data-testid="pi-compaction-keep"
              disabled={loading || !view}
              value={view?.compactionKeepRecentTokens ?? 20000}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                void apply({ compactionKeepRecentTokens: n });
              }}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.retry")}
          description={tr("piSettings.retryHint")}
          control={
            <SettingsToggle
              checked={Boolean(view?.retryEnabled)}
              onChange={(on) => void apply({ retryEnabled: on })}
              testId="pi-retry"
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.retryMax")}
          description={tr("piSettings.retryMaxHint")}
          control={
            <SettingsInput
              type="number"
              min={0}
              max={20}
              step={1}
              className="w-20 text-right tabular-nums"
              data-testid="pi-retry-max"
              disabled={loading || !view}
              value={view?.retryMaxRetries ?? 3}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                void apply({ retryMaxRetries: n });
              }}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.retryBaseDelay")}
          description={tr("piSettings.retryBaseDelayHint")}
          control={
            <SettingsInput
              type="number"
              min={0}
              max={60000}
              step={100}
              className="w-24 text-right tabular-nums"
              data-testid="pi-retry-base-delay"
              disabled={loading || !view}
              value={view?.retryBaseDelayMs ?? 2000}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                void apply({ retryBaseDelayMs: n });
              }}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.hideThinking")}
          description={tr("piSettings.hideThinkingHint")}
          control={
            <SettingsToggle
              checked={Boolean(view?.hideThinkingBlock)}
              onChange={(on) => void apply({ hideThinkingBlock: on })}
              testId="pi-hide-thinking"
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.thinkingBudgets")}
          description={
            view?.thinkingBudgets
              ? JSON.stringify(view.thinkingBudgets)
              : tr("piSettings.thinkingBudgetsEmpty")
          }
          control={<span className="text-xs opacity-60">{tr("piSettings.cliOnly")}</span>}
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("piSettings.queueSection")}>
        <SettingsRow
          title={tr("piSettings.steeringMode")}
          description={tr("piSettings.steeringModeHint")}
          control={
            <SettingsSelect
              testId="pi-steering-mode"
              size="md"
              value={String(view?.steeringMode ?? "all")}
              onChange={(v) => void apply({ steeringMode: v as "all" | "one-at-a-time" })}
              options={[
                { value: "all", label: tr("piSettings.queueModeAll") },
                { value: "one-at-a-time", label: tr("piSettings.queueModeOne") },
              ]}
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.followUpMode")}
          description={tr("piSettings.followUpModeHint")}
          control={
            <SettingsSelect
              testId="pi-followup-mode"
              size="md"
              value={String(view?.followUpMode ?? "all")}
              onChange={(v) => void apply({ followUpMode: v as "all" | "one-at-a-time" })}
              options={[
                { value: "all", label: tr("piSettings.queueModeAll") },
                { value: "one-at-a-time", label: tr("piSettings.queueModeOne") },
              ]}
              disabled={loading || !view}
            />
          }
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("piSettings.navSection")}>
        <SettingsRow
          title={tr("piSettings.doubleEscape")}
          description={tr("piSettings.doubleEscapeHint")}
          control={
            <SettingsSelect
              testId="pi-double-escape"
              size="md"
              value={String(view?.doubleEscapeAction ?? "fork")}
              onChange={(v) => void apply({ doubleEscapeAction: v as "fork" | "tree" | "none" })}
              options={[
                { value: "fork", label: tr("piSettings.doubleEscapeFork") },
                { value: "tree", label: tr("piSettings.doubleEscapeTree") },
                { value: "none", label: tr("piSettings.doubleEscapeNone") },
              ]}
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.treeFilter")}
          description={tr("piSettings.treeFilterHint")}
          control={
            <SettingsSelect
              testId="pi-tree-filter"
              size="lg"
              value={String(view?.treeFilterMode ?? "default")}
              onChange={(v) =>
                void apply({
                  treeFilterMode: v as
                    | "default"
                    | "no-tools"
                    | "user-only"
                    | "labeled-only"
                    | "all",
                })
              }
              options={[
                { value: "default", label: tr("piSettings.treeFilterDefault") },
                { value: "no-tools", label: tr("piSettings.treeFilterNoTools") },
                { value: "user-only", label: tr("piSettings.treeFilterUserOnly") },
                { value: "labeled-only", label: tr("piSettings.treeFilterLabeledOnly") },
                { value: "all", label: tr("piSettings.treeFilterAll") },
              ]}
              disabled={loading || !view}
            />
          }
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("piSettings.networkSection")}>
        <SettingsRow
          title={tr("piSettings.httpIdle")}
          description={tr("piSettings.httpIdleHint")}
          control={
            <SettingsSelect
              testId="pi-http-idle"
              size="sm"
              value={String(view?.httpIdleTimeoutMs ?? 60_000)}
              onChange={(v) => void apply({ httpIdleTimeoutMs: Number(v) })}
              options={[
                { value: "30000", label: tr("piSettings.httpIdle30s") },
                { value: "60000", label: tr("piSettings.httpIdle60s") },
                { value: "120000", label: tr("piSettings.httpIdle120s") },
              ]}
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.installTelemetry")}
          description={tr("piSettings.installTelemetryHint")}
          control={
            <SettingsToggle
              checked={Boolean(view?.enableInstallTelemetry)}
              onChange={(on) => void apply({ enableInstallTelemetry: on })}
              testId="pi-install-telemetry"
              disabled={loading || !view}
            />
          }
        />
        <SettingsRow
          title={tr("piSettings.analytics")}
          description={tr("piSettings.analyticsHint")}
          control={
            <SettingsToggle
              checked={Boolean(view?.enableAnalytics)}
              onChange={(on) => void apply({ enableAnalytics: on })}
              testId="pi-analytics"
              disabled={loading || !view}
            />
          }
          last
        />
      </SettingsSectionBlock>

      <SettingsSectionBlock
        label={tr("piSettings.inventorySection")}
        testId="pi-settings-inventory"
      >
        <div className="px-3 py-2 text-xs space-y-1.5" data-testid="pi-settings-inventory-list">
          <p className="m-0 mb-2 text-[12px] leading-relaxed text-[var(--text-subtle)]">
            {tr("piSettings.inventoryHint")}
          </p>
          {(view?.inventory ?? []).map((item, index, list) => (
            <div
              key={item.key}
              className={cn(
                "settings-row settings-row-flush !gap-3 !px-0 !py-1.5",
                index === list.length - 1 && "settings-row-last",
              )}
              data-testid={`pi-inventory-${item.key}`}
            >
              <div className="min-w-0">
                <code className="text-[11px]">{item.key}</code>
                <div className="break-all text-[11px] text-[var(--text-subtle)]">{item.value}</div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-[var(--text-subtle)]">
                <div>{item.source}</div>
                <div>
                  {item.writable
                    ? tr("piSettings.inventory.writable")
                    : tr("piSettings.inventory.readonly")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SettingsSectionBlock>

      {view?.degradedCapabilities?.length ? (
        <SettingsSectionBlock label={tr("piSettings.degradedSection")}>
          <div className="px-3 py-2 text-xs opacity-70 space-y-1" data-testid="pi-degraded-list">
            {view.degradedCapabilities.map((item) => {
              const key =
                item === "tui" || item.includes("TUI")
                  ? "piSettings.degraded.tui"
                  : item === "sandbox" || item.includes("sandbox") || item.includes("Container")
                    ? "piSettings.degraded.sandbox"
                    : item === "llama" || item.includes("llama")
                      ? "piSettings.degraded.llama"
                      : item === "gist" || item.includes("Gist")
                        ? "piSettings.degraded.gist"
                        : null;
              return <div key={item}>• {key ? tr(key) : item}</div>;
            })}
          </div>
        </SettingsSectionBlock>
      ) : null}
    </SettingsPageShell>
  );
}
