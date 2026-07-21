/**
 * Auth / OAuth plan limit hints (not live session token accounting).
 * Mirrors common product messaging: ChatGPT weekly caps, Copilot quotas, etc.
 * Actual remaining quota is only known from the provider when rate-limited.
 */

export type UsageLimitPeriod = "weekly" | "daily" | "monthly" | "unknown";

export type ProviderUsageLimitInfo = {
  provider: string;
  period: UsageLimitPeriod;
  /** Short product-facing note (i18n key or plain; UI will prefer i18n when present). */
  noteKey?: string;
  noteFallback?: string;
};

/** Known OAuth / subscription-style providers and their typical limit windows. */
const KNOWN_LIMITS: Record<string, Omit<ProviderUsageLimitInfo, "provider">> = {
  "openai-codex": {
    period: "weekly",
    noteFallback: "ChatGPT / Codex 订阅额度通常按周重置，具体以 OpenAI 账号页为准。",
  },
  openai: {
    period: "unknown",
    noteFallback: "OpenAI API 按用量计费；ChatGPT 订阅模型可能另有周限额。",
  },
  "github-copilot": {
    period: "monthly",
    noteFallback: "GitHub Copilot 套餐按席位与月额度计费。",
  },
  anthropic: {
    period: "unknown",
    noteFallback: "Anthropic API 按用量计费；Claude 订阅可能有消息频率限制。",
  },
  "google-gemini-cli": {
    period: "daily",
    noteFallback: "Gemini CLI / 订阅类额度常按日或项目配额限制。",
  },
  google: {
    period: "unknown",
    noteFallback: "Google AI 额度取决于项目与套餐。",
  },
  openrouter: {
    period: "unknown",
    noteFallback: "OpenRouter 按账户余额与速率限制。",
  },
};

export function resolveProviderUsageLimit(provider: string): ProviderUsageLimitInfo {
  const known = KNOWN_LIMITS[provider];
  if (known) {
    return { provider, ...known };
  }
  return {
    provider,
    period: "unknown",
  };
}

export function periodMessageKey(period: UsageLimitPeriod): string {
  if (period === "weekly") return "usage.periodWeekly";
  if (period === "daily") return "usage.periodDaily";
  if (period === "monthly") return "usage.periodMonthly";
  return "usage.periodUnknown";
}
