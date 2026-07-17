export const DEFAULT_MODEL_SETTING_KEY = "default_model";

export const CLAUDE_MODELS = [
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    family: "Sonnet",
    version: "4.6",
    description: "Reliable default for everyday work",
    shortName: "S4.6",
    highCost: false,
  },
  {
    id: "claude-sonnet-5",
    name: "Sonnet 5",
    family: "Sonnet",
    version: "5",
    description: "Latest balanced model",
    shortName: "S5",
    highCost: false,
  },
  {
    id: "claude-haiku-4-5",
    name: "Haiku 4.5",
    family: "Haiku",
    version: "4.5",
    description: "Fastest for lightweight tasks",
    shortName: "H4.5",
    highCost: false,
  },
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6",
    family: "Opus",
    version: "4.6",
    description: "Strong reasoning for complex tasks",
    shortName: "O4.6",
    highCost: false,
  },
  {
    id: "claude-opus-4-7",
    name: "Opus 4.7",
    family: "Opus",
    version: "4.7",
    description: "More capable, higher cost",
    shortName: "O4.7",
    highCost: true,
  },
  {
    id: "claude-opus-4-8",
    name: "Opus 4.8",
    family: "Opus",
    version: "4.8",
    description: "Most capable Opus, higher cost",
    shortName: "O4.8",
    highCost: true,
  },
  {
    id: "claude-fable-5",
    name: "Fable 5",
    family: "Fable",
    version: "5",
    description: "Flagship capability, highest cost",
    shortName: "F5",
    highCost: true,
  },
] as const;

export type ModelId = (typeof CLAUDE_MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = "claude-sonnet-4-6";

const MODEL_IDS = new Set<string>(CLAUDE_MODELS.map((model) => model.id));

const LEGACY_MODEL_ALIASES: Record<string, ModelId> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  haiku: "claude-haiku-4-5",
  "opus-4-7": "claude-opus-4-7",
  "global.anthropic.claude-sonnet-4-6": "claude-sonnet-4-6",
  "global.anthropic.claude-sonnet-5": "claude-sonnet-5",
  "global.anthropic.claude-haiku-4-5": "claude-haiku-4-5",
  "global.anthropic.claude-opus-4-6": "claude-opus-4-6",
  "global.anthropic.claude-opus-4-7": "claude-opus-4-7",
  "global.anthropic.claude-opus-4-8": "claude-opus-4-8",
  "global.anthropic.claude-fable-5": "claude-fable-5",
};

export function normalizeModelId(value?: string | null): ModelId {
  if (value && MODEL_IDS.has(value)) {
    return value as ModelId;
  }

  if (value && LEGACY_MODEL_ALIASES[value]) {
    return LEGACY_MODEL_ALIASES[value];
  }

  return DEFAULT_MODEL_ID;
}

export function getModelOption(modelId?: string | null) {
  const normalized = normalizeModelId(modelId);
  return CLAUDE_MODELS.find((model) => model.id === normalized) ?? CLAUDE_MODELS[0];
}
