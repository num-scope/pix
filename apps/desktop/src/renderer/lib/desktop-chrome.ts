/**
 * Desktop chrome geometry (aligned with Synara desktopChrome.ts on macOS).
 * Main process trafficLightPosition and renderer gutter must stay in lockstep on macOS.
 */

/** Shared titlebar row height (traffic lights / window chrome vertically centered). */
export const TITLEBAR_HEIGHT_PX = 46;

/** Leading inset of the traffic-light cluster from the window left edge (macOS only). */
export const MAC_TRAFFIC_LIGHT_INSET_X_PX = 16;

/** Radius of a traffic-light dot (~14px diameter → 7). */
export const MAC_TRAFFIC_LIGHT_DOT_RADIUS_PX = 7;

/**
 * Leading inset from window left to the first chrome control (sidebar toggle) on macOS
 * so it sits just after the native lights — not under them.
 */
export const MAC_TRAFFIC_LIGHT_GUTTER_PX = 90;

/**
 * Windows / Linux keep the native frame (min/max/close on the right). Collapse control
 * only needs a small leading pad — not the mac traffic-light gutter.
 */
export const NON_MAC_TITLEBAR_LEADING_GUTTER_PX = 12;

/** Control size matching Synara `size-7` icon buttons. */
export const TITLEBAR_CONTROL_SIZE_PX = 28;

export function isMacDesktopChrome(
  platform: string | undefined = typeof navigator !== "undefined" ? navigator.platform : undefined,
  userAgent: string | undefined = typeof navigator !== "undefined"
    ? navigator.userAgent
    : undefined,
): boolean {
  const p = platform ?? "";
  const ua = userAgent ?? "";
  return /Mac|iPhone|iPod|iPad/i.test(p) || /Mac OS X/i.test(ua);
}

/** Leading spacer before the sidebar collapse/expand control. */
export function titlebarLeadingGutterPx(isMac = isMacDesktopChrome()): number {
  return isMac ? MAC_TRAFFIC_LIGHT_GUTTER_PX : NON_MAC_TITLEBAR_LEADING_GUTTER_PX;
}

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
