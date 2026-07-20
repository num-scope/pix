/**
 * Codex / ChatGPT–style settings content column.
 * Large left-aligned title · section labels · grouped cards with rows.
 */
import type { HostSnapshot, ModelSummary, PiSettingsPatch, PiSettingsView } from "@pix/contracts";
import { Folder, MoreHorizontal, Search, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, type Locale, type MessageKey } from "../../lib/i18n.ts";
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
import type { SettingsSection } from "../../store/shell-store.ts";
import {
  SettingsPageShell,
  SettingsPillButton,
  SettingsRow,
  SettingsSectionBlock,
  SettingsSelect,
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
    deleteThreadLocal(id);
    unarchiveThread(id);
    const m = { ...loadArchivedThreadMeta() };
    delete m[id];
    saveArchivedThreadMeta(m);
    refresh();
  }

  function deleteAllInProject(cwdKey: string) {
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
          <button
            type="button"
            className="archived-delete-all"
            data-testid="archived-delete-all"
            onClick={deleteAll}
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            {tr("settings.archived.deleteAll")}
          </button>
        ) : null
      }
    >
      <div className="archived-toolbar" data-testid="archived-toolbar">
        <label className="archived-search">
          <Search className="size-3.5 shrink-0 text-[var(--text-subtle)]" strokeWidth={1.75} />
          <input
            data-testid="archived-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("settings.archived.search")}
          />
        </label>
        <select
          className="archived-filter"
          data-testid="archived-filter-sessions"
          value="all"
          onChange={() => {
            /* reserved: all sessions only for now */
          }}
        >
          <option value="all">{tr("settings.archived.filterAll")}</option>
        </select>
        <select
          className="archived-filter"
          data-testid="archived-filter-projects"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="all">{tr("settings.archived.filterAllProjects")}</option>
          {projectOptions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
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
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                    data-testid="archived-project-menu"
                    aria-label="More"
                    onClick={() => setOpenGroupMenu((v) => (v === cwdKey ? null : cwdKey))}
                  >
                    <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
                  </button>
                  {openGroupMenu === cwdKey ? (
                    <div className="archived-group-menu-panel" role="menu">
                      <button
                        type="button"
                        className="archived-group-menu-item"
                        data-testid="archived-project-delete-all"
                        onClick={() => deleteAllInProject(cwdKey)}
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                        {tr("settings.archived.deleteProjectAll")}
                      </button>
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
                    <button
                      type="button"
                      className="archived-icon-btn"
                      data-testid={`archived-session-delete-${item.id}`}
                      title={tr("settings.archived.delete")}
                      aria-label={tr("settings.archived.delete")}
                      onClick={() => deleteSession(item.id)}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className="archived-unarchive-btn"
                      data-testid={`archived-session-unarchive-${item.id}`}
                      onClick={() => unarchiveSession(item.id)}
                    >
                      {tr("settings.archived.unarchive")}
                    </button>
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
              <input
                type="range"
                min={232}
                max={360}
                step={4}
                data-testid="appearance-sidebar-width"
                className="settings-range min-w-0 flex-1"
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

function ProvidersSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [providers, setProviders] = useState<
    Array<{
      provider: string;
      displayName: string;
      configured: boolean;
      source?: string;
      label?: string;
      modelCount: number;
      oauthAvailable: boolean;
    }>
  >([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyProvider, setKeyProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string>();
  const [formNote, setFormNote] = useState<string>();

  async function refreshProviders() {
    setLoading(true);
    setFormError(undefined);
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
      setFormError(error instanceof Error ? error.message : "Failed to list providers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setFormError(undefined);
    setFormNote(undefined);
    if (!keyProvider.trim() || !apiKey.trim()) {
      setFormError("Provider and API key are required.");
      return;
    }
    setLoading(true);
    try {
      const list = await window.pix.providers.setApiKey(keyProvider.trim(), apiKey.trim());
      setProviders(list);
      setApiKey("");
      setFormNote(`Saved key for ${keyProvider}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save API key");
    } finally {
      setLoading(false);
    }
  }

  async function clearAuth(provider: string) {
    setLoading(true);
    setFormError(undefined);
    try {
      setProviders(await window.pix.providers.clearAuth(provider));
      setFormNote(`Cleared ${provider}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to clear auth");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsPageShell title={tr("section.auth")} testId="settings-providers">
      <div className="mb-3 flex items-center gap-2">
        <label className="settings-rail-search min-w-0 flex-1 !rounded-[12px]">
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
          <input
            data-testid="providers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("auth.search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-subtle)]"
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
            <select
              data-testid="provider-select"
              className="settings-select w-full max-w-none"
              value={keyProvider}
              onChange={(e) => setKeyProvider(e.target.value)}
              disabled={loading}
            >
              {providers.length === 0 ? <option value="">—</option> : null}
              {providers.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>{tr("auth.apiKey")}</span>
            <div className="settings-key-row">
              <input
                data-testid="provider-api-key-input"
                type="password"
                autoComplete="off"
                className="settings-input settings-key-input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
              />
              <button
                type="submit"
                className="settings-primary-btn"
                data-testid="provider-save-key"
                disabled={loading || !keyProvider || !apiKey.trim()}
              >
                {loading ? tr("auth.saving") : tr("auth.saveKey")}
              </button>
            </div>
          </label>
        </form>
        {formError ? (
          <p className="settings-form-error px-4 pb-3" data-testid="provider-form-error">
            {formError}
          </p>
        ) : null}
        {formNote ? (
          <p className="settings-form-note px-4 pb-3" data-testid="provider-form-note">
            {formNote}
          </p>
        ) : null}
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
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="settings-status-chip"
                  data-testid={`provider-configured-${provider.provider}`}
                >
                  {provider.configured ? tr("auth.configured") : tr("auth.missing")}
                </span>
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
    </SettingsPageShell>
  );
}

function ModelsSection(
  props: SettingsPageProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [defaultKey, setDefaultKey] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionKey =
    props.snapshot?.model != null
      ? `${props.snapshot.model.provider}/${props.snapshot.model.id}`
      : "";

  function showError(err: unknown, fallback: string) {
    const raw = err instanceof Error ? err.message : fallback;
    const message =
      raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, "").trim() || fallback;
    window.alert(message);
  }

  async function refresh() {
    setLoading(true);
    try {
      await props.onEnsureHost();
      const [list, settings] = await Promise.all([
        window.pix.models.list(),
        window.pix.settings.get(),
      ]);
      setModels(list);
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

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function renderModelRows(list: ModelSummary[], emptyLabel: string) {
    if (list.length === 0) {
      return (
        <div className="settings-row settings-row-last">
          <div className="settings-row-desc">{emptyLabel}</div>
        </div>
      );
    }
    return list.map((model, index) => {
      const key = `${model.provider}/${model.id}`;
      const isDefault = defaultKey === key;
      const isSession = sessionKey === key;
      return (
        <div
          key={key}
          className={cn(
            "settings-row",
            index === list.length - 1 && "settings-row-last",
            (isDefault || isSession) &&
              "bg-[color-mix(in_srgb,var(--ring,#0a84ff)_6%,transparent)]",
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
              {model.provider}/{model.id}
              {model.reasoning ? " · reasoning" : ""}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
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
    });
  }

  const searching = query.trim().length > 0;

  return (
    <SettingsPageShell title={tr("section.models")} testId="settings-models">
      <div className="mb-3 flex items-center gap-2">
        <label className="settings-rail-search min-w-0 flex-1 !rounded-[12px]">
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
          <input
            data-testid="models-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("models.search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-subtle)]"
          />
        </label>
        <SettingsPillButton
          label={loading ? "…" : tr("auth.refresh")}
          onClick={() => void refresh()}
          disabled={loading}
          testId="models-refresh"
        />
      </div>

      <SettingsSectionBlock label={tr("models.group.custom")} testId="models-custom">
        <div data-testid="models-list-custom">
          {renderModelRows(
            customModels,
            searching ? tr("models.searchEmpty") : tr("models.group.customEmpty"),
          )}
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock label={tr("models.group.builtin")} testId="models-builtin">
        <div data-testid="models-list-builtin">
          {renderModelRows(
            builtinModels,
            searching ? tr("models.searchEmpty") : tr("models.group.builtinEmpty"),
          )}
        </div>
      </SettingsSectionBlock>
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
  const [error, setError] = useState<string>();

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      await props.onEnsureHost();
      setView(await window.pix.settings.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pi settings");
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
    setError(undefined);
    try {
      setView(await window.pix.settings.patch(patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  }

  const thinkingLevels = view?.availableThinkingLevels?.length
    ? view.availableThinkingLevels
    : ["off", "minimal", "low", "medium", "high"];

  return (
    <SettingsPageShell title={tr("section.piSettings")} testId="settings-pi">
      {error ? (
        <p className="settings-form-error mb-2 px-0.5" data-testid="pi-settings-error">
          {error}
        </p>
      ) : null}

      <SettingsSectionBlock label={tr("piSettings.sessionDefaults")}>
        <SettingsRow
          title={tr("piSettings.defaultThinking")}
          description={tr("piSettings.defaultThinkingHint")}
          control={
            <SettingsSelect
              testId="pi-default-thinking"
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
          last
        />
      </SettingsSectionBlock>
    </SettingsPageShell>
  );
}
