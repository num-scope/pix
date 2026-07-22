import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { MarkdownContent } from "./MarkdownContent.tsx";

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(MarkdownContent, { children: markdown }));
}

describe("MarkdownContent", () => {
  it("renders math, highlighted code, diffs, tables, and Mermaid placeholders", () => {
    expect(render("$E = mc^2$")).toContain("katex");
    expect(render("```javascript\nconst answer = 42\n```")).toContain("content-code-block");
    expect(render("```diff\n-old\n+new\n```")).toContain('data-diff="remove"');
    expect(render("| A | B |\n| - | - |\n| 1 | 2 |")).toContain("content-table-scroll");
    expect(render("```mermaid\ngraph TD; A--&gt;B\n```")).toContain("content-mermaid-loading");
  });

  it("blocks executable link protocols and renders local images as previewable media", () => {
    expect(render("[unsafe](javascript:alert(1))")).not.toContain("javascript:alert");
    const image = render("![preview](/tmp/design%20preview.png)");
    expect(image).toContain("content-image-button");
    expect(image).toContain("file:///tmp/design%20preview.png");
  });
});
