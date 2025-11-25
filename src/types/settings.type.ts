export type AIProvider = "openrouter" | "openai" | "claude";

export interface ProviderSettings {
  apiKey: string;
  model: string;
}

export interface SettingsType {
  provider: AIProvider;
  providers: {
    openrouter: ProviderSettings;
    openai: ProviderSettings;
    claude: ProviderSettings;
  };
}

export const defaultSettings: SettingsType = {
  provider: "openrouter",
  providers: {
    openrouter: {
      apiKey: "",
      model: "meta-llama/llama-3.2-3b-instruct:free",
    },
    openai: {
      apiKey: "",
      model: "gpt-4",
    },
    claude: {
      apiKey: "",
      model: "claude-3-5-sonnet-20241022",
    },
  },
};

