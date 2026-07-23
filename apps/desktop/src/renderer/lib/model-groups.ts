/**
 * Shared model grouping for Settings → Models and composer model picker.
 * Custom and builtin providers both use the same display labels
 * (`formatProviderGroupLabel`); custom groups are listed first (settings order).
 */

export type ModelGroupSource = string;

export interface GroupableModel {
  provider: string;
  id: string;
  name: string;
  source?: ModelGroupSource;
}

export interface ModelGroup<T extends GroupableModel = GroupableModel> {
  /** Stable key: provider id (custom and builtin use the same key space per list). */
  key: string;
  /** Display label (brand-cased / title-cased provider id). */
  label: string;
  models: T[];
  /** True when every model in the group is custom (settings lists these first). */
  custom?: boolean;
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
 * - mixed-case custom ids (e.g. XTJ) preserved as-is
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

function sortModelsInGroup<T extends GroupableModel>(list: T[]): T[] {
  return list.slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

function mapToGroups<T extends GroupableModel>(
  map: Map<string, T[]>,
  custom: boolean,
): Array<ModelGroup<T>> {
  return [...map.entries()]
    .map(([provider, list]) => ({
      key: custom ? `custom:${provider}` : provider,
      label: formatProviderGroupLabel(provider),
      models: sortModelsInGroup(list),
      custom,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/**
 * Same grouping as Settings → Models:
 * 1. each custom provider (label via formatProviderGroupLabel), sorted by label
 * 2. each built-in provider (brand-cased label), sorted by label
 *
 * `customLabel` is kept for API compatibility (empty custom section title in settings)
 * but is no longer used to lump all custom models under one group.
 */
export function groupModelsByProvider<T extends GroupableModel>(
  models: T[],
  _customLabel?: string,
): Array<ModelGroup<T>> {
  const customByProvider = new Map<string, T[]>();
  const builtinByProvider = new Map<string, T[]>();

  for (const model of models) {
    const key = model.provider.trim() || "unknown";
    const target = model.source === "custom" ? customByProvider : builtinByProvider;
    const list = target.get(key) ?? [];
    list.push(model);
    target.set(key, list);
  }

  return [...mapToGroups(customByProvider, true), ...mapToGroups(builtinByProvider, false)];
}
