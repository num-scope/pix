import { describe, expect, it } from "vite-plus/test";
import { shouldAutoInstallPiCli } from "./pi-cli-ensure.ts";

describe("shouldAutoInstallPiCli", () => {
  it("enables product mode (no fixture env)", () => {
    expect(
      shouldAutoInstallPiCli({
        PATH: "/usr/bin",
      }),
    ).toBe(true);
  });

  it("skips isolated / explicit opt-out / fixture workspace", () => {
    expect(shouldAutoInstallPiCli({ PIX_ISOLATED: "1" })).toBe(false);
    expect(shouldAutoInstallPiCli({ PIX_SKIP_PI_INSTALL: "1" })).toBe(false);
    expect(shouldAutoInstallPiCli({ PIX_WORKSPACE: "D:/tmp/fixture" })).toBe(false);
    expect(
      shouldAutoInstallPiCli({
        PI_CODING_AGENT_DIR: "D:/tmp/agent",
        PIX_ENABLE_TEST_COMMANDS: "1",
      }),
    ).toBe(false);
  });

  it("still installs when only PI_CODING_AGENT_DIR is set without test flags", () => {
    // User may override agent dir in product; still want CLI present.
    expect(
      shouldAutoInstallPiCli({
        PI_CODING_AGENT_DIR: "D:/custom/agent",
      }),
    ).toBe(true);
  });
});
