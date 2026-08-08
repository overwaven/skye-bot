import { z } from "zod";
import { section } from "../../core/config.js";

export const agentProfileSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z][a-z0-9_-]*$/)
    .refine((id) => !id.startsWith("my_"), 'Agent ids beginning with "my_" are reserved')
    .refine((id) => !id.startsWith("chat_"), 'Agent ids beginning with "chat_" are reserved'),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  instructions: z.string().min(1).max(16_000),
  model_id: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
});

const agentProfilesSchema = z.array(agentProfileSchema).superRefine((profiles, ctx) => {
  const seen = new Set<string>();
  profiles.forEach((profile, index) => {
    if (seen.has(profile.id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate agent id: ${profile.id}`,
      });
    }
    seen.add(profile.id);
  });
});

export const agentRuntimeConfigSchema = z.object({
  agent_runtime: section({
    engine: z.enum(["legacy", "openai_agents"]).default("openai_agents"),
    max_turns: z.number().int().min(2).max(100).default(21),
    subagent_max_turns: z.number().int().min(1).max(50).default(8),
    tracing: z.boolean().default(false),
    trace_include_sensitive_data: z.boolean().default(false),
    max_user_agents: z.number().int().min(1).max(50).default(10),
    max_chat_agents: z.number().int().min(1).max(50).default(10),
    agents: agentProfilesSchema.default([]),
  }),
});

export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>["agent_runtime"];

declare module "../../core/config.js" {
  interface SkyeConfig {
    agent_runtime: AgentRuntimeConfig;
  }
}
