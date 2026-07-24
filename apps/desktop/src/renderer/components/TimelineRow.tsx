import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  GitBranch,
  List,
  LoaderCircle,
  Minimize2,
  Pencil,
  Presentation,
  Search,
  Square,
  SquarePen,
  GitFork,
  Terminal,
  X,
} from "lucide-react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { MarkdownContent } from "./MarkdownContent.tsx";
import {
  attachmentLabel,
  attachmentPresentation,
  type AttachmentKind,
} from "../lib/composer-suggestions.ts";
import { t, type Locale, type MessageKey } from "../lib/i18n.ts";
import {
  groupConsecutiveTools,
  processToolView,
  type ProcessToolKind,
  type ProcessToolView,
} from "../lib/process-activity.ts";
import {
  elapsedDurationLabel,
  formatMessageTime,
  resolveProcessActivity,
  type ProcessActivity,
  type ProcessActivityPhase,
  type TimelineItem,
} from "../lib/timeline.ts";
import { cn } from "../lib/utils.ts";

/** Tick wall-clock once per second while `active` so elapsed labels stay live. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function activityLabel(
  locale: Locale,
  activity: ProcessActivity,
  duration: string | undefined,
): string {
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(locale, key, vars);
  const phase = activity.phase;
  const tool = activity.toolName?.trim() || "tool";
  const detail = activity.toolSummary?.trim();

  if (phase === "executing") {
    if (detail && duration) {
      return tr("timeline.activity.executingDetailWithDuration", { tool, detail, duration });
    }
    if (detail) return tr("timeline.activity.executingDetail", { tool, detail });
    if (duration) return tr("timeline.activity.executingWithDuration", { tool, duration });
    return tr("timeline.activity.executing", { tool });
  }

  const withDur = (base: MessageKey, withDuration: MessageKey) =>
    duration ? tr(withDuration, { duration }) : tr(base);

  switch (phase) {
    case "thinking":
      return withDur("timeline.activity.thinking", "timeline.activity.thinkingWithDuration");
    case "processing":
      return withDur("timeline.activity.processing", "timeline.activity.processingWithDuration");
    case "responding":
      return withDur("timeline.activity.responding", "timeline.activity.respondingWithDuration");
    case "waiting":
      return withDur("timeline.activity.waiting", "timeline.activity.waitingWithDuration");
    case "compacting":
      return withDur("timeline.activity.compacting", "timeline.activity.compactingWithDuration");
    case "summarizing":
      return withDur("timeline.activity.summarizing", "timeline.activity.summarizingWithDuration");
    case "processed":
    default:
      return duration
        ? tr("timeline.processedWithDuration", { duration })
        : tr("timeline.processed");
  }
}

/** Icons only for trailing live status — process header (“已处理”) is text-only. */
function liveStatusIcon(phase: ProcessActivityPhase): ReactNode {
  const common = { className: "size-3.5", strokeWidth: 1.75 } as const;
  if (phase === "processed") return null;
  if (phase === "thinking") return <Brain {...common} className="size-3.5 opacity-80" />;
  if (phase === "executing") return <Terminal {...common} className="size-3.5 opacity-80" />;
  if (phase === "compacting") return <Minimize2 {...common} className="size-3.5 opacity-80" />;
  if (phase === "summarizing") return <GitBranch {...common} className="size-3.5 opacity-80" />;
  if (phase === "waiting") {
    return (
      <span className="inline-flex size-3.5 items-center justify-center text-[11px] leading-none text-amber-400/90">
        ◐
      </span>
    );
  }
  return <LoaderCircle {...common} className="size-3.5 animate-spin opacity-80" />;
}

function attachmentIcon(kind: AttachmentKind) {
  const props = { className: "size-4", strokeWidth: 1.7 };
  if (kind === "spreadsheet") return <FileSpreadsheet {...props} />;
  if (kind === "image") return <FileImage {...props} />;
  if (kind === "presentation") return <Presentation {...props} />;
  if (kind === "archive") return <FileArchive {...props} />;
  if (kind === "code") return <FileCode2 {...props} />;
  if (kind === "folder") return <Folder {...props} />;
  if (kind === "document" || kind === "pdf" || kind === "text") {
    return <FileText {...props} />;
  }
  return <File {...props} />;
}

function AttachmentList(props: { paths: string[] }) {
  return (
    <AttachmentGroup className="timeline-attachment-grid" data-testid="timeline-attachments">
      {props.paths.map((path) => {
        const presentation = attachmentPresentation(path);
        return (
          <Attachment
            key={path}
            state="done"
            size="sm"
            data-kind={presentation.kind}
            className="timeline-attachment-card relative cursor-pointer"
            title={path}
          >
            <AttachmentTrigger
              onClick={() => void window.pix.workspace.openFile(path)}
              aria-label={attachmentLabel(path)}
            />
            <AttachmentMedia variant="icon" className="timeline-attachment-icon">
              {attachmentIcon(presentation.kind)}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle className="text-[11.5px]">{attachmentLabel(path)}</AttachmentTitle>
              <AttachmentDescription className="text-[9.5px] font-medium uppercase tracking-[0.04em]">
                {presentation.typeLabel}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        );
      })}
    </AttachmentGroup>
  );
}

function structuredText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

function toolSummary(value: unknown): string {
  if (typeof value === "string") return value.split("\n", 1)[0] ?? value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  for (const key of ["command", "path", "file_path", "query", "url", "description"]) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  const text = structuredText(value).replace(/\s+/g, " ");
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

function ToolSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="content-tool-section">
      <div className="content-tool-section-title">{props.title}</div>
      {props.children}
    </section>
  );
}

function ToolCard(props: { item: Extract<TimelineItem, { kind: "tool" }>; locale: Locale }) {
  const { item } = props;
  const summary = toolSummary(item.args);
  const [open, setOpen] = useState(item.status === "running");
  const statusLabel =
    item.status === "running"
      ? t(props.locale, "timeline.toolRunning")
      : item.status === "error"
        ? t(props.locale, "timeline.toolFailed")
        : t(props.locale, "timeline.toolCompleted");

  useEffect(() => {
    if (item.status === "running") setOpen(true);
  }, [item.status]);

  return (
    <article className="content-tool-wrap" data-kind="tool" data-status={item.status}>
      <Collapsible open={open} onOpenChange={setOpen} className="content-tool-card">
        <CollapsibleTrigger className="content-tool-card-trigger flex w-full items-center gap-2 text-left">
          <span className="content-tool-status" aria-hidden>
            {item.status === "running" ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : item.status === "error" ? (
              <X className="size-3" />
            ) : (
              <Check className="size-3" />
            )}
          </span>
          <Terminal className="size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
          <span className="shrink-0 font-medium text-foreground">{item.toolName}</span>
          {summary ? <span className="content-tool-summary">{summary}</span> : null}
          <Badge variant="secondary" className="content-tool-state ml-auto font-normal">
            {statusLabel}
          </Badge>
          <ChevronDown
            className={cn(
              "content-details-chevron size-3.5 shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="content-tool-body">
          {item.args !== undefined ? (
            <ToolSection title={t(props.locale, "timeline.toolInput")}>
              <pre className="pix-scroll">{structuredText(item.args)}</pre>
            </ToolSection>
          ) : null}
          {item.output ? (
            <ToolSection title={t(props.locale, "timeline.toolOutput")}>
              <pre className="pix-scroll">{item.output}</pre>
            </ToolSection>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type MetaActionKind = "time" | "copy" | "edit" | "fork";

function MetaActions(props: {
  locale: Locale;
  /** Render order of hover actions (role-specific). */
  order: MetaActionKind[];
  time?: string | undefined;
  onCopy?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onFork?: (() => void) | undefined;
  copied?: boolean | undefined;
  className?: string | undefined;
}) {
  const timeLabel = formatMessageTime(props.time, props.locale === "zh" ? "zh" : "en");

  function renderAction(kind: MetaActionKind) {
    if (kind === "time") {
      return timeLabel ? (
        <span key="time" className="timeline-meta-time">
          {timeLabel}
        </span>
      ) : null;
    }
    if (kind === "copy" && props.onCopy) {
      return (
        <Button
          key="copy"
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn("timeline-meta-btn", props.copied && "timeline-meta-btn-done")}
          title={
            props.copied ? t(props.locale, "timeline.copied") : t(props.locale, "timeline.copy")
          }
          aria-label={t(props.locale, "timeline.copy")}
          onClick={(e) => {
            e.stopPropagation();
            props.onCopy?.();
          }}
        >
          {props.copied ? (
            <Check className="size-3.5" strokeWidth={2} />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.6} />
          )}
        </Button>
      );
    }
    if (kind === "edit" && props.onEdit) {
      return (
        <Button
          key="edit"
          type="button"
          variant="ghost"
          size="icon-xs"
          className="timeline-meta-btn"
          title={t(props.locale, "timeline.edit")}
          aria-label={t(props.locale, "timeline.edit")}
          onClick={(e) => {
            e.stopPropagation();
            props.onEdit?.();
          }}
        >
          <SquarePen className="size-3.5" strokeWidth={1.6} />
        </Button>
      );
    }
    if (kind === "fork" && props.onFork) {
      return (
        <Button
          key="fork"
          type="button"
          variant="ghost"
          size="icon-xs"
          className="timeline-meta-btn"
          title={t(props.locale, "timeline.fork")}
          aria-label={t(props.locale, "timeline.fork")}
          data-testid="timeline-fork"
          onClick={(e) => {
            e.stopPropagation();
            props.onFork?.();
          }}
        >
          <GitFork className="size-3.5" strokeWidth={1.6} />
        </Button>
      );
    }
    return null;
  }

  return (
    <div className={cn("timeline-meta-actions", props.className)}>
      {props.order.map((kind) => renderAction(kind))}
    </div>
  );
}

export const TimelineRow = memo(function TimelineRow(props: {
  item: TimelineItem;
  locale: Locale;
  workspacePath?: string | undefined;
  /** Edit + resubmit a user message (same-session navigateTree + prompt). */
  onEditUser?: (
    item: Extract<TimelineItem, { kind: "user" }>,
    text: string,
  ) => void | Promise<void>;
  /** Fork at an assistant entry into a new session file (pi fork). */
  onForkAssistant?: (item: Extract<TimelineItem, { kind: "assistant" }>) => void | Promise<void>;
  editingLocked?: boolean;
}) {
  const { item } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.kind === "user" ? item.text : "");
  const [copied, setCopied] = useState(false);
  const editRootRef = useRef<HTMLElement | null>(null);
  const editActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (item.kind === "user") setDraft(item.text);
  }, [item]);

  /**
   * After expanding into edit mode the row gets taller. If it was near the bottom
   * of the viewport, that growth would push the editor into the composer fade zone.
   * Scroll the viewport just enough upward so the whole edit block (textarea +
   * cancel/send) stays in the same safe band above the sticky dock — never pull
   * it down into the fade.
   */
  useEffect(() => {
    if (!editing) return;
    const root = editRootRef.current;
    if (!root) return;

    const ensureAboveComposer = () => {
      const viewport = root.closest(
        '[data-slot="message-scroller-viewport"]',
      ) as HTMLElement | null;
      if (!viewport) return;

      const dock = viewport.querySelector(".composer-dock") as HTMLElement | null;
      const vr = viewport.getBoundingClientRect();
      const er = root.getBoundingClientRect();
      const dockTop = dock?.getBoundingClientRect().top ?? vr.bottom;
      // Safe band: above sticky composer (+ small gap). Never require scrolling down.
      const safeBottom = Math.min(dockTop, vr.bottom) - 12;
      const safeTop = vr.top + 16;

      let delta = 0;
      if (er.bottom > safeBottom) {
        // Editor grew into the dock/fade — shift content up.
        delta = er.bottom - safeBottom;
      }
      // Only scroll up further if the top was pushed off-screen by that adjustment.
      if (er.top - delta < safeTop) {
        delta = er.top - safeTop;
      }
      // Never scroll down (positive delta moves content up via increasing scrollTop).
      if (delta > 1) {
        viewport.scrollTop += delta;
      }
    };

    // Layout after textarea mounts (taller than the bubble).
    const t0 = window.requestAnimationFrame(() => {
      ensureAboveComposer();
      window.requestAnimationFrame(ensureAboveComposer);
    });
    const t1 = window.setTimeout(ensureAboveComposer, 50);
    return () => {
      window.cancelAnimationFrame(t0);
      window.clearTimeout(t1);
    };
  }, [editing]);

  async function handleCopy(text: string) {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  if (item.kind === "user") {
    if (editing) {
      return (
        <article
          ref={editRootRef}
          className="timeline-user-row"
          data-kind="user"
          data-editing="true"
          data-testid="timeline-user-edit-row"
        >
          <div className="timeline-user-content timeline-user-edit">
            <textarea
              className="timeline-user-edit-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
              autoFocus
              data-testid="timeline-user-edit"
            />
            <div
              ref={editActionsRef}
              className="timeline-user-edit-actions"
              data-testid="timeline-user-edit-actions"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="timeline-user-edit-cancel"
                disabled={props.editingLocked}
                onClick={() => {
                  setDraft(item.text);
                  setEditing(false);
                }}
              >
                {t(props.locale, "common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="timeline-user-edit-send"
                disabled={props.editingLocked || !draft.trim()}
                onClick={() => {
                  void (async () => {
                    await props.onEditUser?.(item, draft.trim());
                    setEditing(false);
                  })();
                }}
              >
                {t(props.locale, "timeline.send")}
              </Button>
            </div>
          </div>
        </article>
      );
    }

    // Native layout (not Message/Bubble stack): shadcn Message is w-full and fights
    // .timeline-user-row / .timeline-user-content flex-end constraints → misaligned bubbles.
    return (
      <article className="timeline-user-row group/msg" data-kind="user">
        <div className="timeline-user-content">
          {item.text ? (
            <div className="timeline-user-bubble">
              <p className="m-0 whitespace-pre-wrap">{item.text}</p>
            </div>
          ) : null}
          {item.attachments?.length ? <AttachmentList paths={item.attachments} /> : null}
          {/* User: 日期时间 · 复制 · 编辑重发 */}
          <MetaActions
            locale={props.locale}
            order={["time", "copy", "edit"]}
            {...(item.timestamp ? { time: item.timestamp } : {})}
            {...(item.text ? { onCopy: () => void handleCopy(item.text) } : {})}
            {...(props.onEditUser ? { onEdit: () => setEditing(true) } : {})}
            copied={copied}
            className="timeline-meta-actions-user"
          />
        </div>
      </article>
    );
  }

  if (item.kind === "assistant") {
    return (
      <article className="timeline-assistant-row group/msg" data-kind="assistant">
        <div className="timeline-assistant-body">
          <MarkdownContent
            className="w-full text-[14px] leading-relaxed text-foreground"
            workspacePath={props.workspacePath}
            locale={props.locale}
          >
            {item.text}
          </MarkdownContent>
          {/* AI: 复制 · fork · 日期时间 */}
          <MetaActions
            locale={props.locale}
            order={["copy", "fork", "time"]}
            {...(item.timestamp ? { time: item.timestamp } : {})}
            {...(item.text ? { onCopy: () => void handleCopy(item.text) } : {})}
            {...(props.onForkAssistant
              ? {
                  onFork: () => {
                    void props.onForkAssistant?.(item);
                  },
                }
              : {})}
            copied={copied}
            className="timeline-meta-actions-assistant"
          />
        </div>
      </article>
    );
  }

  if (item.kind === "thinking") {
    return (
      <article className="content-thinking-wrap" data-kind="thinking">
        <Collapsible className="content-thinking">
          <CollapsibleTrigger className="content-thinking-trigger flex w-full items-center gap-2 text-left">
            <Brain className="size-3.5" strokeWidth={1.75} />
            <span>{t(props.locale, "timeline.thinking")}</span>
            <ChevronDown className="content-details-chevron ml-auto size-3.5" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <MarkdownContent
              className="content-thinking-body"
              workspacePath={props.workspacePath}
              locale={props.locale}
            >
              {item.text}
            </MarkdownContent>
          </CollapsibleContent>
        </Collapsible>
      </article>
    );
  }
  if (item.kind === "tool") return <ToolCard item={item} locale={props.locale} />;

  return (
    <Marker
      variant="default"
      className={cn(
        "content-system-card items-start gap-2",
        item.tone === "error" && "is-error text-destructive",
      )}
      data-kind="system"
    >
      {item.tone === "error" ? (
        <MarkerIcon>
          <CircleAlert className="size-4" strokeWidth={1.75} />
        </MarkerIcon>
      ) : null}
      <MarkerContent className="min-w-0 flex-1">
        {item.title ? <div className="content-system-title">{item.title}</div> : null}
        {item.text ? (
          <MarkdownContent
            className="content-system-body"
            workspacePath={props.workspacePath}
            locale={props.locale}
          >
            {item.text}
          </MarkdownContent>
        ) : null}
      </MarkerContent>
    </Marker>
  );
});

function processToolIcon(kind: ProcessToolKind): ReactNode {
  const props = { className: "size-3.5 shrink-0", strokeWidth: 1.75 } as const;
  switch (kind) {
    case "read":
      return <BookOpen {...props} />;
    case "run":
      return <Square {...props} />;
    case "search":
      return <Search {...props} />;
    case "edit":
      return <Pencil {...props} />;
    case "write":
      return <FilePenLineIcon {...props} />;
    case "list":
      return <List {...props} />;
    default:
      return <Terminal {...props} />;
  }
}

/** FilePen not always available naming — use Pencil+FileText fallback via SquarePen. */
function FilePenLineIcon(props: { className?: string; strokeWidth?: number }) {
  return <SquarePen className={props.className} strokeWidth={props.strokeWidth ?? 1.75} />;
}

type ToolRowParts = {
  /** Leading status verb, e.g. 已读取 / 已运行 / 已在 */
  verb: string;
  /** Optional path rendered as accent link */
  path?: string;
  /** Middle glue after path, e.g. 中搜索 */
  mid?: string;
  /** Trailing detail (command / query / free text) */
  detail?: string;
};

function toolRowParts(
  locale: Locale,
  toolName: string,
  view: ProcessToolView,
  status: "running" | "completed" | "error",
): ToolRowParts {
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(locale, key, vars);
  let parts: ToolRowParts;
  if (view.kind === "read") {
    parts = view.path
      ? { verb: tr("timeline.process.read"), path: view.path }
      : { verb: tr("timeline.process.read"), detail: view.preview };
  } else if (view.kind === "run") {
    parts = { verb: tr("timeline.process.run"), detail: view.preview };
  } else if (view.kind === "search") {
    parts = view.path
      ? {
          verb: locale === "zh" ? "已在" : "Searched",
          path: view.path,
          mid: locale === "zh" ? "中搜索" : "for",
          detail: `“${view.detail}”`,
        }
      : { verb: tr("timeline.process.search"), detail: `“${view.detail}”` };
  } else if (view.kind === "edit") {
    parts = view.path
      ? { verb: tr("timeline.process.edit"), path: view.path }
      : { verb: tr("timeline.process.edit"), detail: view.preview };
  } else if (view.kind === "write") {
    parts = view.path
      ? { verb: tr("timeline.process.write"), path: view.path }
      : { verb: tr("timeline.process.write"), detail: view.preview };
  } else if (view.kind === "list") {
    parts = view.path
      ? { verb: tr("timeline.process.list"), path: view.path }
      : { verb: tr("timeline.process.list"), detail: view.preview };
  } else {
    parts = {
      verb: tr("timeline.process.generic", { tool: toolName }),
      ...(view.preview !== toolName ? { detail: view.preview } : {}),
    };
  }

  if (status === "running") {
    return { ...parts, verb: `${parts.verb} · ${tr("timeline.process.running")}` };
  }
  if (status === "error") {
    return { ...parts, verb: `${parts.verb} · ${tr("timeline.process.failed")}` };
  }
  return parts;
}

function groupSummaryLabel(locale: Locale, kind: ProcessToolKind): string {
  const key: MessageKey =
    kind === "read"
      ? "timeline.process.group.read"
      : kind === "run"
        ? "timeline.process.group.run"
        : kind === "search"
          ? "timeline.process.group.search"
          : kind === "edit"
            ? "timeline.process.group.edit"
            : kind === "write"
              ? "timeline.process.group.write"
              : kind === "list"
                ? "timeline.process.group.list"
                : "timeline.process.group.generic";
  return t(locale, key);
}

function ProcessPathLink(props: {
  path: string;
  workspacePath?: string | undefined;
  className?: string | undefined;
}) {
  const fileName = props.path.split(/[/\\]/).pop() || props.path;
  return (
    <button
      type="button"
      className={cn("process-step-path", props.className)}
      title={props.path}
      onClick={(e) => {
        e.stopPropagation();
        void window.pix.workspace.openFile(props.path);
      }}
    >
      {fileName}
    </button>
  );
}

function ProcessToolRow(props: {
  item: Extract<TimelineItem, { kind: "tool" }>;
  locale: Locale;
  workspacePath?: string | undefined;
  nested?: boolean | undefined;
}) {
  const view = processToolView(props.item.toolName, props.item.args);
  const parts = toolRowParts(props.locale, props.item.toolName, view, props.item.status);
  const [open, setOpen] = useState(false);
  const hasBody = props.item.args !== undefined || Boolean(props.item.output);

  const row = (
    <Marker
      variant="default"
      className={cn(
        "process-step-row min-h-0 gap-2 text-[13px]",
        props.nested && "process-step-row-nested",
        props.item.status === "error" && "is-error",
        props.item.status === "running" && "is-running",
      )}
      data-kind="tool"
      data-tool-kind={view.kind}
      data-status={props.item.status}
    >
      <MarkerIcon className="process-step-icon size-3.5 text-muted-foreground">
        {props.item.status === "running" ? (
          <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          processToolIcon(view.kind)
        )}
      </MarkerIcon>
      <MarkerContent className="process-step-content min-w-0 flex-1">
        <span className="process-step-verb">{parts.verb}</span>
        {parts.path ? (
          <>
            {" "}
            <ProcessPathLink path={parts.path} workspacePath={props.workspacePath} />
          </>
        ) : null}
        {parts.mid ? (
          <>
            {" "}
            <span className="process-step-verb">{parts.mid}</span>
          </>
        ) : null}
        {parts.detail ? (
          <>
            {" "}
            <span className="process-step-detail">{parts.detail}</span>
          </>
        ) : null}
      </MarkerContent>
      {hasBody ? (
        <ChevronRight
          className={cn(
            "process-step-expand size-3.5 shrink-0 opacity-50 transition-transform",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
      ) : null}
    </Marker>
  );

  if (!hasBody) return row;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="process-step-collapsible">
      <CollapsibleTrigger className="process-step-trigger w-full text-left">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent className="process-step-body">
        {props.item.args !== undefined ? (
          <pre className="process-step-pre">{structuredText(props.item.args)}</pre>
        ) : null}
        {props.item.output ? <pre className="process-step-pre">{props.item.output}</pre> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProcessToolGroup(props: {
  kind: ProcessToolKind;
  items: Array<Extract<TimelineItem, { kind: "tool" }>>;
  locale: Locale;
  workspacePath?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const anyRunning = props.items.some((i) => i.status === "running");
  const anyError = props.items.some((i) => i.status === "error");

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="process-step-group">
      <CollapsibleTrigger className="process-step-trigger w-full text-left">
        <Marker
          variant="default"
          className={cn(
            "process-step-row process-step-group-row min-h-0 gap-2 text-[13px]",
            anyError && "is-error",
            anyRunning && "is-running",
          )}
          data-kind="tool-group"
          data-tool-kind={props.kind}
        >
          <MarkerIcon className="process-step-icon size-3.5 text-muted-foreground">
            {anyRunning ? (
              <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              processToolIcon(props.kind)
            )}
          </MarkerIcon>
          <MarkerContent className="min-w-0 flex-1 truncate">
            {groupSummaryLabel(props.locale, props.kind)}
          </MarkerContent>
          <ChevronRight
            className={cn(
              "process-step-expand size-3.5 shrink-0 opacity-50 transition-transform",
              open && "rotate-90",
            )}
            strokeWidth={2}
          />
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent className="process-step-group-body">
        {props.items.map((item) => (
          <ProcessToolRow
            key={item.id}
            item={item}
            locale={props.locale}
            workspacePath={props.workspacePath}
            nested
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProcessThinking(props: {
  item: Extract<TimelineItem, { kind: "thinking" }>;
  locale: Locale;
  workspacePath?: string | undefined;
}) {
  return (
    <div className="process-step-thinking" data-kind="thinking">
      <MarkdownContent
        className="process-step-thinking-body"
        workspacePath={props.workspacePath}
        locale={props.locale}
      >
        {props.item.text}
      </MarkdownContent>
    </div>
  );
}

/** Render process items as Codex-style narrative + activity rows. */
function ProcessSteps(props: {
  items: Array<Extract<TimelineItem, { kind: "thinking" | "tool" }>>;
  locale: Locale;
  workspacePath?: string | undefined;
}) {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < props.items.length) {
    const item = props.items[i]!;
    if (item.kind === "thinking") {
      nodes.push(
        <ProcessThinking
          key={item.id}
          item={item}
          locale={props.locale}
          workspacePath={props.workspacePath}
        />,
      );
      i += 1;
      continue;
    }
    // Collect consecutive tools for grouping.
    const tools: Array<Extract<TimelineItem, { kind: "tool" }>> = [];
    while (i < props.items.length && props.items[i]!.kind === "tool") {
      tools.push(props.items[i]! as Extract<TimelineItem, { kind: "tool" }>);
      i += 1;
    }
    for (const group of groupConsecutiveTools(tools)) {
      if (group.type === "single") {
        nodes.push(
          <ProcessToolRow
            key={group.item.id}
            item={group.item}
            locale={props.locale}
            workspacePath={props.workspacePath}
          />,
        );
      } else {
        nodes.push(
          <ProcessToolGroup
            key={`group-${group.items[0]!.id}`}
            kind={group.kind}
            items={group.items}
            locale={props.locale}
            workspacePath={props.workspacePath}
          />,
        );
      }
    }
  }
  return <div className="process-steps">{nodes}</div>;
}

/**
 * Collapsible process block.
 * Header is text-only (“已处理 12 秒” / live phase labels) — no leading icon.
 * Duration is this reply segment only (first thinking/tool → done / now).
 * Body: Codex-style narrative + compact tool activity rows.
 */
export const TimelineProcessBlock = memo(function TimelineProcessBlock(props: {
  locale: Locale;
  items: Array<Extract<TimelineItem, { kind: "thinking" | "tool" }>>;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  open?: boolean | undefined;
  running?: boolean | undefined;
  waiting?: boolean | undefined;
  /** Prefer live event phase (e.g. responding) over last process item. */
  livePhase?: ProcessActivityPhase | undefined;
  /** Fallback when timestamps are missing (history). */
  durationLabel?: string | undefined;
  workspacePath?: string | undefined;
}) {
  // Keep ticking while the turn is still open (including “responding” after tools).
  const active = Boolean(props.open && (props.running || props.waiting));
  const now = useNow(active);
  const activity = resolveProcessActivity(props.items, {
    ...(props.open !== undefined ? { open: props.open } : {}),
    ...(props.running !== undefined ? { running: props.running } : {}),
    ...(props.waiting !== undefined ? { waiting: props.waiting } : {}),
    ...(props.livePhase !== undefined ? { livePhase: props.livePhase } : {}),
  });
  const liveDuration =
    elapsedDurationLabel(props.startedAt, active ? undefined : props.endedAt, now, props.locale) ??
    props.durationLabel;
  const label = activityLabel(props.locale, activity, liveDuration);

  return (
    <div
      className="timeline-process"
      data-testid="timeline-process"
      data-phase={activity.phase}
      data-active={active ? "true" : "false"}
    >
      <Collapsible className="timeline-process-details" defaultOpen={active}>
        <CollapsibleTrigger className="timeline-process-summary group/process-trigger w-full text-left">
          <span className="timeline-process-label min-w-0 flex-1 truncate">{label}</span>
          <ChevronRight
            className="timeline-process-chevron size-3.5 shrink-0 opacity-60"
            strokeWidth={2}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="timeline-process-body">
          <ProcessSteps
            items={props.items}
            locale={props.locale}
            workspacePath={props.workspacePath}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

/**
 * Trailing live status Marker when no open process group covers the phase.
 * Uses Marker for busy states (thinking / working / compacting / …).
 */
export const TimelineLiveStatus = memo(function TimelineLiveStatus(props: {
  locale: Locale;
  activity: ProcessActivity & { startedAt?: string };
}) {
  const active = props.activity.phase !== "processed";
  const now = useNow(active);
  const duration = elapsedDurationLabel(props.activity.startedAt, undefined, now, props.locale);
  const label = activityLabel(props.locale, props.activity, duration);
  const icon = liveStatusIcon(props.activity.phase);

  return (
    <Marker
      variant="default"
      className="timeline-live-status min-h-0 gap-1.5 py-1 text-[13px]"
      data-testid="timeline-live-status"
      data-phase={props.activity.phase}
      role="status"
      aria-live="polite"
    >
      {icon ? <MarkerIcon className="size-3.5">{icon}</MarkerIcon> : null}
      <MarkerContent className="min-w-0 truncate">{label}</MarkerContent>
    </Marker>
  );
});
