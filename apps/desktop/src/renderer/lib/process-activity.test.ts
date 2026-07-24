import { describe, expect, it } from "vite-plus/test";
import { classifyToolName, groupConsecutiveTools, processToolView } from "./process-activity.ts";

describe("process activity", () => {
  it("classifies common tool names", () => {
    expect(classifyToolName("read")).toBe("read");
    expect(classifyToolName("bash")).toBe("run");
    expect(classifyToolName("grep")).toBe("search");
    expect(classifyToolName("edit")).toBe("edit");
    expect(classifyToolName("write")).toBe("write");
    expect(classifyToolName("ls")).toBe("list");
  });

  it("extracts path / command / query for row previews", () => {
    expect(processToolView("read", { path: "src/index.ts" })).toMatchObject({
      kind: "read",
      path: "src/index.ts",
      preview: "index.ts",
    });
    expect(processToolView("bash", { command: "rg -n foo" })).toMatchObject({
      kind: "run",
      detail: "rg -n foo",
    });
    expect(processToolView("grep", { path: "a.ts", query: "render" })).toMatchObject({
      kind: "search",
      path: "a.ts",
      detail: "render",
    });
  });

  it("groups consecutive tools of the same kind", () => {
    const groups = groupConsecutiveTools([
      { kind: "tool" as const, toolName: "read" },
      { kind: "tool" as const, toolName: "read" },
      { kind: "tool" as const, toolName: "bash" },
      { kind: "tool" as const, toolName: "edit" },
      { kind: "tool" as const, toolName: "edit" },
      { kind: "tool" as const, toolName: "edit" },
    ]);
    expect(groups.map((g) => g.type)).toEqual(["group", "single", "group"]);
    expect(groups[0]).toMatchObject({ type: "group", kind: "read" });
    expect(groups[1]).toMatchObject({ type: "single" });
    expect(groups[2]).toMatchObject({ type: "group", kind: "edit" });
  });
});
