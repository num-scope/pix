/**
 * Product / settings left rail.
 * Hierarchy: brand → nav → projects → threads (title+recency) → settings.
 * Full collapse (width 0, no icon rail) + drag resize; expand control stays
 * fixed after macOS traffic lights. Settings mode swaps menu content.
 */
import type { HostSnapshot, SessionThreadSummary } from "@pix/contracts";
import {
  Archive,
  ArrowLeft,
  Boxes,
  KeyRound,
  Package,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import {
  MAC_TRAFFIC_LIGHT_GUTTER_PX,
  TITLEBAR_CONTROL_SIZE_PX,
  TITLEBAR_HEIGHT_PX,
  titlebarControlTopPx,
} from "../lib/desktop-chrome.ts";
import { t, type Locale, type MessageKey } from "../lib/i18n.ts";
import { SHELL_SIDEBAR } from "../lib/layout.ts";
import { clampSidebarWidth, SIDEBAR_COLLAPSED_WIDTH } from "../lib/sidebar-prefs.ts";
import { cn } from "../lib/utils.ts";
import type { SettingsSection, ShellView } from "../store/shell-store.ts";
import type { ThreadRunState } from "../lib/timeline.ts";
import { PixLogo } from "./PixLogo.tsx";
import { ProjectList } from "./ProjectList.tsx";

export interface AppSidebarProps {
  colorMode: "light" | "dark";
  themePreference?: "light" | "dark" | "system";
  locale: Locale;
  view: ShellView;
  settingsSection: SettingsSection;
  status: string;
  hostPillState: string;
  runState: ThreadRunState;
  running: boolean;
  collapsed: boolean;
  widthPx: number;
  translucent: boolean;
  snapshot: HostSnapshot | undefined;
  workspacePath: string | undefined;
  workspace: { name: string; detail?: string };
  recentWorkspaces: string[];
  threads: SessionThreadSummary[];
  /** Sessions for every project cwd (browse without switching). */
  threadsByCwd: Record<string, SessionThreadSummary[]>;
  threadTitle: string;
  packageCount: number;
  canFork: boolean;
  onOpenPalette: () => void;
  onToggleTheme: () => void;
  onToggleCollapse: () => void;
  onResizeWidth: (px: number) => void;
  onNewThread: () => void;
  onOpenPackages: () => void;
  onOpenResources: () => void;
  onOpenSettings: () => void;
  onBackToApp: () => void;
  onSettingsSection: (section: SettingsSection) => void;
  onOpenWorkspace: () => void;
  onResumeWorkspace: () => void;
  onToggleTrust: () => void;
  onOpenRecent: (path: string) => void;
  onSwitchThread: (path: string, projectCwd?: string) => void;
  onForkThread: () => void;
  onNewThreadForProject: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onRevealInFolder: (path: string) => void;
  onRefresh: () => void;
  onCrash: () => void;
  onStop: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(props.locale, key, vars);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (props.collapsed) return;
      event.preventDefault();
      const startX = event.clientX;
      const startW = props.widthPx;
      dragRef.current = { startX, startW };
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const next = clampSidebarWidth(
          dragRef.current.startW + (ev.clientX - dragRef.current.startX),
        );
        props.onResizeWidth(next);
      };
      const onUp = (ev: PointerEvent) => {
        dragRef.current = null;
        target.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [props],
  );

  const isSettings = props.view === "settings";
  const railWidth = props.collapsed ? SIDEBAR_COLLAPSED_WIDTH : props.widthPx;

  return (
    <>
      <aside
        className={cn(
          // Overlay rail so frosted glass can sample the shell/main canvas behind it.
          // Never allow horizontal scroll; full collapse uses width 0 (not an icon strip).
          "absolute inset-y-0 left-0 z-30 flex h-full min-w-0 flex-col overflow-x-hidden text-[var(--sidebar-foreground)]",
          props.collapsed
            ? "pointer-events-none border-0"
            : cn("border-r", props.translucent ? "pix-sidebar-translucent" : "pix-sidebar-opaque"),
        )}
        style={{ width: railWidth }}
        data-testid="sidebar"
        data-collapsed={props.collapsed ? "true" : "false"}
        data-translucent={props.translucent ? "true" : "false"}
        aria-hidden={props.collapsed ? true : undefined}
      >
        {!props.collapsed ? (
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden">
            {/* Product: traffic lights + collapse. Settings: gutter only (Codex rail has no collapse). */}
            <TitlebarTrafficRow
              showCollapse={!isSettings}
              onToggleCollapse={props.onToggleCollapse}
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-x-hidden px-2.5 pb-2">
              {isSettings ? (
                <SettingsRail
                  locale={props.locale}
                  section={props.settingsSection}
                  onBack={props.onBackToApp}
                  onSection={props.onSettingsSection}
                />
              ) : (
                <ProductRail {...props} tr={tr} />
              )}
            </div>

            {/* Drag resize handle */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={props.widthPx}
              aria-valuemin={SHELL_SIDEBAR.minPx}
              aria-valuemax={SHELL_SIDEBAR.maxPx}
              data-testid="sidebar-resize-handle"
              className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--sidebar-accent)] active:bg-[var(--sidebar-accent)]"
              onPointerDown={onResizePointerDown}
            />
          </div>
        ) : null}
      </aside>

      {/* Fully collapsed: expand control fixed after traffic-light gutter (Synara). */}
      {props.collapsed ? (
        <>
          <button
            type="button"
            data-testid="sidebar-collapse"
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="fixed z-50 inline-flex items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            style={{
              left: MAC_TRAFFIC_LIGHT_GUTTER_PX,
              top: titlebarControlTopPx(),
              width: TITLEBAR_CONTROL_SIZE_PX,
              height: TITLEBAR_CONTROL_SIZE_PX,
            }}
            onClick={props.onToggleCollapse}
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          {/* Keep status probe available while rail is fully tucked away. */}
          <span className="sr-only" data-testid="host-status" data-state={props.hostPillState}>
            {props.status}
          </span>
        </>
      ) : null}
    </>
  );
}

function TitlebarTrafficRow(props: { showCollapse?: boolean; onToggleCollapse: () => void }) {
  const showCollapse = props.showCollapse !== false;
  return (
    <div
      className="sidebar-traffic-row drag-region flex w-full shrink-0 items-center"
      style={{ height: TITLEBAR_HEIGHT_PX }}
      data-testid="sidebar-traffic-row"
    >
      {/* 90px gutter then collapse (Synara MAC_DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER). */}
      <div
        className="pointer-events-none shrink-0"
        style={{ width: MAC_TRAFFIC_LIGHT_GUTTER_PX }}
        aria-hidden
      />
      {showCollapse ? (
        <button
          type="button"
          data-testid="sidebar-collapse"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="inline-flex shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
          style={{
            width: TITLEBAR_CONTROL_SIZE_PX,
            height: TITLEBAR_CONTROL_SIZE_PX,
          }}
          onClick={props.onToggleCollapse}
        >
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

function ProductRail(
  props: AppSidebarProps & { tr: (key: MessageKey, vars?: Record<string, string>) => string },
) {
  const { tr } = props;
  return (
    <>
      {/* Brand row: large Pix + search only (theme in Settings). */}
      <div
        className="mb-1 flex h-10 items-center justify-between gap-2 px-1"
        data-testid="sidebar-home-header"
      >
        <button
          type="button"
          data-testid="brand-menu"
          title={tr("app.name")}
          className="flex min-w-0 items-center gap-2 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
          onClick={props.onOpenPalette}
        >
          <PixLogo className="size-5" title={tr("app.name")} />
          <span className="truncate text-[18px] leading-none font-semibold tracking-tight text-[var(--sidebar-foreground)]">
            {tr("app.name")}
          </span>
        </button>
        <IconBtn testId="open-palette" title={tr("nav.search")} onClick={props.onOpenPalette}>
          <Search className="h-4 w-4" strokeWidth={1.6} />
        </IconBtn>
        <span className="sr-only">
          <button type="button" data-testid="theme-toggle" onClick={props.onToggleTheme} />
        </span>
      </div>

      {/* Primary action — Codex "新建任务" style */}
      <nav className="mb-2 flex flex-col gap-0.5" aria-label="Primary">
        <button
          type="button"
          data-testid="start-host"
          title={tr("nav.newThread")}
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-medium text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-accent)]"
          onClick={props.onNewThread}
        >
          <SquarePen className="size-4 shrink-0 opacity-85" strokeWidth={1.6} />
          <span className="truncate">{tr("nav.newThread")}</span>
        </button>
        <NavBtn
          testId="nav-packages"
          active={props.view === "packages"}
          icon={<Package className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />}
          label={tr("nav.packages")}
          badge={String(props.packageCount)}
          onClick={props.onOpenPackages}
        />
        <NavBtn
          testId="nav-resources"
          active={props.view === "resources"}
          icon={<Boxes className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />}
          label={tr("nav.resources")}
          onClick={props.onOpenResources}
        />
      </nav>

      <ProjectList
        locale={props.locale}
        workspacePath={props.workspacePath}
        recentWorkspaces={props.recentWorkspaces}
        threads={props.threads}
        threadsByCwd={props.threadsByCwd}
        threadTitle={props.threadTitle}
        runState={props.runState}
        running={props.running}
        onOpenRecent={props.onOpenRecent}
        onNewThread={(path) => {
          if (path) props.onNewThreadForProject(path);
          else props.onNewThread();
        }}
        onSwitchThread={props.onSwitchThread}
        onRemoveRecent={props.onRemoveRecent}
        onRevealInFolder={props.onRevealInFolder}
        onOpenWorkspace={props.onOpenWorkspace}
        onForkThread={props.onForkThread}
      />

      <div className="mt-auto flex min-w-0 flex-col gap-1 border-t border-[var(--sidebar-border)] pt-2">
        <NavBtn
          testId="nav-settings"
          active={props.view === "settings"}
          icon={<SettingsIcon className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />}
          label={tr("nav.settings")}
          onClick={props.onOpenSettings}
        />
        {/* Dev probes — not product chrome; stay collapsed under Developer. */}
        <details
          className="group rounded-lg border border-transparent open:border-[var(--sidebar-border)] open:bg-[var(--sidebar-accent)]/40"
          data-testid="developer-details"
        >
          <summary
            className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-subtle)] hover:text-[var(--muted-foreground)] [&::-webkit-details-marker]:hidden"
            data-testid="developer-summary"
          >
            {tr("dev.developer")}
          </summary>
          <div className="space-y-1 px-1.5 pb-2">
            <span
              className={cn(
                "mb-1 block max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
                hostPillClass(props.hostPillState),
              )}
              data-testid="host-status"
              data-state={props.hostPillState}
              title={props.status}
            >
              {props.status}
            </span>
            <div className="flex flex-wrap gap-0.5">
              <QuietBtn
                testId="workspace-resume"
                label={tr("workspace.resume")}
                onClick={props.onResumeWorkspace}
                disabled={!props.workspacePath}
              />
              <QuietBtn
                testId="trust-toggle"
                label={`${tr("workspace.trust")}: ${props.snapshot?.projectTrusted ? tr("workspace.trustYes") : tr("workspace.trustNo")}`}
                onClick={props.onToggleTrust}
              />
              <QuietBtn
                testId="fork-thread"
                label={tr("thread.fork")}
                onClick={props.onForkThread}
                disabled={!props.canFork || props.running}
              />
              <QuietBtn
                testId="refresh-snapshot"
                label={tr("dev.snapshot")}
                onClick={props.onRefresh}
                disabled={!props.snapshot}
              />
              <QuietBtn
                testId="crash-host"
                label={tr("dev.crash")}
                onClick={props.onCrash}
                disabled={!props.snapshot}
                danger
              />
              <QuietBtn
                testId="stop-host"
                label={tr("dev.stop")}
                onClick={props.onStop}
                disabled={!props.snapshot}
              />
            </div>
          </div>
        </details>
      </div>
    </>
  );
}

function SettingsRail(props: {
  locale: Locale;
  section: SettingsSection;
  onBack: () => void;
  onSection: (section: SettingsSection) => void;
}) {
  const tr = (key: MessageKey) => t(props.locale, key);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups: Array<{
    id: string;
    labelKey: MessageKey;
    items: Array<{
      section: SettingsSection;
      testId: string;
      labelKey: MessageKey;
      icon: ReactNode;
    }>;
  }> = [
    {
      id: "personal",
      labelKey: "settings.group.personal",
      items: [
        {
          section: "general",
          testId: "settings-nav-general",
          labelKey: "section.general",
          icon: <SettingsIcon className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />,
        },
        {
          section: "appearance",
          testId: "settings-nav-appearance",
          labelKey: "section.appearance",
          icon: <Palette className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />,
        },
      ],
    },
    {
      id: "models",
      labelKey: "settings.group.models",
      items: [
        {
          section: "providers",
          testId: "settings-nav-providers",
          labelKey: "section.auth",
          icon: <KeyRound className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />,
        },
        {
          section: "models",
          testId: "settings-nav-models",
          labelKey: "section.models",
          icon: <Sparkles className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />,
        },
        {
          section: "piSettings",
          testId: "settings-nav-agent",
          labelKey: "section.piSettings",
          icon: <SlidersHorizontal className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />,
        },
      ],
    },
    {
      id: "archive",
      labelKey: "settings.group.archive",
      items: [
        {
          section: "archived",
          testId: "settings-nav-archived",
          labelKey: "section.archived",
          icon: <Archive className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />,
        },
      ],
    },
  ];

  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!q) return true;
        const label = tr(item.labelKey).toLowerCase();
        const groupLabel = tr(group.labelKey).toLowerCase();
        return label.includes(q) || groupLabel.includes(q);
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-x-hidden"
      data-testid="settings-rail"
      aria-label="Settings"
    >
      {/* Back — Codex: text + left arrow, no heavy button chrome */}
      <button
        type="button"
        data-testid="settings-back"
        className="settings-rail-back"
        onClick={props.onBack}
      >
        <ArrowLeft className="size-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <span className="truncate">{tr("nav.backToApp")}</span>
      </button>

      {/* Search — pill */}
      <div className="px-1 pt-1.5 pb-1">
        <label className="settings-rail-search">
          <Search className="size-3.5 shrink-0 text-[var(--text-subtle)]" strokeWidth={1.75} />
          <input
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("settings.search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-[var(--sidebar-foreground)] outline-none placeholder:text-[var(--text-subtle)]"
          />
        </label>
      </div>

      {/* Grouped nav */}
      <div className="pix-scroll min-h-0 min-w-0 flex-1 px-0.5 pb-3">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] text-[var(--text-subtle)]">
            {tr("settings.noMatch")}
          </p>
        ) : (
          filtered.map((group) => (
            <div key={group.id} data-testid={`settings-group-${group.id}`}>
              <p className="settings-rail-group-label">{tr(group.labelKey)}</p>
              <div className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <button
                    key={item.section}
                    type="button"
                    data-testid={item.testId}
                    data-active={props.section === item.section ? "true" : "false"}
                    title={tr(item.labelKey)}
                    className="settings-rail-item"
                    onClick={() => props.onSection(item.section)}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">{tr(item.labelKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </nav>
  );
}

function hostPillClass(state: string): string {
  if (state === "ready" || state === "settled") return "bg-emerald-500/15 text-emerald-500";
  if (state === "running") return "bg-blue-500/15 text-blue-500";
  if (state === "error" || state === "crashed") return "bg-red-500/15 text-red-500";
  return "bg-[var(--accent)] text-[var(--muted-foreground)]";
}

function IconBtn(props: {
  testId: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      title={props.title}
      aria-label={props.title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function NavBtn(props: {
  testId: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  primary?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      data-active={props.active ? "true" : "false"}
      title={props.label}
      className={cn(
        "flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors",
        props.primary
          ? "font-semibold text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]"
          : props.active
            ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]"
            : "text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
      )}
      onClick={props.onClick}
    >
      {props.icon}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.badge !== undefined ? (
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-subtle)]">
          {props.badge}
        </span>
      ) : null}
    </button>
  );
}

function QuietBtn(props: {
  testId: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      disabled={props.disabled}
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-[11px] text-[var(--text-subtle)] disabled:opacity-40",
        props.danger
          ? "hover:bg-red-500/10 hover:text-red-600"
          : "hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
