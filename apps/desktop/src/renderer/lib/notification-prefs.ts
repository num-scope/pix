/**
 * Desktop notification preferences (localStorage — not pi settings).
 */

export type NotificationPrefs = {
  /** Master switch for OS notifications. */
  enabled: boolean;
  /** Notify when an agent turn settles successfully. */
  onComplete: boolean;
  /** Notify when an agent turn fails. */
  onError: boolean;
  /** Notify when host crashes / restarts unexpectedly. */
  onHostCrash: boolean;
  /** Only show OS notifications when the window is unfocused. */
  onlyWhenUnfocused: boolean;
  /** Play a short system sound with the notification (best-effort). */
  sound: boolean;
};

const KEY = "pix.notifications.prefs";

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  onComplete: true,
  onError: true,
  onHostCrash: true,
  onlyWhenUnfocused: true,
  sound: false,
};

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      enabled: parsed.enabled !== false,
      onComplete: parsed.onComplete !== false,
      onError: parsed.onError !== false,
      onHostCrash: parsed.onHostCrash !== false,
      onlyWhenUnfocused: parsed.onlyWhenUnfocused !== false,
      sound: parsed.sound === true,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function patchNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = { ...loadNotificationPrefs(), ...patch };
  saveNotificationPrefs(next);
  return next;
}
