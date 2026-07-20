/**
 * macOS desktop chrome geometry (aligned with Synara desktopChrome.ts).
 * Main process trafficLightPosition and renderer gutter must stay in lockstep.
 */

/** Shared titlebar row height (traffic lights vertically centered on this). */
export const TITLEBAR_HEIGHT_PX = 46;

/** Leading inset of the traffic-light cluster from the window left edge. */
export const MAC_TRAFFIC_LIGHT_INSET_X_PX = 16;

/** Radius of a traffic-light dot (~14px diameter → 7). */
export const MAC_TRAFFIC_LIGHT_DOT_RADIUS_PX = 7;

/**
 * Leading inset from window left to the first chrome control (sidebar toggle)
 * so it sits just after the native lights — not under them.
 */
export const MAC_TRAFFIC_LIGHT_GUTTER_PX = 90;

/** Control size matching Synara `size-7` icon buttons. */
export const TITLEBAR_CONTROL_SIZE_PX = 28;

export function getMacTrafficLightPosition(): { x: number; y: number } {
  return {
    x: MAC_TRAFFIC_LIGHT_INSET_X_PX,
    y: Math.round(TITLEBAR_HEIGHT_PX / 2 - MAC_TRAFFIC_LIGHT_DOT_RADIUS_PX),
  };
}

/** Vertical offset to center a control in the titlebar row. */
export function titlebarControlTopPx(controlSize = TITLEBAR_CONTROL_SIZE_PX): number {
  return Math.round((TITLEBAR_HEIGHT_PX - controlSize) / 2);
}
