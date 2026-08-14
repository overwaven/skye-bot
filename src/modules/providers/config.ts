import { z } from "zod";
import { builtinToolSchema } from "../llm/config.js";
import { MODEL_CAPABILITIES, PROVIDER_KINDS } from "./types.js";

const configuredProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(PROVIDER_KINDS),
  base_url: z.string().url(),
  api_key: z.string().default(""),
  enabled: z.boolean().default(true),
});

const configuredModelSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  capabilities: z.array(z.enum(MODEL_CAPABILITIES)).min(1),
  context_window: z.number().int().positive().default(128_000),
  multiplier: z.number().positive().default(1),
  enabled: z.boolean().default(true),
  api_mode: z.enum(["responses", "chat-completions"]).optional(),
  builtin_tools: z.array(builtinToolSchema).optional(),
  preset: z.string().optional(),
  aspect_ratio: z.string().optional(),
  resolution: z.enum(["1k", "2k", ""]).optional(),
  voice: z.string().optional(),
  voices: z.array(z.string()).optional(),
  language: z.string().optional(),
  audio_format: z.enum(["mp3", "wav", "pcm", "oggopus"]).optional(),
  expressive: z.boolean().optional(),
  pcm_sample_rate: z.number().int().positive().optional(),
  pcm_channels: z.number().int().positive().optional(),
});

const aiSectionSchema = z
  .object({
    providers: z.array(configuredProviderSchema).default([]),
    models: z.array(configuredModelSchema).default([]),
    defaults: z
      .object({
        text: z.string().default(""),
        image: z.string().default(""),
        tts: z.string().default(""),
        stt: z.string().default(""),
        voice: z.string().default(""),
      })
      .default({ text: "", image: "", tts: "", stt: "", voice: "" }),
  })
  .superRefine((ai, ctx) => {
    const providers = new Map<string, z.infer<typeof configuredProviderSchema>>();
    for (const [index, provider] of ai.providers.entries()) {
      if (providers.has(provider.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["providers", index, "id"],
          message: `Provider id "${provider.id}" is duplicated`,
        });
      }
      providers.set(provider.id, provider);
    }

    const models = new Map<string, z.infer<typeof configuredModelSchema>>();
    for (const [index, model] of ai.models.entries()) {
      if (!providers.has(model.provider)) {
        ctx.addIssue({
          code: "custom",
          path: ["models", index, "provider"],
          message: `Provider "${model.provider}" is not configured`,
        });
      }
      if (models.has(model.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["models", index, "id"],
          message: `Model id "${model.id}" is duplicated`,
        });
      }
      models.set(model.id, model);
    }

    const expected: Array<[keyof typeof ai.defaults, (typeof MODEL_CAPABILITIES)[number][]]> = [
      ["text", ["text"]],
      ["image", ["image_generation", "image_edit"]],
      ["tts", ["tts"]],
      ["stt", ["stt"]],
    ];
    for (const [key, capabilities] of expected) {
      const id = ai.defaults[key];
      if (!id) continue;
      const model = models.get(id);
      if (!model) {
        ctx.addIssue({
          code: "custom",
          path: ["defaults", key],
          message: `Model "${id}" is not configured`,
        });
      } else if (!model.enabled || !providers.get(model.provider)?.enabled) {
        ctx.addIssue({
          code: "custom",
          path: ["defaults", key],
          message: `Model "${id}" or its provider is disabled`,
        });
      } else if (!capabilities.every((capability) => model.capabilities.includes(capability))) {
        ctx.addIssue({
          code: "custom",
          path: ["defaults", key],
          message: `Model "${id}" does not support ${capabilities.join(" and ")}`,
        });
      }
    }
  });

export const providersConfigSchema = z.object({
  ai: z.preprocess((value) => value ?? {}, aiSectionSchema),
});

export type AiProviderConfig = z.infer<typeof aiSectionSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    ai: AiProviderConfig;
  }
}
