/**
 * Sidebar hierarchy:
 * - 置顶 / 项目 → expand → 会话 (sessions under that project)
 * - 对话 → 对话 list (conversations; independent section)
 *
 * Session row: hover pin/archive; right-click full menu.
 * Conversation row: same actions, 对话 wording.
 */
import type { SessionThreadSummary } from "@pix/contracts";
import {
  Archive,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SquarePen,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { anchorFromEvent, FloatingMenu, type AnchorRect } from "./FloatingMenu.tsx";
import { RenameDialog } from "./RenameDialog.tsx";
import { t, type Locale, type MessageKey } from "../lib/i18n.ts";
import {
  PROJECT_THREADS_PAGE,
  archiveProject,
  archiveThread,
  deleteThreadLocal,
  getVisibleThreadCount,
  increaseVisibleThreadCount,
  isArchivedThread,
  isDeletedThread,
  isExpandedProject,
  isPinnedProject,
  isPinnedThread,
  isUnreadThread,
  loadArchivedProjects,
  loadArchivedThreads,
  loadDeletedThreads,
  loadExpandedProjects,
  loadPinnedProjects,
  loadPinnedThreads,
  loadProjectAliases,
  loadThreadAliases,
  loadUnreadThreads,
  loadVisibleThreadCounts,
  markThreadUnread,
  partitionProjects,
  projectDisplayName,
  setProjectAlias,
  setThreadAlias,
  sortThreadsWithPins,
  threadDisplayTitle,
  toggleExpandedProject,
  togglePinnedProject,
  togglePinnedThread,
  unarchiveThread,
} from "../lib/project-prefs.ts";
import {
  loadGroupMode,
  loadProjectsSectionOpen,
  loadSortMode,
  loadThreadsSectionOpen,
  saveGroupMode,
  saveProjectsSectionOpen,
  saveSortMode,
  saveThreadsSectionOpen,
  type GroupMode,
  type SortMode,
} from "../lib/sidebar-organize.ts";
import { cn } from "../lib/utils.ts";
import { workspaceLabel } from "../lib/workspace.ts";
import type { ThreadRunState } from "../lib/timeline.ts";

export interface ProjectListProps {
  locale: Locale;
  workspacePath: string | undefined;
  recentWorkspaces: string[];
  threads: SessionThreadSummary[];
  threadsByCwd: Record<string, SessionThreadSummary[]>;
  threadTitle: string;
  runState: ThreadRunState;
  running: boolean;
  onOpenRecent: (path: string) => void;
  onNewThread: (path?: string) => void;
  onSwitchThread: (path: string, projectCwd?: string) => void;
  onRemoveRecent: (path: string) => void;
  onRevealInFolder: (path: string) => void;
  onOpenWorkspace: () => void;
  onForkThread?: () => void;
}

export function ProjectList(props: ProjectListProps) {
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(props.locale, key, vars);
  const [pinned, setPinned] = useState(loadPinnedProjects);
  const [archived, setArchived] = useState(loadArchivedProjects);
  const [aliases, setAliases] = useState(loadProjectAliases);
  const [threadAliases, setThreadAliases] = useState(loadThreadAliases);
  const [archivedThreads, setArchivedThreads] = useState(loadArchivedThreads);
  const [pinnedThreads, setPinnedThreads] = useState(loadPinnedThreads);
  const [unreadThreads, setUnreadThreads] = useState(loadUnreadThreads);
  const [deletedThreads, setDeletedThreads] = useState(loadDeletedThreads);
  const [expanded, setExpanded] = useState(loadExpandedProjects);
  const [visibleCounts, setVisibleCounts] = useState(loadVisibleThreadCounts);
  /** `project:<path>` | `thread:<id>` — content rendered in top-layer FloatingMenu */
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<AnchorRect | null>(null);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizeAnchor, setOrganizeAnchor] = useState<AnchorRect | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>(loadGroupMode);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [projectsOpen, setProjectsOpen] = useState(loadProjectsSectionOpen);
  const [threadsOpen, setThreadsOpen] = useState(loadThreadsSectionOpen);
  const [listVisible, setListVisible] = useState(PROJECT_THREADS_PAGE);
  const [renameTarget, setRenameTarget] = useState<
    | { kind: "project"; path: string; value: string }
    | { kind: "thread"; id: string; value: string }
    | null
  >(null);

  const allPaths = useMemo(() => {
    // Include pinned paths even if they drop out of "recent" so 置顶 group stays populated.
    const list: string[] = [];
    if (props.workspacePath) list.push(props.workspacePath);
    for (const p of props.recentWorkspaces) list.push(p);
    for (const p of pinned) list.push(p);
    return list;
  }, [props.workspacePath, props.recentWorkspaces, pinned]);

  const { pinned: pinnedPaths, rest: restPaths } = useMemo(
    () => partitionProjects(allPaths, pinned, archived),
    [allPaths, pinned, archived],
  );

  // Default expand active workspace when grouping by project.
  useEffect(() => {
    if (groupMode !== "project" || !props.workspacePath) return;
    if (!isExpandedProject(props.workspacePath, expanded)) {
      setExpanded(toggleExpandedProject(props.workspacePath));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspacePath, groupMode]);

  const closeMenus = useCallback(() => {
    setMenuKey(null);
    setMenuAnchor(null);
    setOrganizeOpen(false);
    setOrganizeAnchor(null);
  }, []);

  function openItemMenu(key: string, event: ReactMouseEvent) {
    event.stopPropagation();
    setOrganizeOpen(false);
    setOrganizeAnchor(null);
    if (menuKey === key) {
      setMenuKey(null);
      setMenuAnchor(null);
      return;
    }
    setMenuKey(key);
    setMenuAnchor(anchorFromEvent(event.currentTarget));
  }

  function openOrganizeMenu(event: ReactMouseEvent) {
    event.stopPropagation();
    setMenuKey(null);
    setMenuAnchor(null);
    if (organizeOpen) {
      setOrganizeOpen(false);
      setOrganizeAnchor(null);
      return;
    }
    setOrganizeOpen(true);
    setOrganizeAnchor(anchorFromEvent(event.currentTarget));
  }

  function displayName(path: string): string {
    const label = workspaceLabel(path);
    return projectDisplayName(path, aliases, label.name);
  }

  function handleToggleExpand(path: string) {
    setExpanded(toggleExpandedProject(path));
  }

  function handleTogglePin(path: string) {
    const next = togglePinnedProject(path);
    setPinned(next);
    closeMenus();
  }

  function handleRename(path: string) {
    const current = displayName(path);
    closeMenus();
    // Defer so FloatingMenu unmount doesn't swallow the dialog open.
    window.setTimeout(() => {
      setRenameTarget({ kind: "project", path, value: current });
    }, 0);
  }

  function handleArchive(path: string) {
    setArchived(archiveProject(path));
    closeMenus();
  }

  function handleRemove(path: string) {
    closeMenus();
    props.onRemoveRecent(path);
    setPinned((prev) => {
      const key = path.replace(/\\/g, "/").replace(/\/+$/, "");
      const next = prev.filter((p) => p.replace(/\\/g, "/").replace(/\/+$/, "") !== key);
      // persist pin list without removed path
      try {
        localStorage.setItem("pix.projects.pinned", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setArchived((prev) => prev.filter((p) => p !== path));
  }

  function handleReveal(path: string) {
    closeMenus();
    props.onRevealInFolder(path);
  }

  function handleRenameThread(thread: SessionThreadSummary) {
    const current = threadDisplayTitle(thread.id, threadAliases, thread.title);
    closeMenus();
    window.setTimeout(() => {
      setRenameTarget({ kind: "thread", id: thread.id, value: current });
    }, 0);
  }

  function handleTogglePinThread(id: string) {
    setPinnedThreads(togglePinnedThread(id));
    closeMenus();
  }

  function handleArchiveThread(id: string) {
    if (isArchivedThread(id, archivedThreads)) {
      setArchivedThreads(unarchiveThread(id));
    } else {
      const thread =
        props.threads.find((t) => t.id === id) ??
        Object.values(props.threadsByCwd)
          .flat()
          .find((t) => t.id === id);
      const meta: { title?: string; path?: string; cwd?: string } = {};
      if (thread) {
        meta.title = threadDisplayTitle(thread.id, threadAliases, thread.title);
        meta.path = thread.path;
        meta.cwd = thread.cwd;
      }
      setArchivedThreads(archiveThread(id, Object.keys(meta).length ? meta : undefined));
    }
    closeMenus();
  }

  function handleToggleUnread(id: string) {
    const unread = !isUnreadThread(id, unreadThreads);
    setUnreadThreads(markThreadUnread(id, unread));
    closeMenus();
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    closeMenus();
  }

  function handleDeleteThread(id: string) {
    setDeletedThreads(deleteThreadLocal(id));
    setPinnedThreads(loadPinnedThreads());
    setArchivedThreads(loadArchivedThreads());
    setUnreadThreads(loadUnreadThreads());
    closeMenus();
  }

  function openThreadContextMenu(
    thread: SessionThreadSummary,
    event: ReactMouseEvent,
    kind: "session" | "conversation" = "session",
  ) {
    event.preventDefault();
    event.stopPropagation();
    setOrganizeOpen(false);
    setOrganizeAnchor(null);
    const key = `${kind}:${thread.id}`;
    setMenuKey(key);
    setMenuAnchor({
      top: event.clientY,
      left: event.clientX,
      right: event.clientX,
      bottom: event.clientY,
      width: 0,
      height: 0,
    });
  }

  function confirmRename(value: string) {
    if (!renameTarget) return;
    if (renameTarget.kind === "project") {
      setAliases(setProjectAlias(renameTarget.path, value || undefined));
    } else {
      setThreadAliases(setThreadAlias(renameTarget.id, value || undefined));
    }
    setRenameTarget(null);
  }

  function handleNewThread(path: string | undefined, event?: ReactMouseEvent) {
    event?.stopPropagation();
    props.onNewThread(path);
  }

  function handleShowMoreProject(path: string) {
    setVisibleCounts(increaseVisibleThreadCount(path, visibleCounts));
  }

  function setGroup(mode: GroupMode) {
    setGroupMode(mode);
    saveGroupMode(mode);
    closeMenus();
  }

  function setSort(mode: SortMode) {
    setSortMode(mode);
    saveSortMode(mode);
    closeMenus();
  }

  function toggleProjects() {
    setProjectsOpen((v) => {
      saveProjectsSectionOpen(!v);
      return !v;
    });
  }

  function toggleThreads() {
    setThreadsOpen((v) => {
      saveThreadsSectionOpen(!v);
      return !v;
    });
  }

  /**
   * Named group `item` so only the hovered row shows actions —
   * not parent project when hovering a nested conversation.
   */
  function RowActions(props: { open: boolean; testIdPrefix: string; children: ReactNode }) {
    return (
      <div
        className={cn(
          "ml-auto flex shrink-0 items-center justify-end gap-0.5 transition-opacity",
          props.open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100",
        )}
        data-testid={`${props.testIdPrefix}-actions`}
      >
        {props.children}
      </div>
    );
  }

  function SectionActions(props: { open?: boolean; testIdPrefix: string; children: ReactNode }) {
    return (
      <div
        className={cn(
          "ml-auto flex shrink-0 items-center justify-end gap-0.5 transition-opacity",
          props.open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0 group-hover/section:pointer-events-auto group-hover/section:opacity-100 group-focus-within/section:pointer-events-auto group-focus-within/section:opacity-100",
        )}
        data-testid={`${props.testIdPrefix}-actions`}
      >
        {props.children}
      </div>
    );
  }

  /** kind=session → under 项目; kind=conversation → under 对话 */
  function renderThreadButton(
    thread: SessionThreadSummary,
    opts?: { indent?: boolean; kind?: "session" | "conversation" },
  ) {
    if (isDeletedThread(thread.id, deletedThreads)) return null;
    if (isArchivedThread(thread.id, archivedThreads)) return null;
    const kind = opts?.kind ?? "session";
    const title = threadDisplayTitle(thread.id, threadAliases, thread.title);
    const menuId = `${kind}:${thread.id}`;
    const showMenu = menuKey === menuId;
    const pinnedHere = isPinnedThread(thread.id, pinnedThreads);
    const unread = isUnreadThread(thread.id, unreadThreads);
    const indent = opts?.indent !== false && kind === "session";
    const pinLabel = kind === "session" ? tr("session.pin") : tr("thread.pin");
    const unpinLabel = kind === "session" ? tr("session.unpin") : tr("thread.unpin");
    const archiveLabel = kind === "session" ? tr("session.archive") : tr("thread.archive");
    const testPrefix = kind === "session" ? "session" : "thread";

    return (
      <div key={`${kind}-${thread.id}`} className="relative min-w-0">
        <div
          className={cn(
            "group/item flex w-full min-w-0 items-center rounded-md px-2 py-0.5 text-sm transition-colors",
            "text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
            thread.active && "text-[var(--sidebar-foreground)]",
          )}
          onContextMenu={(e) => openThreadContextMenu(thread, e, kind)}
        >
          <button
            type="button"
            className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", indent && "pl-6")}
            data-active={thread.active ? "true" : "false"}
            data-kind={kind}
            data-state={thread.active ? props.runState : "idle"}
            data-testid={
              thread.active && kind === "conversation"
                ? "thread-item-current"
                : thread.active && kind === "session"
                  ? "thread-item-current"
                  : `${testPrefix}-item-${thread.id}`
            }
            title={title}
            onClick={() => {
              if (unread) setUnreadThreads(markThreadUnread(thread.id, false));
              if (!thread.active) props.onSwitchThread(thread.path, thread.cwd);
            }}
          >
            {unread ? (
              <span className="size-1.5 shrink-0 rounded-full bg-[#0a84ff]" aria-hidden />
            ) : null}
            {pinnedHere ? (
              <Pin className="size-3 shrink-0 opacity-50" strokeWidth={1.75} aria-hidden />
            ) : null}
            <span className="min-w-0 flex-1 truncate leading-4 text-left">{title}</span>
            {thread.active && props.running ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-blue-400" />
            ) : null}
          </button>
          {/* Hover: pin + archive only. Full menu via right-click. */}
          <RowActions open={showMenu} testIdPrefix={`${testPrefix}-${thread.id}`}>
            <button
              type="button"
              data-testid={`${testPrefix}-pin-btn-${thread.id}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={pinnedHere ? unpinLabel : pinLabel}
              aria-label={pinnedHere ? unpinLabel : pinLabel}
              onClick={(e) => {
                e.stopPropagation();
                handleTogglePinThread(thread.id);
              }}
            >
              {pinnedHere ? (
                <PinOff className="size-3.5" strokeWidth={1.75} />
              ) : (
                <Pin className="size-3.5" strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              data-testid={`${testPrefix}-archive-btn-${thread.id}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={archiveLabel}
              aria-label={archiveLabel}
              onClick={(e) => {
                e.stopPropagation();
                handleArchiveThread(thread.id);
              }}
            >
              <Archive className="size-3.5" strokeWidth={1.75} />
            </button>
          </RowActions>
        </div>
      </div>
    );
  }

  function threadsForProjectPath(path: string, active: boolean): SessionThreadSummary[] {
    const key = path.replace(/\\/g, "/").replace(/\/+$/, "");
    let list: SessionThreadSummary[];
    if (active && props.threads.length > 0) {
      list = props.threads;
    } else {
      list =
        props.threadsByCwd[key] ??
        props.threadsByCwd[path] ??
        Object.entries(props.threadsByCwd).find(
          ([k]) => k.replace(/\\/g, "/").replace(/\/+$/, "") === key,
        )?.[1] ??
        [];
    }
    const visible = list.filter(
      (t) => !isArchivedThread(t.id, archivedThreads) && !isDeletedThread(t.id, deletedThreads),
    );
    return sortThreadsWithPins(visible, pinnedThreads);
  }

  function renderNestedThreads(path: string, active: boolean) {
    const threadsForProject = threadsForProjectPath(path, active);
    const visibleN = getVisibleThreadCount(path, visibleCounts);
    const visibleThreads = threadsForProject.slice(0, visibleN);
    const hasMore = threadsForProject.length > visibleN;

    return (
      <div
        className="mt-0.5 mb-1 space-y-px"
        data-testid={active ? "thread-list" : "session-list"}
        data-kind="session"
      >
        {threadsForProject.length === 0 ? (
          <p className="px-2 py-0.5 pl-8 text-[12px] text-[var(--text-subtle)]">
            {tr("session.empty")}
          </p>
        ) : null}
        {visibleThreads.map((t) => renderThreadButton(t, { indent: true, kind: "session" }))}
        {hasMore ? (
          <button
            type="button"
            className="flex w-full items-center rounded-md px-2 py-0.5 pl-8 text-left text-[12px] text-[var(--text-subtle)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--muted-foreground)]"
            data-testid="session-show-more"
            onClick={() => handleShowMoreProject(path)}
          >
            {tr("session.showMore")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderCard(path: string) {
    const active = path === props.workspacePath;
    const open = groupMode === "project" && isExpandedProject(path, expanded);
    const name = displayName(path);
    const projectMenuId = `project:${path}`;
    const showMenu = menuKey === projectMenuId;

    return (
      <div
        key={path}
        className="relative min-w-0"
        data-testid="project-card"
        data-path={path}
        data-active={active ? "true" : "false"}
        data-expanded={open ? "true" : "false"}
      >
        {/* group/item only on project row — nested threads are siblings, not inside this group */}
        <div
          className={cn(
            "group/item flex w-full min-w-0 items-center rounded-md px-2 py-0.5 text-left text-sm transition-colors",
            "text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
            active && "text-[var(--sidebar-foreground)]",
          )}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            data-testid={active ? "workspace-current" : "recent-workspace-item"}
            data-path={path}
            title={path}
            disabled={props.running}
            onClick={() => {
              // Project row: only expand/collapse. Switching sessions happens via
              // nested session/conversation clicks (or project-row "new session").
              if (groupMode === "project") {
                handleToggleExpand(path);
              }
            }}
          >
            <Folder className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
            <span
              className="min-w-0 flex-1 truncate leading-4"
              data-testid={active ? "workspace-name" : undefined}
            >
              {name}
            </span>
          </button>

          {/* Hover this project row only → … + edit */}
          <RowActions open={showMenu} testIdPrefix="project">
            <button
              type="button"
              data-testid="project-menu-btn"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={tr("project.more")}
              aria-label={tr("project.more")}
              onClick={(e) => openItemMenu(projectMenuId, e)}
            >
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              data-testid="project-edit-btn"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={tr("project.newSession")}
              aria-label={tr("project.newSession")}
              disabled={props.running}
              onClick={(e) => handleNewThread(path, e)}
            >
              <SquarePen className="size-3.5" strokeWidth={1.75} />
            </button>
          </RowActions>
        </div>

        {/* 项目下展开 = 会话（不是对话） */}
        {open ? renderNestedThreads(path, active) : null}
      </div>
    );
  }

  /**
   * 对话分组：始终展示「对话」列表（独立于项目下的会话）。
   * - 按项目：当前工作区对话（与项目下会话同源，但属于对话分区）
   * - 在一个列表中：所有项目对话平铺
   */
  const conversationList = useMemo(() => {
    const seen = new Set<string>();
    const all: SessionThreadSummary[] = [];
    const sources =
      groupMode === "list"
        ? [...Object.values(props.threadsByCwd).flat(), ...props.threads]
        : props.threads.length > 0
          ? props.threads
          : props.workspacePath
            ? (props.threadsByCwd[props.workspacePath.replace(/\\/g, "/").replace(/\/+$/, "")] ??
              props.threadsByCwd[props.workspacePath] ??
              [])
            : [];
    for (const t of sources) {
      if (
        seen.has(t.id) ||
        isArchivedThread(t.id, archivedThreads) ||
        isDeletedThread(t.id, deletedThreads)
      ) {
        continue;
      }
      seen.add(t.id);
      all.push(t);
    }
    return sortThreadsWithPins(all, pinnedThreads);
  }, [
    groupMode,
    props.threadsByCwd,
    props.threads,
    props.workspacePath,
    archivedThreads,
    deletedThreads,
    pinnedThreads,
  ]);
  const conversationVisible = conversationList.slice(0, listVisible);
  const conversationHasMore = conversationList.length > listVisible;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5" data-testid="project-list">
      {/* ── 置顶（独立分组，始终在项目上方） ── */}
      {pinnedPaths.length > 0 ? (
        <div data-testid="pinned-projects" className="mb-1 min-w-0">
          <div className="px-1 py-0.5 text-[13px] font-semibold tracking-wide text-[var(--text-subtle)]">
            {tr("section.pinned")}
          </div>
          <div className="space-y-0.5">{pinnedPaths.map(renderCard)}</div>
        </div>
      ) : null}

      {/* ── 项目 ── */}
      <div className="relative min-w-0">
        <div className="group/section flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[var(--sidebar-accent)]">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[13px] font-semibold tracking-wide text-[var(--text-subtle)]"
            data-testid="projects-section-toggle"
            aria-expanded={projectsOpen}
            onClick={toggleProjects}
          >
            <span className="min-w-0 truncate">{tr("section.projects")}</span>
            <ChevronRight
              className={cn(
                "size-4 shrink-0 opacity-70 transition-transform duration-150",
                projectsOpen && "rotate-90",
              )}
              strokeWidth={2.25}
              aria-hidden
            />
          </button>
          <SectionActions open={organizeOpen} testIdPrefix="projects-section">
            <button
              type="button"
              data-testid="projects-organize-btn"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={tr("organize.title")}
              aria-label={tr("organize.title")}
              onClick={openOrganizeMenu}
            >
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              data-testid="workspace-open"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={tr("workspace.open")}
              aria-label={tr("workspace.open")}
              onClick={props.onOpenWorkspace}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </SectionActions>
        </div>

        {projectsOpen ? (
          <div className="min-w-0 space-y-0.5 overflow-x-hidden" data-testid="recent-workspaces">
            {restPaths.length === 0 && pinnedPaths.length === 0 ? (
              <div
                className="rounded-md px-2 py-0.5 text-sm hover:bg-[var(--sidebar-accent)]"
                data-testid="workspace-current"
              >
                <span data-testid="workspace-name">
                  {props.workspacePath ? displayName(props.workspacePath) : tr("workspace.none")}
                </span>
              </div>
            ) : (
              restPaths.map(renderCard)
            )}
          </div>
        ) : null}
      </div>

      {/* ── 对话 ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="group/section flex items-center gap-1 rounded-md px-1 py-0.5 mt-1 hover:bg-[var(--sidebar-accent)]">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[13px] font-semibold tracking-wide text-[var(--text-subtle)]"
            data-testid="threads-section-toggle"
            aria-expanded={threadsOpen}
            onClick={toggleThreads}
          >
            <span className="min-w-0 truncate">{tr("section.threads")}</span>
            {props.threads.length > 0 ? (
              <span className="shrink-0 font-normal tracking-normal opacity-70">
                ({props.threads.length})
              </span>
            ) : null}
            <ChevronRight
              className={cn(
                "size-4 shrink-0 opacity-70 transition-transform duration-150",
                threadsOpen && "rotate-90",
              )}
              strokeWidth={2.25}
              aria-hidden
            />
          </button>
          {/* Global 新建会话 — no project binding (same as sidebar top). */}
          <SectionActions testIdPrefix="threads-section">
            <button
              type="button"
              data-testid="threads-new-btn"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              title={tr("nav.newThread")}
              aria-label={tr("nav.newThread")}
              disabled={props.running}
              onClick={() => handleNewThread(undefined)}
            >
              <SquarePen className="size-3.5" strokeWidth={1.75} />
            </button>
          </SectionActions>
        </div>

        {threadsOpen ? (
          <div
            className="pix-scroll min-h-0 min-w-0 flex-1 space-y-px px-0.5"
            data-testid="conversations-list"
            data-kind="conversation"
          >
            {conversationList.length === 0 ? (
              <p className="px-2 py-0.5 text-[12px] text-[var(--text-subtle)]">
                {tr("thread.empty")}
              </p>
            ) : (
              conversationVisible.map((t) =>
                renderThreadButton(t, { indent: false, kind: "conversation" }),
              )
            )}
            {conversationHasMore ? (
              <button
                type="button"
                className="flex w-full items-center rounded-md px-2 py-0.5 text-left text-[12px] text-[var(--text-subtle)] hover:bg-[var(--sidebar-accent)]"
                data-testid="threads-show-more"
                onClick={() => setListVisible((n) => n + PROJECT_THREADS_PAGE)}
              >
                {tr("thread.showMore")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Top-layer popups (portal) — not clipped by sidebar overflow */}
      <FloatingMenu
        open={Boolean(menuKey?.startsWith("project:") && menuAnchor)}
        anchor={menuAnchor}
        onClose={closeMenus}
        testId="project-context-menu"
        minWidth={200}
      >
        {menuKey?.startsWith("project:")
          ? (() => {
              const path = menuKey.slice("project:".length);
              const pinnedHere = isPinnedProject(path, pinned);
              return (
                <>
                  <MenuItem
                    icon={
                      pinnedHere ? (
                        <PinOff className="size-3.5" strokeWidth={1.75} />
                      ) : (
                        <Pin className="size-3.5" strokeWidth={1.75} />
                      )
                    }
                    label={pinnedHere ? tr("project.unpin") : tr("project.pin")}
                    onClick={() => handleTogglePin(path)}
                    testId="project-menu-pin"
                  />
                  <MenuItem
                    icon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}
                    label={tr("project.reveal")}
                    onClick={() => handleReveal(path)}
                    testId="project-menu-reveal"
                  />
                  <MenuItem
                    icon={<Pencil className="size-3.5" strokeWidth={1.75} />}
                    label={tr("project.rename")}
                    onClick={() => handleRename(path)}
                    testId="project-menu-rename"
                  />
                  <MenuItem
                    icon={<Archive className="size-3.5" strokeWidth={1.75} />}
                    label={tr("project.archive")}
                    onClick={() => handleArchive(path)}
                    testId="project-menu-archive"
                  />
                  <MenuItem
                    icon={<Trash2 className="size-3.5" strokeWidth={1.75} />}
                    label={tr("project.remove")}
                    onClick={() => handleRemove(path)}
                    danger
                    testId="project-menu-remove"
                  />
                </>
              );
            })()
          : null}
      </FloatingMenu>

      <FloatingMenu
        open={Boolean(
          menuKey &&
          (menuKey.startsWith("session:") || menuKey.startsWith("conversation:")) &&
          menuAnchor,
        )}
        anchor={menuAnchor}
        onClose={closeMenus}
        testId={menuKey?.startsWith("session:") ? "session-context-menu" : "thread-context-menu"}
        minWidth={200}
      >
        {menuKey && (menuKey.startsWith("session:") || menuKey.startsWith("conversation:"))
          ? (() => {
              const isSession = menuKey.startsWith("session:");
              const id = menuKey.slice(isSession ? "session:".length : "conversation:".length);
              const thread =
                props.threads.find((t) => t.id === id) ??
                Object.values(props.threadsByCwd)
                  .flat()
                  .find((t) => t.id === id);
              if (!thread) return null;
              const pinnedHere = isPinnedThread(thread.id, pinnedThreads);
              const unread = isUnreadThread(thread.id, unreadThreads);
              const L = isSession
                ? {
                    pin: tr("session.pin"),
                    unpin: tr("session.unpin"),
                    rename: tr("session.rename"),
                    archive: tr("session.archive"),
                    unread: tr("session.markUnread"),
                    read: tr("session.markRead"),
                    copyPath: tr("session.copyPath"),
                    copyId: tr("session.copyId"),
                    del: tr("session.delete"),
                  }
                : {
                    pin: tr("thread.pin"),
                    unpin: tr("thread.unpin"),
                    rename: tr("thread.rename"),
                    archive: tr("thread.archive"),
                    unread: tr("thread.markUnread"),
                    read: tr("thread.markRead"),
                    copyPath: tr("thread.copyPath"),
                    copyId: tr("thread.copyId"),
                    del: tr("thread.delete"),
                  };
              return (
                <>
                  <MenuItem
                    icon={
                      pinnedHere ? (
                        <PinOff className="size-3.5" strokeWidth={1.75} />
                      ) : (
                        <Pin className="size-3.5" strokeWidth={1.75} />
                      )
                    }
                    label={pinnedHere ? L.unpin : L.pin}
                    onClick={() => handleTogglePinThread(thread.id)}
                    testId="thread-menu-pin"
                  />
                  <MenuItem
                    icon={<Pencil className="size-3.5" strokeWidth={1.75} />}
                    label={L.rename}
                    onClick={() => handleRenameThread(thread)}
                    testId="thread-menu-rename"
                  />
                  <MenuItem
                    icon={<Archive className="size-3.5" strokeWidth={1.75} />}
                    label={L.archive}
                    onClick={() => handleArchiveThread(thread.id)}
                    testId="thread-menu-archive"
                  />
                  <MenuItem
                    icon={
                      unread ? (
                        <MailOpen className="size-3.5" strokeWidth={1.75} />
                      ) : (
                        <Mail className="size-3.5" strokeWidth={1.75} />
                      )
                    }
                    label={unread ? L.read : L.unread}
                    onClick={() => handleToggleUnread(thread.id)}
                    testId="thread-menu-unread"
                  />
                  <MenuItem
                    icon={<Copy className="size-3.5" strokeWidth={1.75} />}
                    label={L.copyPath}
                    onClick={() => void copyText(thread.path)}
                    testId="thread-menu-copy-path"
                  />
                  <MenuItem
                    icon={<Copy className="size-3.5" strokeWidth={1.75} />}
                    label={L.copyId}
                    onClick={() => void copyText(thread.id)}
                    testId="thread-menu-copy-id"
                  />
                  <MenuItem
                    icon={<Trash2 className="size-3.5" strokeWidth={1.75} />}
                    label={L.del}
                    onClick={() => handleDeleteThread(thread.id)}
                    danger
                    testId="thread-menu-delete"
                  />
                </>
              );
            })()
          : null}
      </FloatingMenu>

      <FloatingMenu
        open={organizeOpen && Boolean(organizeAnchor)}
        anchor={organizeAnchor}
        onClose={closeMenus}
        testId="projects-organize-menu"
        minWidth={200}
      >
        <p className="px-3 pt-1 pb-1.5 text-[11px] text-[var(--text-subtle)]">
          {tr("organize.title")}
        </p>
        <CheckItem
          label={tr("organize.byProject")}
          checked={groupMode === "project"}
          onClick={() => setGroup("project")}
          testId="organize-by-project"
        />
        <CheckItem
          label={tr("organize.inOneList")}
          checked={groupMode === "list"}
          onClick={() => setGroup("list")}
          testId="organize-in-list"
        />
        <p className="mt-1.5 px-3 pt-1.5 pb-1.5 text-[11px] text-[var(--text-subtle)]">
          {tr("organize.sort")}
        </p>
        <CheckItem
          label={tr("organize.sortPriority")}
          checked={sortMode === "priority"}
          onClick={() => setSort("priority")}
          testId="organize-sort-priority"
        />
        <CheckItem
          label={tr("organize.sortRecent")}
          checked={sortMode === "recent"}
          onClick={() => setSort("recent")}
          testId="organize-sort-recent"
        />
        <CheckItem
          label={tr("organize.sortManual")}
          checked={sortMode === "manual"}
          onClick={() => setSort("manual")}
          testId="organize-sort-manual"
        />
      </FloatingMenu>

      <RenameDialog
        open={Boolean(renameTarget)}
        title={
          renameTarget?.kind === "thread" ? tr("thread.renameTitle") : tr("project.renameTitle")
        }
        label={
          renameTarget?.kind === "thread" ? tr("thread.renamePrompt") : tr("project.renamePrompt")
        }
        initialValue={renameTarget?.value ?? ""}
        confirmLabel={tr("common.confirm")}
        cancelLabel={tr("common.cancel")}
        testId="rename-dialog"
        onConfirm={confirmRename}
        onCancel={() => setRenameTarget(null)}
      />
    </div>
  );
}

function MenuItem(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={props.testId}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors",
        props.danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-[var(--popover-foreground)] hover:bg-[var(--accent)]",
      )}
      onClick={props.onClick}
    >
      <span className="opacity-70">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}

function CheckItem(props: {
  label: string;
  checked: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.checked}
      data-testid={props.testId}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-[var(--popover-foreground)] hover:bg-[var(--accent)]"
      onClick={props.onClick}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {props.checked ? (
          <Check className="size-3.5 text-[var(--foreground)]" strokeWidth={2} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}
