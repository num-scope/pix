import { describe, expect, it } from "vite-plus/test";
import {
  filterRecentWorkspaces,
  isEphemeralWorkspacePath,
  prependRecentPath,
  workspaceLabel,
} from "./workspace.ts";

describe("workspace helpers", () => {
  it("labels paths for the sidebar chip", () => {
    expect(workspaceLabel("/Users/me/code/pix")).toEqual({ name: "pix", detail: "code" });
    expect(workspaceLabel(undefined).name).toBe("");
  });

  it("prepends and dedupes recent workspace paths", () => {
    expect(prependRecentPath(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
    expect(prependRecentPath(["/a", "/b"], "/b")).toEqual(["/b", "/a"]);
    expect(prependRecentPath(["/1", "/2", "/3"], "/4", 3)).toEqual(["/4", "/1", "/2"]);
  });

  it("filters e2e/tmp workspaces and current cwd from recent list", () => {
    expect(isEphemeralWorkspacePath("/var/folders/xx/T/pix-e2e-abc/workspace")).toBe(true);
    expect(isEphemeralWorkspacePath("/Users/me/code/pix")).toBe(false);
    const paths = [
      "/Users/me/code/pix",
      "/var/folders/xx/T/pix-e2e-abc/workspace",
      "/Users/me/code/other",
      "/Users/me/code/pix",
      "/tmp/pix-m0-xyz/workspace",
    ];
    expect(filterRecentWorkspaces(paths, { current: "/Users/me/code/pix", max: 5 })).toEqual([
      "/Users/me/code/other",
    ]);
    expect(prependRecentPath(["/Users/me/a"], "/tmp/pix-e2e-x/workspace")).toEqual(["/Users/me/a"]);
  });
});
