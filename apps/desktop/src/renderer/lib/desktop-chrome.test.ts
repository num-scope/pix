import { describe, expect, it } from "vite-plus/test";
import {
  MAC_TRAFFIC_LIGHT_GUTTER_PX,
  MAC_TRAFFIC_LIGHT_INSET_X_PX,
  TITLEBAR_HEIGHT_PX,
  getMacTrafficLightPosition,
  titlebarControlTopPx,
} from "./desktop-chrome.ts";

describe("desktop chrome geometry", () => {
  it("centers traffic lights on the 46px titlebar", () => {
    expect(TITLEBAR_HEIGHT_PX).toBe(46);
    const pos = getMacTrafficLightPosition();
    expect(pos.x).toBe(MAC_TRAFFIC_LIGHT_INSET_X_PX);
    // y + radius = header center
    expect(pos.y + 7).toBe(TITLEBAR_HEIGHT_PX / 2);
  });

  it("places toggle after a 90px gutter", () => {
    expect(MAC_TRAFFIC_LIGHT_GUTTER_PX).toBe(90);
    expect(MAC_TRAFFIC_LIGHT_GUTTER_PX).toBeGreaterThan(MAC_TRAFFIC_LIGHT_INSET_X_PX + 40);
    expect(titlebarControlTopPx(28)).toBe(9);
  });
});
