import { describe, expect, it } from "vite-plus/test";
import {
  PROJECT_THREADS_PAGE,
  getVisibleThreadCount,
  isArchivedProject,
  isPinnedProject,
  partitionProjects,
  sortProjectPaths,
  sortThreadsByMode,
} from "./project-prefs.ts";

describe("project prefs helpers", () => {
  it("partitions pinned vs rest and drops archived", () => {
    const { pinned, rest } = partitionProjects(["/a", "/b", "/c", "/a"], ["/b"], ["/c"]);
    expect(pinned).toEqual(["/b"]);
    expect(rest).toEqual(["/a"]);
    expect(isPinnedProject("/b", pinned)).toBe(true);
    expect(isArchivedProject("/c", ["/c"])).toBe(true);
  });

  it("defaults visible thread page size to 5", () => {
    expect(PROJECT_THREADS_PAGE).toBe(5);
    expect(getVisibleThreadCount("/x", {})).toBe(5);
    expect(getVisibleThreadCount("/x", { "/x": 10 })).toBe(10);
  });

  it("sorts threads by priority / recent", () => {
    const threads = [
      { id: "a", modifiedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", modifiedAt: "2026-03-01T00:00:00.000Z" },
      { id: "c", modifiedAt: "2026-02-01T00:00:00.000Z" },
    ];
    expect(sortThreadsByMode(threads, "recent", []).map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(sortThreadsByMode(threads, "priority", ["c"]).map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts project paths by priority / recent", () => {
    const paths = ["/z/zebra", "/a/alpha", "/m/mid"];
    expect(sortProjectPaths(paths, "priority")).toEqual(["/a/alpha", "/m/mid", "/z/zebra"]);
    expect(
      sortProjectPaths(paths, "recent", { recentOrder: ["/m/mid", "/z/zebra", "/a/alpha"] }),
    ).toEqual(["/m/mid", "/z/zebra", "/a/alpha"]);
  });
});
