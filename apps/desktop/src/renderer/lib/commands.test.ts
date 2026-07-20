import { describe, expect, it, vi } from "vite-plus/test";
import { buildShellCommands, viewFromCommandId } from "./commands.ts";

describe("buildShellCommands", () => {
  it("registers navigation commands over existing shell handlers", () => {
    const handlers = {
      newThread: vi.fn(),
      openPackages: vi.fn(),
      openResources: vi.fn(),
      openSettings: vi.fn(),
      focusComposer: vi.fn(),
      openThread: vi.fn(),
      toggleTheme: vi.fn(),
      forkThread: vi.fn(),
      toggleReview: vi.fn(),
    };
    const commands = buildShellCommands(handlers);
    const ids = commands.map((command) => command.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "new-thread",
        "packages",
        "resources",
        "settings",
        "focus-composer",
        "fork-thread",
        "toggle-theme",
      ]),
    );
    void commands.find((command) => command.id === "packages")?.run();
    expect(handlers.openPackages).toHaveBeenCalledTimes(1);
    expect(viewFromCommandId("packages")).toBe("packages");
    expect(viewFromCommandId("settings")).toBe("settings");
  });
});
