/**
 * Streaming-safe Markdown renderer for assistant messages.
 *
 * Stack (de-facto React standard on GitHub):
 * - react-markdown (remarkjs/react-markdown) — component model, partial MD ok
 * - remark-gfm — tables, strikethrough, task lists, autolinks
 * - rehype-sanitize — XSS safety for untrusted model output
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "../lib/utils.ts";

export const MarkdownContent = memo(function MarkdownContent(props: {
  children: string;
  className?: string;
}) {
  const text = props.children ?? "";
  if (!text) return null;

  return (
    <div className={cn("pix-md", props.className)} data-testid="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
