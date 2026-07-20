import { describe, expect, it } from "vite-plus/test";
import {
  PROJECT_THREADS_PAGE,
  getVisibleThreadCount,
  isArchivedProject,
  isPinnedProject,
  partitionProjects,
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
});
