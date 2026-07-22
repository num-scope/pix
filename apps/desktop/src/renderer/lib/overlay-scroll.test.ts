import { describe, expect, it } from "vite-plus/test";
import { OVERLAY_SCROLL_SELECTOR, scrollTopFromThumbDrag } from "./overlay-scroll.ts";

describe("overlay-scroll", () => {
  it("covers main content and shared scrollport class", () => {
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".pix-scroll");
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".page-body");
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".settings-page-body");
    expect(OVERLAY_SCROLL_SELECTOR).toContain(".timeline-scroll");
  });

  it("maps thumb movement directly onto the full scroll range", () => {
    expect(
      scrollTopFromThumbDrag({
        startScrollTop: 200,
        deltaY: 80,
        clientHeight: 200,
        scrollHeight: 1_000,
        thumbHeight: 40,
      }),
    ).toBe(600);
  });

  it("clamps thumb dragging at both scroll boundaries", () => {
    const metrics = { clientHeight: 200, scrollHeight: 1_000, thumbHeight: 40 };
    expect(scrollTopFromThumbDrag({ ...metrics, startScrollTop: 100, deltaY: -500 })).toBe(0);
    expect(scrollTopFromThumbDrag({ ...metrics, startScrollTop: 700, deltaY: 500 })).toBe(800);
  });
});
