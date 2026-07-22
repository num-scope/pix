/**
 * Active thread titlebar: title + ⋯ menu (pin / rename / archive / copy).
 * Env floating popup toggled from the top-right control.
 */
import type { SessionThreadSummary } from "@pix/contracts";
import {
  Archive,
  Copy,
  Layers,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
} from "lucide-react";
import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { loadConfirmArchive } from "../lib/behavior-prefs.ts";
import {
  MAC_TRAFFIC_LIGHT_GUTTER_PX,
  TITLEBAR_CONTROL_SIZE_PX,
} from "../lib/desktop-chrome.ts";
import { t, type Locale } from "../lib/i18n.ts";
import {
  archiveThread,
  isPinnedThread,
  loadPinnedThreads,
  loadThreadAliases,
  setThreadAlias,
  threadDisplayTitle,
  togglePinnedThread,
} from "../lib/project-prefs.ts";
import { cn } from "../lib/utils.ts";
import { useShellStore } from "../store/shell-store.ts";
import { anchorFromEvent, FloatingMenu, type AnchorRect } from "./FloatingMenu.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RenameDialog } from "./RenameDialog.tsx";

/** Notify sidebar lists to reload pin/archive/alias prefs. */
export function notifyThreadPrefsChanged(): void {
  window.dispatchEvent(new Event("pix-thread-prefs"));
}

export function ThreadHeader(props: {
  locale: Locale;
  title: string;
  thread: SessionThreadSummary | undefined;
  /** Fallback cwd when thread.cwd is empty. */
  workspacePath: string | undefined;
  sessionId: string | undefined;
  className?: string;
  style?: CSSProperties;
  collapsed?: boolean;
  /** When false, env toggle is hidden (e.g. viewport too narrow for panel). */
  envToggleVisible?: boolean;
}) {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string>) =>
    t(props.locale, key, vars);
  const envPanelOpen = useShellStore((s) => s.envPanelOpen);
  const setEnvPanelOpen = useShellStore((s) => s.setEnvPanelOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [pinnedIds, setPinnedIds] = useState(loadPinnedThreads);
  const [aliases, setAliases] = useState(loadThreadAliases);
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const threadId = props.thread?.id ?? props.sessionId;
  const pinned = threadId ? isPinnedThread(threadId, pinnedIds) : false;
  const fullTitle = threadId ? threadDisplayTitle(threadId, aliases, props.title) : props.title;
  /** Visible title capped at 28 chars; full string stays in tooltip / rename. */
  const displayTitle = fullTitle.length > 28 ? `${fullTitle.slice(0, 28)}…` : fullTitle;
  const showEnvToggle = props.envToggleVisible !== false;

  useEffect(() => {
    const sync = () => {
      setPinnedIds(loadPinnedThreads());
      setAliases(loadThreadAliases());
    };
    window.addEventListener("pix-thread-prefs", sync);
    return () => window.removeEventListener("pix-thread-prefs", sync);
  }, []);

  function closeMenu() {
    setMenuOpen(false);
    setAnchor(null);
  }

  function openMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (menuOpen) {
      closeMenu();
      return;
    }
    setAnchor(anchorFromEvent(event.currentTarget));
    setMenuOpen(true);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    closeMenu();
  }

  function handlePin() {
    if (!threadId) return;
    setPinnedIds(togglePinnedThread(threadId));
    notifyThreadPrefsChanged();
    closeMenu();
  }

  function doArchive() {
    if (!threadId) return;
    const meta: { title?: string; path?: string; cwd?: string } = {
      title: fullTitle,
    };
    if (props.thread?.path) meta.path = props.thread.path;
    const cwd = props.thread?.cwd || props.workspacePath;
    if (cwd) meta.cwd = cwd;
    archiveThread(threadId, meta);
    notifyThreadPrefsChanged();
  }

  function handleArchive() {
    closeMenu();
    if (!threadId) return;
    if (loadConfirmArchive()) {
      setArchiveConfirmOpen(true);
      return;
    }
    doArchive();
  }

  function handleRenameConfirm(value: string) {
    if (!threadId) return;
    setAliases(setThreadAlias(threadId, value || undefined));
    notifyThreadPrefsChanged();
    setRenameOpen(false);
  }

  const canAct = Boolean(threadId);

  return (
    <>
      <header
        className={cn(
          "thread-header drag-region",
          props.collapsed && "thread-header-collapsed",
          props.className,
        )}
        style={props.style}
        data-testid="thread-header"
      >
        {/* When the rail is fully collapsed, punch a no-drag hole under the portaled
            expand control. Padding alone stays part of the drag region and steals clicks. */}
        {props.collapsed ? (
          <>
            <div
              className="pointer-events-none shrink-0"
              style={{ width: MAC_TRAFFIC_LIGHT_GUTTER_PX }}
              aria-hidden
            />
            <div
              className="no-drag shrink-0 self-stretch"
              style={{ width: TITLEBAR_CONTROL_SIZE_PX + 12 }}
              aria-hidden
              data-testid="thread-header-expand-slot"
            />
          </>
        ) : null}
        <div className="no-drag flex min-w-0 max-w-[calc(100%-2.5rem)] items-center gap-0.5">
          <h2
            className="m-0 min-w-0 shrink-0 text-[13px] font-semibold tracking-tight"
            title={fullTitle}
          >
            {displayTitle}
          </h2>
          <button
            type="button"
            data-testid="thread-header-menu"
            className={cn(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
              "text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)] hover:text-[var(--foreground)]",
              !canAct && "pointer-events-none opacity-30",
            )}
            title={tr("thread.more")}
            aria-label={tr("thread.more")}
            aria-expanded={menuOpen}
            disabled={!canAct}
            onClick={openMenu}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-w-0 flex-1" aria-hidden />
        {showEnvToggle ? (
          <button
            type="button"
            data-testid="thread-header-env"
            className={cn(
              "no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
              "text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)] hover:text-[var(--foreground)]",
              envPanelOpen && "bg-[var(--accent)] text-[var(--foreground)]",
            )}
            title={tr("env.togglePanel")}
            aria-label={tr("env.togglePanel")}
            aria-pressed={envPanelOpen}
            aria-expanded={envPanelOpen}
            onClick={() => {
              setEnvPanelOpen(!envPanelOpen);
              setMenuOpen(false);
            }}
          >
            <Layers className="size-4" strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      <FloatingMenu
        open={menuOpen && Boolean(anchor) && canAct}
        anchor={anchor}
        onClose={closeMenu}
        testId="thread-header-context-menu"
        minWidth={200}
      >
        <MenuItem
          icon={
            pinned ? (
              <PinOff className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Pin className="size-3.5" strokeWidth={1.75} />
            )
          }
          label={pinned ? tr("thread.unpin") : tr("thread.pin")}
          onClick={handlePin}
          testId="thread-header-pin"
        />
        <MenuItem
          icon={<Pencil className="size-3.5" strokeWidth={1.75} />}
          label={tr("thread.rename")}
          onClick={() => {
            closeMenu();
            window.setTimeout(() => setRenameOpen(true), 0);
          }}
          testId="thread-header-rename"
        />
        <MenuItem
          icon={<Archive className="size-3.5" strokeWidth={1.75} />}
          label={tr("thread.archive")}
          onClick={handleArchive}
          testId="thread-header-archive"
        />
        <MenuItem
          icon={<Copy className="size-3.5" strokeWidth={1.75} />}
          label={tr("thread.copyId")}
          onClick={() => void copyText(threadId ?? "")}
          testId="thread-header-copy-id"
        />
        <MenuItem
          icon={<Copy className="size-3.5" strokeWidth={1.75} />}
          label={tr("thread.copyCwd")}
          onClick={() => void copyText(props.thread?.cwd || props.workspacePath || "")}
          testId="thread-header-copy-cwd"
        />
      </FloatingMenu>

      <ConfirmDialog
        open={archiveConfirmOpen && canAct}
        title={tr("confirm.archiveTitle")}
        message={tr("confirm.archiveMessage", { name: fullTitle })}
        confirmLabel={tr("confirm.archive")}
        cancelLabel={tr("common.cancel")}
        testId="thread-header-archive-confirm"
        onConfirm={() => {
          setArchiveConfirmOpen(false);
          doArchive();
        }}
        onCancel={() => setArchiveConfirmOpen(false)}
      />

      <RenameDialog
        open={renameOpen && canAct}
        title={tr("thread.renameTitle")}
        label={tr("thread.renamePrompt")}
        initialValue={fullTitle}
        confirmLabel={tr("common.confirm")}
        cancelLabel={tr("common.cancel")}
        testId="thread-header-rename-dialog"
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameOpen(false)}
      />
    </>
  );
}

function MenuItem(props: { icon: ReactNode; label: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={props.testId}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--popover-foreground)] transition-colors hover:bg-[var(--hover-fill)]"
      onClick={props.onClick}
    >
      <span className="opacity-70">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}
