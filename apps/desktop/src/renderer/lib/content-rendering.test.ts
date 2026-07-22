import { describe, expect, it } from "vite-plus/test";
import { contentMediaKind, contentSourceUrl, parseContentLink } from "./content-rendering.ts";

describe("conversation content targets", () => {
  it("classifies video sources independently from images", () => {
    expect(contentMediaKind("/tmp/demo.mp4?download=1")).toBe("video");
    expect(contentMediaKind("/tmp/screenshot.webp")).toBe("image");
  });

  it("parses local file line links and safe external URLs", () => {
    expect(parseContentLink("/tmp/app.ts:42:7")).toEqual({
      kind: "file",
      path: "/tmp/app.ts",
      line: 42,
      column: 7,
    });
    expect(parseContentLink("src/app.ts#L12", "/work/project")).toEqual({
      kind: "file",
      path: "/work/project/src/app.ts",
      line: 12,
    });
    expect(parseContentLink("https://example.com/docs")).toEqual({
      kind: "external",
      href: "https://example.com/docs",
    });
    expect(parseContentLink("javascript:alert(1)")).toEqual({ kind: "blocked" });
  });

  it("converts local media paths to encoded file URLs", () => {
    expect(contentSourceUrl("/tmp/design preview.png")).toBe("file:///tmp/design%20preview.png");
  });
});
