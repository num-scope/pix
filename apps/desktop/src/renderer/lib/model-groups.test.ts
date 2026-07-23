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

  it("title-cases unknown hyphenated ids", () => {
    expect(formatProviderGroupLabel("my-cool-llm")).toBe("My Cool Llm");
  });

  it("groups custom first then providers by label, shared by settings and composer", () => {
    const models = [
      { provider: "openai", id: "gpt-4o", name: "GPT-4o", source: "builtin" as const },
      { provider: "anthropic", id: "claude", name: "Claude", source: "builtin" as const },
      { provider: "acme", id: "x", name: "X", source: "custom" as const },
    ];
    const groups = groupModelsByProvider(models, "自定义");
    expect(groups.map((g) => g.label)).toEqual(["自定义", "Anthropic", "OpenAI"]);
    expect(groups[0]?.key).toBe("custom");
    expect(groups[1]?.key).toBe("anthropic");
    expect(groups[2]?.key).toBe("openai");
  });
});
