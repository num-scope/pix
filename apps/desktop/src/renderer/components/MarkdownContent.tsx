/** Streaming-safe rich content renderer for assistant messages. */
import { memo, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Maximize2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { ContentCodeBlock } from "./ContentCodeBlock.tsx";
import { contentMediaKind, contentSourceUrl, parseContentLink } from "../lib/content-rendering.ts";
import { t, type Locale } from "../lib/i18n.ts";
import { cn } from "../lib/utils.ts";

function safeMarkdownUrl(url: string, key: string): string {
  if (/^(javascript:|vbscript:)/i.test(url)) return "";
  if (key === "src" && /^data:/i.test(url) && !/^data:image\//i.test(url)) return "";
  return url;
}

function MarkdownLink(props: {
  href?: string | undefined;
  children: ReactNode;
  workspacePath?: string | undefined;
}) {
  const href = props.href ?? "";
  const target = parseContentLink(href, props.workspacePath);
  if (target.kind === "blocked") return <span>{props.children}</span>;

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (target.kind === "anchor") return;
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

  return (
    <a
      href={href}
      onClick={open}
      className={cn(target.kind === "file" && "content-file-link")}
      title={target.kind === "file" ? target.path : undefined}
    >
      {props.children}
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

  useEffect(() => {
    if (!previewOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [previewOpen]);

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
      {previewOpen
        ? createPortal(
            <div
              className="content-image-preview"
              role="dialog"
              aria-modal="true"
              aria-label={props.alt || t(props.locale, "timeline.imagePreview")}
              onClick={() => setPreviewOpen(false)}
            >
              <button
                type="button"
                className="content-image-preview-close"
                onClick={() => setPreviewOpen(false)}
                aria-label={t(props.locale, "timeline.imagePreviewClose")}
              >
                <X className="size-4" />
              </button>
              <img
                src={source}
                alt={props.alt ?? ""}
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </>
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
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        urlTransform={safeMarkdownUrl}
        components={{
          a({ href, children }) {
            return (
              <MarkdownLink href={href} workspacePath={props.workspacePath}>
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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
