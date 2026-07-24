/** Streaming-safe rich content renderer for assistant messages. */
import { memo, useState, type MouseEvent, type ReactNode } from "react";
import { BookMarked, ExternalLink, FileCode2, Maximize2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { ContentCodeBlock } from "./ContentCodeBlock.tsx";
import { contentMediaKind, contentSourceUrl, parseContentLink } from "../lib/content-rendering.ts";
import { markdownSanitizeSchema } from "../lib/markdown-sanitize.ts";
import { t, type Locale } from "../lib/i18n.ts";
import { cn } from "../lib/utils.ts";

function safeMarkdownUrl(url: string, key: string): string {
  if (/^(javascript:|vbscript:)/i.test(url)) return "";
  if (key === "src" && /^data:/i.test(url) && !/^data:image\//i.test(url)) return "";
  return url;
}

function propFlag(value: unknown): boolean {
  return value === true || value === "" || value === "true";
}

function scrollToMarkdownAnchor(from: HTMLElement, href: string): boolean {
  if (!href.startsWith("#") || href.length < 2) return false;
  const id = decodeURIComponent(href.slice(1));
  if (!id) return false;
  const root = from.closest(".pix-md");
  if (!root) return false;
  let target: Element | null = null;
  try {
    target = root.querySelector(`#${CSS.escape(id)}`);
  } catch {
    target = root.querySelector(`[id="${id.replace(/"/g, '\\"')}"]`);
  }
  if (!target || !(target instanceof HTMLElement)) return false;
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  target.classList.add("content-cite-flash");
  window.setTimeout(() => target.classList.remove("content-cite-flash"), 1200);
  return true;
}

function MarkdownLink(props: {
  href?: string | undefined;
  children: ReactNode;
  workspacePath?: string | undefined;
  className?: string | undefined;
  title?: string | undefined;
  /** GFM footnote reference / backref flags (hast → React). */
  "data-footnote-ref"?: unknown;
  "data-footnote-backref"?: unknown;
  dataFootnoteRef?: unknown;
  dataFootnoteBackref?: unknown;
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-label"?: string | undefined;
}) {
  const href = props.href ?? "";
  const className = props.className ?? "";
  const isFootnoteRef =
    propFlag(props["data-footnote-ref"]) ||
    propFlag(props.dataFootnoteRef) ||
    className.includes("data-footnote-ref");
  const isFootnoteBackref =
    propFlag(props["data-footnote-backref"]) ||
    propFlag(props.dataFootnoteBackref) ||
    className.includes("data-footnote-backref");

  const target = parseContentLink(href, props.workspacePath);
  if (target.kind === "blocked" && !isFootnoteRef && !isFootnoteBackref) {
    return <span>{props.children}</span>;
  }

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (isFootnoteRef || isFootnoteBackref || target.kind === "anchor") {
      event.preventDefault();
      scrollToMarkdownAnchor(event.currentTarget, href);
      return;
    }
    event.preventDefault();
    if (target.kind === "external") {
      void window.pix.workspace.openExternal(target.href);
    } else if (target.kind === "file") {
      void window.pix.workspace.openFile(target.path, {
        ...(target.line ? { line: target.line } : {}),
        ...(target.column ? { column: target.column } : {}),
      });
    }
  }

  if (isFootnoteRef) {
    return (
      <a
        href={href}
        id={props.id}
        onClick={open}
        className={cn("content-cite-ref", className)}
        data-footnote-ref
        aria-describedby={props["aria-describedby"]}
        title={props.title}
      >
        {props.children}
      </a>
    );
  }

  if (isFootnoteBackref) {
    return (
      <a
        href={href}
        id={props.id}
        onClick={open}
        className={cn("content-cite-backref", className)}
        data-footnote-backref
        aria-label={props["aria-label"]}
        title={props.title}
      >
        {props.children}
      </a>
    );
  }

  const fileTitle =
    target.kind === "file"
      ? target.line
        ? `${target.path}:${target.line}${target.column ? `:${target.column}` : ""}`
        : target.path
      : undefined;

  return (
    <a
      href={href}
      id={props.id}
      onClick={open}
      className={cn(target.kind === "file" && "content-file-link content-source-cite", className)}
      title={props.title ?? fileTitle}
    >
      {target.kind === "file" ? (
        <FileCode2 className="content-source-cite-icon" aria-hidden strokeWidth={1.75} />
      ) : null}
      <span className="content-source-cite-label">{props.children}</span>
      {target.kind === "file" && target.line != null ? (
        <span className="content-source-line" aria-hidden>
          :{target.line}
          {target.column != null ? `:${target.column}` : ""}
        </span>
      ) : null}
      {target.kind === "external" ? (
        <ExternalLink className="ml-0.5 inline size-[0.8em] align-baseline opacity-60" />
      ) : null}
    </a>
  );
}

function MediaContent(props: {
  src?: string | undefined;
  alt?: string | undefined;
  title?: string | undefined;
  workspacePath?: string | undefined;
  locale: Locale;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const source = props.src ? contentSourceUrl(props.src, props.workspacePath) : "";
  const kind = contentMediaKind(props.src ?? "");

  if (!source) return null;
  if (kind === "video") {
    return (
      <video className="content-video" src={source} controls preload="metadata" title={props.title}>
        {props.alt}
      </video>
    );
  }

  return (
    <>
      <button
        type="button"
        className="content-image-button"
        onClick={() => setPreviewOpen(true)}
        title={props.title || props.alt || t(props.locale, "timeline.imagePreview")}
      >
        <img src={source} alt={props.alt ?? ""} loading="lazy" />
        <span className="content-image-expand" aria-hidden>
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          showCloseButton={false}
          className="content-image-preview-dialog max-h-[min(92vh,960px)] max-w-[min(96vw,1200px)] border-none bg-transparent p-0 shadow-none ring-0"
          aria-label={props.alt || t(props.locale, "timeline.imagePreview")}
        >
          <DialogTitle className="sr-only">
            {props.alt || t(props.locale, "timeline.imagePreview")}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="content-image-preview-close absolute top-3 right-3 z-10"
              aria-label={t(props.locale, "timeline.imagePreviewClose")}
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
          <img
            src={source}
            alt={props.alt ?? ""}
            className="max-h-[min(90vh,920px)] w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function FootnotesSection(props: {
  children: ReactNode;
  locale: Locale;
  className?: string | undefined;
  id?: string | undefined;
}) {
  return (
    <section
      className={cn("content-footnotes footnotes", props.className)}
      data-footnotes
      data-testid="markdown-footnotes"
      id={props.id}
    >
      <Marker variant="default" className="content-footnotes-marker min-h-0 gap-1.5 text-[12px]">
        <MarkerIcon className="size-3.5">
          <BookMarked className="size-3.5 opacity-80" strokeWidth={1.75} />
        </MarkerIcon>
        <MarkerContent>{t(props.locale, "timeline.sources")}</MarkerContent>
      </Marker>
      {props.children}
    </section>
  );
}

export const MarkdownContent = memo(function MarkdownContent(props: {
  children: string;
  className?: string | undefined;
  workspacePath?: string | undefined;
  locale?: Locale | undefined;
}) {
  const text = props.children ?? "";
  const locale = props.locale ?? "en";
  if (!text) return null;

  return (
    <div className={cn("pix-md", props.className)} data-testid="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeKatex]}
        urlTransform={safeMarkdownUrl}
        components={{
          a({ href, children, className, title, id, ...rest }) {
            const restProps = rest as Record<string, unknown>;
            return (
              <MarkdownLink
                href={href}
                workspacePath={props.workspacePath}
                className={className}
                title={title}
                id={id}
                data-footnote-ref={restProps["data-footnote-ref"] ?? restProps.dataFootnoteRef}
                data-footnote-backref={
                  restProps["data-footnote-backref"] ?? restProps.dataFootnoteBackref
                }
                dataFootnoteRef={restProps.dataFootnoteRef}
                dataFootnoteBackref={restProps.dataFootnoteBackref}
                aria-describedby={
                  typeof restProps["aria-describedby"] === "string"
                    ? restProps["aria-describedby"]
                    : typeof restProps.ariaDescribedBy === "string"
                      ? restProps.ariaDescribedBy
                      : undefined
                }
                aria-label={
                  typeof restProps["aria-label"] === "string"
                    ? restProps["aria-label"]
                    : typeof restProps.ariaLabel === "string"
                      ? restProps.ariaLabel
                      : undefined
                }
              >
                {children}
              </MarkdownLink>
            );
          },
          code({ className, children }) {
            const match = /(?:^|\s)language-([^\s]+)/.exec(className ?? "");
            const code = (Array.isArray(children) ? children : [children])
              .map((child) =>
                typeof child === "string" || typeof child === "number" ? `${child}` : "",
              )
              .join("")
              .replace(/\n$/, "");
            if (match || code.includes("\n")) {
              return <ContentCodeBlock code={code} language={match?.[1]} locale={locale} />;
            }
            return <code className={className}>{children}</code>;
          },
          img({ src, alt, title }) {
            return (
              <MediaContent
                src={src}
                alt={alt}
                title={title}
                workspacePath={props.workspacePath}
                locale={locale}
              />
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          table({ children, ...tableProps }) {
            return (
              <div className="content-table-scroll">
                <table {...tableProps}>{children}</table>
              </div>
            );
          },
          section({ className, children, id, ...rest }) {
            const restProps = rest as Record<string, unknown>;
            const isFootnotes =
              (typeof className === "string" && className.includes("footnotes")) ||
              propFlag(restProps["data-footnotes"]) ||
              propFlag(restProps.dataFootnotes);
            if (isFootnotes) {
              return (
                <FootnotesSection locale={locale} className={className} id={id}>
                  {children}
                </FootnotesSection>
              );
            }
            return (
              <section className={className} id={id}>
                {children}
              </section>
            );
          },
          sup({ className, children }) {
            return <sup className={cn("content-cite-sup", className)}>{children}</sup>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
