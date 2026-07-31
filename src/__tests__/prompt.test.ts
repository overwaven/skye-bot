import { test, expect, describe } from "vitest";
import { buildSystemPrompt, SYSTEM_PROMPT } from "../modules/llm/prompt.js";
import type { MemoryEntry } from "../modules/memory/service.js";

const makeMemory = (id: string, content: string): MemoryEntry => ({
  id,
  content,
  createdAt: new Date().toISOString(),
});

describe("buildSystemPrompt", () => {
  test("returns a string", () => {
    const prompt = buildSystemPrompt([]);
    expect(typeof prompt).toBe("string");
  });

  test("includes the base system prompt", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain(SYSTEM_PROMPT.trim().slice(0, 30));
  });

  test("includes memory entries when present", () => {
    const prompt = buildSystemPrompt([makeMemory("mem_abc", "user likes cats")]);
    expect(prompt).toContain("[mem_abc] user likes cats");
  });

  test("does not include memory section header when no memories", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("Saved memories for this chat");
  });

  test("includes chat context when provided", () => {
    const prompt = buildSystemPrompt([], {
      chatTitle: "Dev Team",
      recentLog: "Alice: ready to ship",
    });
    expect(prompt).toContain('"Dev Team"');
    expect(prompt).toContain("Alice: ready to ship");
  });

  test("omits older summary section when no summary field exists", () => {
    const prompt = buildSystemPrompt([], {
      chatTitle: "Dev Team",
      recentLog: "Alice: hi",
    });
    expect(prompt).not.toContain("Older conversation summary");
  });

  test("includes multiple memories in order", () => {
    const mems = [makeMemory("mem_1", "fact one"), makeMemory("mem_2", "fact two")];
    const content = buildSystemPrompt(mems);
    const pos1 = content.indexOf("[mem_1]");
    const pos2 = content.indexOf("[mem_2]");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos1);
  });

  test("includes sandbox section when enabled", () => {
    const prompt = buildSystemPrompt([], undefined, undefined, undefined, true);
    expect(prompt).toContain("Daytona Sandbox");
    expect(prompt).toContain("sandbox_run_command");
  });

  test("omits sandbox section when disabled", () => {
    const prompt = buildSystemPrompt([], undefined, undefined, undefined, false);
    expect(prompt).not.toContain("Daytona Sandbox");
  });

  test("includes reminders section when enabled", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(prompt).toContain("## Reminders");
    expect(prompt).toContain("set_reminder");
  });

  test("omits reminders section when not enabled", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("## Reminders");
  });

  test("includes current ISO datetime in chat context", () => {
    const prompt = buildSystemPrompt([], {
      chatTitle: "Test",
      recentLog: "hi",
    });
    expect(prompt).toContain("Current ISO datetime");
  });

  test("includes owner section when owner is provided", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { name: "Melissa", tag: "miss_sterling" }
    );
    expect(prompt).toContain("Melissa");
    expect(prompt).toContain("@miss_sterling");
    expect(prompt).toContain("Bot Owner");
  });

  test("includes channel section when enabled", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(prompt).toContain("## Channel Management");
    expect(prompt).toContain("post_to_channel");
  });

  test("omits channel section when not enabled", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("## Channel Management");
  });

  test("omits owner section when owner is absent", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("Bot Owner");
  });

  test("uses feminine identity", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("Female");
    expect(prompt).toContain("feminine");
  });

  test("non-default personalities replace Skye's character", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "operator"
    );
    expect(prompt).toContain("You are **Operator**");
    expect(prompt).not.toContain("You are **Skye**, a calm");
    expect(prompt).not.toContain("You are always Skye");
  });

  test("a chat prompt completely replaces the panel personality", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      "These panel instructions must also be disabled.",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "operator",
      "You are a patient Socratic tutor."
    );

    expect(prompt).toContain("You are a patient Socratic tutor.");
    expect(prompt).toContain("replaces every built-in personality");
    expect(prompt).not.toContain("You are **Operator**");
    expect(prompt).not.toContain("You are **Skye**, a calm");
    expect(prompt).not.toContain("These panel instructions must also be disabled.");
  });

  test("places current behavior and custom instructions after chat history", () => {
    const prompt = buildSystemPrompt(
      [],
      { chatTitle: "Test", recentLog: "Skye: old behavior" },
      undefined,
      "Answer in clipped sentences.",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "operator"
    );
    expect(prompt.indexOf("Current Behavior — Highest Priority")).toBeGreaterThan(
      prompt.indexOf("Recent messages:")
    );
    expect(prompt.indexOf("Answer in clipped sentences.")).toBeGreaterThan(
      prompt.indexOf("Recent messages:")
    );
  });

  test("includes self-awareness about subscription and reactions", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("Skye Plus");
    expect(prompt).toContain("reaction");
  });

  test("includes sticker catalog when provided", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [{ id: "497d3308-6072-4aaf-8900-1776f7de987f", description: "ебейший ухмыляющийся хомяк" }]
    );
    expect(prompt).toContain("## Stickers");
    expect(prompt).toContain("send_sticker");
    expect(prompt).toContain("ебейший ухмыляющийся хомяк");
  });

  test("requires tool work to finish before returning the final answer", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("## Task Completion");
    expect(prompt).toContain("perform that work instead of merely saying that it is needed");
  });
});
