import { describe, expect, it } from "vitest";
import { agentRuntimeConfigSchema } from "../config.js";

describe("agent runtime config", () => {
  it("enables the Agents SDK with a bounded 21-turn loop by default", () => {
    const config = agentRuntimeConfigSchema.parse({}).agent_runtime;
    expect(config.engine).toBe("openai_agents");
    expect(config.max_turns).toBe(21);
    expect(config.subagent_max_turns).toBe(8);
    expect(config.tracing).toBe(false);
    expect(config.trace_include_sensitive_data).toBe(false);
    expect(config.max_user_agents).toBe(10);
    expect(config.max_chat_agents).toBe(10);
  });

  it("accepts configurable specialist profiles", () => {
    const config = agentRuntimeConfigSchema.parse({
      agent_runtime: {
        agents: [
          {
            id: "deep_research",
            name: "Deep Research",
            description: "Research difficult questions",
            instructions: "Verify claims with tools.",
            model_id: "berlin",
          },
        ],
      },
    }).agent_runtime;

    expect(config.agents[0]).toMatchObject({
      id: "deep_research",
      model_id: "berlin",
      enabled: true,
    });
  });

  it("rejects duplicate profile ids", () => {
    expect(() =>
      agentRuntimeConfigSchema.parse({
        agent_runtime: {
          agents: [
            { id: "same", name: "One", description: "One", instructions: "One" },
            { id: "same", name: "Two", description: "Two", instructions: "Two" },
          ],
        },
      })
    ).toThrow(/Duplicate agent id/);
  });

  it("reserves my_ and chat_ ids for private and shared agents", () => {
    expect(() =>
      agentRuntimeConfigSchema.parse({
        agent_runtime: {
          agents: [
            {
              id: "my_writer",
              name: "Writer",
              description: "Writes",
              instructions: "Write well.",
            },
          ],
        },
      })
    ).toThrow(/reserved/);
    expect(() =>
      agentRuntimeConfigSchema.parse({
        agent_runtime: {
          agents: [
            {
              id: "chat_helper",
              name: "Helper",
              description: "Helps",
              instructions: "Help well.",
            },
          ],
        },
      })
    ).toThrow(/reserved/);
  });
});
