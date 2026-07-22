import { describe, expect, it } from "vite-plus/test";
import {
  addResourceQuery,
  attachmentLabel,
  attachmentPresentation,
  filterResourceCommands,
  filterSlashCommands,
  promptWithAttachedPaths,
  slashCommandQuery,
} from "./composer-suggestions.ts";

describe("composer suggestions", () => {
  it("only opens command panels for a single active trigger token", () => {
    expect(slashCommandQuery("/rev")).toBe("rev");
    expect(slashCommandQuery("/review now")).toBeUndefined();
    expect(addResourceQuery("@skill")).toBe("skill");
    expect(addResourceQuery("please @skill")).toBeUndefined();
  });

  it("filters names and descriptions with prefix matches first", () => {
    const commands = [
      { name: "skill:review", description: "Inspect changes", source: "skill" as const },
      { name: "release", description: "Review release", source: "prompt" as const },
    ];
    expect(filterSlashCommands(commands, "rev").map((command) => command.name)).toEqual([
      "release",
      "skill:review",
    ]);
  });

  it("keeps skills exclusive to slash suggestions", () => {
    const commands = [
      { name: "skill:review", description: "Inspect changes", source: "skill" as const },
      { name: "review", description: "Review workspace", source: "prompt" as const },
      { name: "reload", description: "Reload extensions", source: "extension" as const },
    ];

    expect(filterSlashCommands(commands, "").map((command) => command.name)).toContain(
      "skill:review",
    );
    expect(filterResourceCommands(commands, "").map((command) => command.name)).toEqual([
      "reload",
      "review",
    ]);
  });

  it("formats readable path context and portable labels", () => {
    expect(attachmentLabel("C:\\work\\notes.md")).toBe("notes.md");
    expect(promptWithAttachedPaths("Inspect", ["/tmp/a&b.md"])).toContain(
      "<path>/tmp/a&amp;b.md</path>",
    );
  });

  it.each([
    ["report.xlsx", "spreadsheet", "Excel"],
    ["photo.png", "image", "PNG"],
    ["brief.pdf", "pdf", "PDF"],
    ["deck.pptx", "presentation", "PowerPoint"],
    ["proposal.docx", "document", "Word"],
    ["bundle.zip", "archive", "ZIP"],
    ["notes.txt", "text", "Text"],
    ["README.md", "text", "Markdown"],
    ["Main.java", "code", "Java"],
    ["app.js", "code", "JavaScript"],
    ["worker.py", "code", "Python"],
  ])("classifies %s as a %s card", (file, kind, typeLabel) => {
    expect(attachmentPresentation(`/tmp/${file}`)).toEqual({ kind, typeLabel });
  });
});
