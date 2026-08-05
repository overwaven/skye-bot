/**
 * One-shot smoke test against the configured OpenAI-compatible endpoint
 * (LM Studio in this experiment). Does not start Telegram.
 *
 *   pnpm exec tsx scripts/smoke-lmstudio.ts
 */
import { Agent, OpenAIProvider, Runner, setTracingDisabled } from "@openai/agents";
import { modules } from "../src/modules.js";
import { loadConfig } from "../src/core/config.js";
import { LlmClient } from "../src/modules/llm/client.js";
import type { ModelEntry } from "../src/modules/llm/config.js";

async function main() {
  const c = loadConfig(modules);
  const client = new LlmClient({
    apiKey: c.openai_key,
    baseUrl: c.base_url,
    models: c.models as readonly ModelEntry[],
    defaultModelId: c.default_model_id,
    maxCompletionTokens: Math.min(c.max_completion_tokens, 256),
    useChatCompletions: c.use_chat_completions,
    imageApiKey: c.image.api_key,
    imageBaseUrl: c.image.base_url,
    imageModel: c.image.model,
    pdfEngine: c.pdf_engine,
    pdfMaxBytes: c.pdf_max_bytes,
    perplexityApiKey: c.perplexity_api_key,
    perplexityBaseUrl: c.perplexity_base_url,
    xaiApiKey: c.xai_api_key,
    xaiBaseUrl: c.xai_base_url,
  });

  const entry = client.resolveModel();
  console.log(
    JSON.stringify(
      {
        baseUrl: c.base_url,
        useChatCompletions: c.use_chat_completions,
        modelId: entry.id,
        model: entry.model,
        provider: entry.provider ?? "(default / base_url)",
      },
      null,
      2
    )
  );

  await client.checkCapabilities();
  console.log("supportsImages:", client.supportsImages());

  for (const modelEntry of client.models) {
    console.log(
      `\n=== model ${modelEntry.id} (${modelEntry.model}, chat=${client.usesChatCompletions(modelEntry)}) ===`
    );
    const ask = await client.ask(
      "You are a concise test assistant. Reply in one short sentence.",
      `Say hello and name yourself as catalog id "${modelEntry.id}".`,
      modelEntry.id
    );
    console.log("ask:", ask.output_text?.slice(0, 200));
    console.log("usage:", ask.usage);
    if (!ask.output_text?.trim()) {
      throw new Error(`ask() empty for model ${modelEntry.id}`);
    }
  }

  // Agents SDK path for the default (LM Studio) catalog entry.
  setTracingDisabled(true);
  const provider = new OpenAIProvider({
    apiKey: c.openai_key,
    baseURL: c.base_url,
    useResponses: !c.use_chat_completions,
    strictFeatureValidation: false,
  });
  const runner = new Runner({
    modelProvider: provider,
    modelSettings: { maxTokens: 256 },
    tracingDisabled: true,
  });
  const agent = new Agent({
    name: "smoke",
    instructions: "Reply with exactly one word: pong. No tools.",
    model: entry.model,
    tools: [],
  });
  const agentResult = await runner.run(agent, "ping", { maxTurns: 2 });
  console.log("\n--- Agents SDK (default model) ---");
  console.log("finalOutput:", agentResult.finalOutput);
  await provider.close();

  // Tiny local models may spend the budget on reasoning; ask() coverage above
  // is the hard requirement. Agents SDK is best-effort.
  if (!String(agentResult.finalOutput ?? "").trim()) {
    console.warn("Agents SDK returned empty finalOutput (non-fatal for tiny models)");
  }

  console.log("\nSMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
