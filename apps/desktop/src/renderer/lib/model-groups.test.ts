import { describe, expect, it } from "vite-plus/test";
import { formatProviderGroupLabel, groupModelsByProvider } from "./model-groups.ts";

describe("model-groups", () => {
  it("uses brand casing for known providers", () => {
    expect(formatProviderGroupLabel("anthropic")).toBe("Anthropic");
    expect(formatProviderGroupLabel("openai")).toBe("OpenAI");
    expect(formatProviderGroupLabel("OPENAI")).toBe("OpenAI");
    expect(formatProviderGroupLabel("google-vertex")).toBe("Google Vertex");
    expect(formatProviderGroupLabel("deepseek")).toBe("DeepSeek");
  });

  it("title-cases unknown hyphenated ids and preserves mixed-case custom ids", () => {
    expect(formatProviderGroupLabel("my-cool-llm")).toBe("My Cool Llm");
    expect(formatProviderGroupLabel("XTJ")).toBe("XTJ");
  });

  it("groups custom providers first by provider label, then builtin — same as settings", () => {
    const models = [
      { provider: "openai", id: "gpt-4o", name: "GPT-4o", source: "builtin" as const },
      { provider: "anthropic", id: "claude", name: "Claude", source: "builtin" as const },
      { provider: "XTJ", id: "gpt-5.6-sol", name: "gpt-5.6-sol", source: "custom" as const },
      { provider: "acme", id: "x", name: "X", source: "custom" as const },
    ];
    const groups = groupModelsByProvider(models, "自定义");
    // Custom first (Acme, XTJ), then builtin (Anthropic, OpenAI) — all provider labels.
    expect(groups.map((g) => g.label)).toEqual(["Acme", "XTJ", "Anthropic", "OpenAI"]);
    expect(groups.map((g) => g.key)).toEqual(["custom:acme", "custom:XTJ", "anthropic", "openai"]);
    expect(groups.every((g) => g.key !== "custom")).toBe(true);
  });
});
