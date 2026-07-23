/**
 * Shared model grouping for Settings → Models and composer model picker.
 * Provider labels use stable brand casing; ids stay lowercase for keys.
 */

export type ModelGroupSource = string;

export interface GroupableModel {
  provider: string;
  id: string;
  name: string;
  source?: ModelGroupSource;
}

export interface ModelGroup<T extends GroupableModel = GroupableModel> {
  /** Stable key (provider id or "custom"). */
  key: string;
  /** Display label (localized for custom; brand-cased for providers). */
  label: string;
  models: T[];
}

/** Known provider ids → canonical display casing. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  "azure-openai-responses": "Azure OpenAI",
  google: "Google",
  "google-vertex": "Google Vertex",
  "amazon-bedrock": "Amazon Bedrock",
  deepseek: "DeepSeek",
  nvidia: "NVIDIA",
  "ant-ling": "Ant Ling",
  radius: "Radius",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
  openrouter: "OpenRouter",
  together: "Together",
  fireworks: "Fireworks",
  cohere: "Cohere",
  perplexity: "Perplexity",
};

/**
 * Display name for a provider group.
 * - known ids → brand casing (Anthropic, OpenAI, …)
 * - otherwise Title-Case each hyphen/underscore segment
 */
export function formatProviderGroupLabel(provider: string): string {
  const id = provider.trim();
  if (!id) return provider;
  const lower = id.toLowerCase();
  if (PROVIDER_LABELS[lower]) return PROVIDER_LABELS[lower]!;
  // Preserve intentional mixed-case custom provider ids that already look titled.
  if (/[A-Z]/.test(id) && id !== lower) return id;
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Same grouping as Settings → Models:
 * 1. custom (localized label)
 * 2. each built-in provider (brand-cased label), sorted by label
 */
export function groupModelsByProvider<T extends GroupableModel>(
  models: T[],
  customLabel: string,
): Array<ModelGroup<T>> {
  const custom: T[] = [];
  const byProvider = new Map<string, T[]>();
  for (const model of models) {
    if (model.source === "custom") {
      custom.push(model);
      continue;
    }
    const key = model.provider.trim() || "unknown";
    const list = byProvider.get(key) ?? [];
    list.push(model);
    byProvider.set(key, list);
  }

  const groups: Array<ModelGroup<T>> = [];
  if (custom.length > 0) {
    groups.push({
      key: "custom",
      label: customLabel,
      models: custom.slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    });
  }

  const providers = [...byProvider.entries()]
    .map(([provider, list]) => ({
      key: provider,
      label: formatProviderGroupLabel(provider),
      models: list.slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  groups.push(...providers);
  return groups;
}
