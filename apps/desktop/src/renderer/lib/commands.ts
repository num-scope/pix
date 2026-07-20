import type { ShellView } from "../store/shell-store.ts";

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
}

export function buildShellCommands(handlers: CommandHandlers): ShellCommand[] {
  return [
    {
      id: "new-thread",
      label: "New session",
      shortcut: "⌘N",
      run: handlers.newThread,
    },
    {
      id: "packages",
      label: "Open Packages",
      shortcut: "⌘P",
      run: handlers.openPackages,
    },
    {
      id: "resources",
      label: "Open Resources",
      run: handlers.openResources,
    },
    {
      id: "settings",
      label: "Open Settings",
      shortcut: "⌘,",
      run: handlers.openSettings,
    },
    {
      id: "thread",
      label: "Back to thread",
      run: handlers.openThread,
    },
    {
      id: "focus-composer",
      label: "Focus composer",
      shortcut: "⌘J",
      run: handlers.focusComposer,
    },
    {
      id: "fork-thread",
      label: "Fork thread from last user message",
      shortcut: "⌘⇧F",
      run: handlers.forkThread,
    },
    {
      id: "toggle-theme",
      label: "Toggle light/dark theme",
      shortcut: "⌘⇧T",
      run: handlers.toggleTheme,
    },
    {
      id: "toggle-review",
      label: "Toggle review panel",
      run: handlers.toggleReview,
    },
  ];
}

export function viewFromCommandId(id: string): ShellView | undefined {
  if (id === "packages") return "packages";
  if (id === "resources") return "resources";
  if (id === "settings") return "settings";
  if (id === "thread" || id === "new-thread" || id === "focus-composer") return "thread";
  return undefined;
}
