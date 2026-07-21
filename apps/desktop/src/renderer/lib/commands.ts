import type { ShellView } from "../store/shell-store.ts";
import {
  formatComboDisplay,
  getEffectiveCombo,
  loadShortcutOverrides,
  type ShortcutId,
} from "./shortcuts.ts";

export interface ShellCommand {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface CommandHandlers {
  newThread: () => void | Promise<void>;
  openPackages: () => void | Promise<void>;
  openResources: () => void | Promise<void>;
  openSettings: () => void | Promise<void>;
  focusComposer: () => void;
  openThread: () => void;
  toggleTheme: () => void;
  forkThread: () => void | Promise<void>;
  toggleReview: () => void;
  toggleEnvPanel?: () => void;
}

function withShortcut(id: ShortcutId, base: Omit<ShellCommand, "shortcut">): ShellCommand {
  const c = getEffectiveCombo(id, loadShortcutOverrides());
  if (!c) return base;
  return { ...base, shortcut: formatComboDisplay(c) };
}

export function buildShellCommands(handlers: CommandHandlers): ShellCommand[] {
  const list: ShellCommand[] = [
    withShortcut("new-thread", {
      id: "new-thread",
      label: "New session",
      run: handlers.newThread,
    }),
    withShortcut("packages", {
      id: "packages",
      label: "Open Packages",
      run: handlers.openPackages,
    }),
    withShortcut("resources", {
      id: "resources",
      label: "Open Resources",
      run: handlers.openResources,
    }),
    withShortcut("settings", {
      id: "settings",
      label: "Open Settings",
      run: handlers.openSettings,
    }),
    withShortcut("thread", {
      id: "thread",
      label: "Back to thread",
      run: handlers.openThread,
    }),
    withShortcut("focus-composer", {
      id: "focus-composer",
      label: "Focus composer",
      run: handlers.focusComposer,
    }),
    withShortcut("fork-thread", {
      id: "fork-thread",
      label: "Fork thread from last user message",
      run: handlers.forkThread,
    }),
    withShortcut("toggle-theme", {
      id: "toggle-theme",
      label: "Toggle light/dark theme",
      run: handlers.toggleTheme,
    }),
    {
      id: "toggle-review",
      label: "Toggle review panel",
      run: handlers.toggleReview,
    },
  ];
  if (handlers.toggleEnvPanel) {
    list.push(
      withShortcut("toggle-env-panel", {
        id: "toggle-env-panel",
        label: "Toggle environment panel",
        run: handlers.toggleEnvPanel,
      }),
    );
  }
  return list;
}

export function viewFromCommandId(id: string): ShellView | undefined {
  if (id === "packages") return "packages";
  if (id === "resources") return "resources";
  if (id === "settings") return "settings";
  if (id === "thread" || id === "new-thread" || id === "focus-composer") return "thread";
  return undefined;
}
