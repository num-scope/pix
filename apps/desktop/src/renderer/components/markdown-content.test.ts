import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { MarkdownContent } from "./MarkdownContent.tsx";

function render(markdown: string, workspacePath?: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownContent, {
      children: markdown,
      locale: "en",
      ...(workspacePath ? { workspacePath } : {}),
    }),
  );
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

  it("renders GFM footnotes as a Sources section with citation chips", () => {
    const html = render(
      [
        "See the design[^1] and docs[^docs].",
        "",
        "[^1]: First source note.",
        "[^docs]: Second source.",
      ].join("\n"),
    );
    expect(html).toContain('data-testid="markdown-footnotes"');
    expect(html).toContain("Sources");
    expect(html).toContain("content-cite-ref");
    expect(html).toContain("First source note");
    expect(html).toContain("Second source");
    expect(html).toContain("content-cite-backref");
  });

  it("renders file path source citations with line markers", () => {
    const html = render("[app.ts](src/app.ts#L12C3)", "/work/project");
    expect(html).toContain("content-source-cite");
    expect(html).toContain("content-file-link");
    expect(html).toContain("content-source-line");
    expect(html).toContain(":12:3");
    expect(html).toContain('title="/work/project/src/app.ts:12:3"');
  });

  it("renders markdown reference-style links", () => {
    const html = render(
      ["See [docs][ref].", "", '[ref]: https://example.com/docs "Docs"'].join("\n"),
    );
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("docs");
  });
});
