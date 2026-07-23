import { memo, useEffect, useState, type ReactNode } from "react";
import {
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
  LoaderCircle,
  Presentation,
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
import { t, type Locale } from "../lib/i18n.ts";
import { formatMessageTime, type TimelineItem } from "../lib/timeline.ts";
import { cn } from "../lib/utils.ts";

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

  useEffect(() => {
    if (item.kind === "user") setDraft(item.text);
  }, [item]);

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
        <article className="timeline-user-row" data-kind="user" data-editing="true">
          <div className="timeline-user-content timeline-user-edit">
            <textarea
              className="timeline-user-edit-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
              autoFocus
              data-testid="timeline-user-edit"
            />
            <div className="timeline-user-edit-actions">
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

/** Collapsible process block (“已处理”) before a final assistant reply. */
export const TimelineProcessBlock = memo(function TimelineProcessBlock(props: {
  locale: Locale;
  items: Array<Extract<TimelineItem, { kind: "thinking" | "tool" }>>;
  durationLabel?: string | undefined;
  workspacePath?: string | undefined;
}) {
  const label = props.durationLabel
    ? t(props.locale, "timeline.processedWithDuration", { duration: props.durationLabel })
    : t(props.locale, "timeline.processed");
  return (
    <div className="timeline-process" data-testid="timeline-process">
      <Collapsible className="timeline-process-details">
        <CollapsibleTrigger className="timeline-process-summary flex w-full items-center gap-2 text-left">
          <span>{label}</span>
          <ChevronRight
            className="timeline-process-chevron size-3.5 shrink-0 opacity-60"
            strokeWidth={2}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="timeline-process-body">
          {props.items.map((item) => (
            <TimelineRow
              key={item.id}
              item={item}
              locale={props.locale}
              workspacePath={props.workspacePath}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});
