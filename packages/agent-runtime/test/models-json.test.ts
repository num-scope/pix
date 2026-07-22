import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  readModelsJsonConfig,
  removeCustomProviderFromModelsJson,
  upsertCustomProviderInModelsJson,
} from "../src/models-json.ts";

async function tempAgentDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pix-models-json-"));
}

describe("models.json helpers", () => {
  it("upserts a full pi-native model entry without writing apiKey secrets", async () => {
    const agentDir = await tempAgentDir();
    const view = await upsertCustomProviderInModelsJson(agentDir, {
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      modelId: "llama3.1:8b",
      modelName: "Llama 3.1 8B",
      reasoning: true,
      input: "text-image",
      contextWindow: 64000,
      maxTokens: 4096,
      costInput: 1,
      costOutput: 2,
      costCacheRead: 0.1,
      costCacheWrite: 0.2,
      authHeader: true,
      apiKey: "should-not-be-written",
    });

    expect(view.exists).toBe(true);
    expect(view.providers).toHaveLength(1);
    expect(view.providers[0]?.provider).toBe("ollama");
    expect(view.providers[0]?.baseUrl).toBe("http://localhost:11434/v1");
    expect(view.providers[0]?.models[0]?.id).toBe("llama3.1:8b");
    expect(view.providers[0]?.hasApiKeyField).toBe(false);

    const raw = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
      providers: Record<
        string,
        {
          apiKey?: string;
          authHeader?: boolean;
          models: Array<{
            id: string;
            name?: string;
            reasoning?: boolean;
            input?: string[];
            contextWindow?: number;
            maxTokens?: number;
            cost?: Record<string, number>;
          }>;
        }
      >;
    };
    expect(raw.providers.ollama?.apiKey).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("should-not-be-written");
    expect(raw.providers.ollama?.authHeader).toBe(true);
    const model = raw.providers.ollama?.models.find((m) => m.id === "llama3.1:8b");
    expect(model?.name).toBe("Llama 3.1 8B");
    expect(model?.reasoning).toBe(true);
    expect(model?.input).toEqual(["text", "image"]);
    expect(model?.contextWindow).toBe(64000);
    expect(model?.maxTokens).toBe(4096);
    expect(model?.cost).toEqual({
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 0.2,
    });

    // Merge second model; preserve existing apiKey field if present.
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            apiKey: "ollama",
            models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B" }],
            unknownKeep: true,
          },
        },
        extraTop: 1,
      }),
      "utf8",
    );

    const merged = await upsertCustomProviderInModelsJson(agentDir, {
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      modelId: "qwen2.5-coder:7b",
    });
    expect(merged.providers[0]?.models.map((m) => m.id).sort()).toEqual([
      "llama3.1:8b",
      "qwen2.5-coder:7b",
    ]);
    expect(merged.providers[0]?.hasApiKeyField).toBe(true);

    const after = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
      extraTop?: number;
      providers: Record<string, { apiKey?: string; unknownKeep?: boolean }>;
    };
    expect(after.extraTop).toBe(1);
    expect(after.providers.ollama?.apiKey).toBe("ollama");
    expect(after.providers.ollama?.unknownKeep).toBe(true);

    const removed = await removeCustomProviderFromModelsJson(agentDir, "ollama");
    expect(removed.providers).toHaveLength(0);
    expect(JSON.stringify(await readModelsJsonConfig(agentDir))).not.toMatch(/ollama-secret|sk-/i);
  });

  it("rejects invalid provider ids", async () => {
    const agentDir = await tempAgentDir();
    await expect(
      upsertCustomProviderInModelsJson(agentDir, {
        provider: "../evil",
        baseUrl: "http://localhost",
        api: "openai-completions",
        modelId: "x",
      }),
    ).rejects.toThrow(/Provider id/);
  });

  it("renames a model via previousProvider/previousModelId", async () => {
    const agentDir = await tempAgentDir();
    await upsertCustomProviderInModelsJson(agentDir, {
      provider: "local",
      baseUrl: "http://localhost:8080/v1",
      api: "openai-completions",
      modelId: "old-id",
      modelName: "Old",
    });
    const renamed = await upsertCustomProviderInModelsJson(agentDir, {
      provider: "local",
      baseUrl: "http://localhost:8080/v1",
      api: "openai-completions",
      modelId: "new-id",
      modelName: "New",
      previousProvider: "local",
      previousModelId: "old-id",
    });
    const ids = renamed.providers[0]?.models.map((m) => m.id) ?? [];
    expect(ids).toEqual(["new-id"]);
    expect(renamed.providers[0]?.models[0]?.name).toBe("New");
  });
});
