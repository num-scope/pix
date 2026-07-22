import { memo, type ReactNode } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  LoaderCircle,
  Presentation,
  Terminal,
  X,
} from "lucide-react";
import { MarkdownContent } from "./MarkdownContent.tsx";
import {
  attachmentLabel,
  attachmentPresentation,
  type AttachmentKind,
} from "../lib/composer-suggestions.ts";
import { t, type Locale } from "../lib/i18n.ts";
import type { TimelineItem } from "../lib/timeline.ts";
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
    <div className="timeline-attachment-grid" data-testid="timeline-attachments">
      {props.paths.map((path) => {
        const presentation = attachmentPresentation(path);
        return (
          <button
            key={path}
            type="button"
            className="timeline-attachment-card"
            data-kind={presentation.kind}
            title={path}
            onClick={() => void window.pix.workspace.openFile(path)}
          >
            <span className="timeline-attachment-icon">{attachmentIcon(presentation.kind)}</span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[11.5px] font-medium">
                {attachmentLabel(path)}
              </span>
              <span className="mt-0.5 block truncate text-[9.5px] font-medium uppercase tracking-[0.04em] opacity-60">
                {presentation.typeLabel}
              </span>
            </span>
          </button>
        );
      })}
    </div>
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
  const statusLabel =
    item.status === "running"
      ? t(props.locale, "timeline.toolRunning")
      : item.status === "error"
        ? t(props.locale, "timeline.toolFailed")
        : t(props.locale, "timeline.toolCompleted");
  return (
    <article className="content-tool-wrap" data-kind="tool" data-status={item.status}>
      <details className="content-tool-card" open={item.status === "running" || undefined}>
        <summary>
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
          <span className="shrink-0 font-medium text-[var(--foreground)]">{item.toolName}</span>
          {summary ? <span className="content-tool-summary">{summary}</span> : null}
          <span className="content-tool-state">{statusLabel}</span>
          <ChevronDown className="content-details-chevron size-3.5 shrink-0" />
        </summary>
        <div className="content-tool-body">
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
        </div>
      </details>
    </article>
  );
}

export const TimelineRow = memo(function TimelineRow(props: {
  item: TimelineItem;
  locale: Locale;
  workspacePath?: string | undefined;
}) {
  const { item } = props;
  if (item.kind === "user") {
    return (
      <article className="timeline-user-row" data-kind="user">
        <div className="timeline-user-content">
          {item.text ? (
            <div className="timeline-user-bubble">
              <p>{item.text}</p>
            </div>
          ) : null}
          {item.attachments?.length ? <AttachmentList paths={item.attachments} /> : null}
        </div>
      </article>
    );
  }
  if (item.kind === "assistant") {
    return (
      <article className="timeline-assistant-row" data-kind="assistant">
        <div className="timeline-assistant-label">
          <span>π</span>
          <strong>pi</strong>
        </div>
        <MarkdownContent
          className="w-full text-[14px] leading-relaxed text-[var(--foreground)]"
          workspacePath={props.workspacePath}
          locale={props.locale}
        >
          {item.text}
        </MarkdownContent>
      </article>
    );
  }
  if (item.kind === "thinking") {
    return (
      <article className="content-thinking-wrap" data-kind="thinking">
        <details className="content-thinking">
          <summary>
            <Brain className="size-3.5" strokeWidth={1.75} />
            <span>{t(props.locale, "timeline.thinking")}</span>
            <ChevronDown className="content-details-chevron ml-auto size-3.5" />
          </summary>
          <MarkdownContent
            className="content-thinking-body"
            workspacePath={props.workspacePath}
            locale={props.locale}
          >
            {item.text}
          </MarkdownContent>
        </details>
      </article>
    );
  }
  if (item.kind === "tool") return <ToolCard item={item} locale={props.locale} />;

  return (
    <article
      className={cn("content-system-card", item.tone === "error" && "is-error")}
      data-kind="system"
    >
      {item.tone === "error" ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      ) : null}
      <div className="min-w-0 flex-1">
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
      </div>
    </article>
  );
});
