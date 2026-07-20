import { describe, expect, it } from "vite-plus/test";
import { OVERLAY_SCROLL_SELECTOR } from "./overlay-scroll.ts";

describe("overlay-scroll", () => {
  it("covers main content and shared scrollport class", () => {
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".pix-scroll");
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".page-body");
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".settings-page-body");
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".timeline-scroll");
  });
});
