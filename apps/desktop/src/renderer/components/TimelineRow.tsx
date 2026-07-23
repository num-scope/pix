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
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
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

function MetaActions(props: {
  locale: Locale;
  time?: string | undefined;
  onCopy?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  copied?: boolean | undefined;
  className?: string | undefined;
}) {
  const timeLabel = formatMessageTime(props.time, props.locale === "zh" ? "zh" : "en");
  return (
    <div className={cn("timeline-meta-actions", props.className)}>
      {timeLabel ? <span className="timeline-meta-time">{timeLabel}</span> : null}
      {props.onCopy ? (
        <Button
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
      ) : null}
      {props.onEdit ? (
        <Button
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
      ) : null}
    </div>
  );
}

export const TimelineRow = memo(function TimelineRow(props: {
  item: TimelineItem;
  locale: Locale;
  workspacePath?: string | undefined;
  /** Edit + resubmit a user message (fork when entryId available). */
  onEditUser?: (
    item: Extract<TimelineItem, { kind: "user" }>,
    text: string,
  ) => void | Promise<void>;
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

    return (
      <Message align="end" className="timeline-user-row group/msg" data-kind="user">
        <MessageContent className="timeline-user-content items-end">
          {item.text ? (
            <Bubble
              variant="muted"
              align="end"
              className="max-w-full *:data-[slot=bubble-content]:bg-[var(--user-bubble)] *:data-[slot=bubble-content]:text-[var(--user-bubble-fg)]"
            >
              <BubbleContent className="timeline-user-bubble text-[14px]">
                <p className="m-0 whitespace-pre-wrap">{item.text}</p>
              </BubbleContent>
            </Bubble>
          ) : null}
          {item.attachments?.length ? <AttachmentList paths={item.attachments} /> : null}
          <MessageFooter className="px-0">
            <MetaActions
              locale={props.locale}
              {...(item.timestamp ? { time: item.timestamp } : {})}
              {...(item.text ? { onCopy: () => void handleCopy(item.text) } : {})}
              {...(props.onEditUser ? { onEdit: () => setEditing(true) } : {})}
              copied={copied}
              className="timeline-meta-actions-user"
            />
          </MessageFooter>
        </MessageContent>
      </Message>
    );
  }

  if (item.kind === "assistant") {
    return (
      <Message align="start" className="timeline-assistant-row group/msg" data-kind="assistant">
        <MessageContent>
          <Bubble variant="ghost" align="start" className="max-w-full">
            <BubbleContent className="w-full max-w-full p-0">
              <MarkdownContent
                className="w-full text-[14px] leading-relaxed text-foreground"
                workspacePath={props.workspacePath}
                locale={props.locale}
              >
                {item.text}
              </MarkdownContent>
            </BubbleContent>
          </Bubble>
          <MessageFooter className="px-0">
            <MetaActions
              locale={props.locale}
              {...(item.timestamp ? { time: item.timestamp } : {})}
              {...(item.text ? { onCopy: () => void handleCopy(item.text) } : {})}
              copied={copied}
              className="timeline-meta-actions-assistant"
            />
          </MessageFooter>
        </MessageContent>
      </Message>
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
