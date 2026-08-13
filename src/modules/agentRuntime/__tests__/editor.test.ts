import { describe, expect, it } from "vitest";
import {
  applyFieldValue,
  formatEditEditor,
  formatAgentsList,
  mdCode,
  truncate,
} from "../editor.js";
import type { AgentEditSession } from "../editSessions.js";

const baseSession = (): Omit<AgentEditSession, "updatedAt"> => ({
  scope: "personal",
  agentId: "writer",
  name: "Writer",
  description: "Writes copy",
  instructions: "Be concise.",
});

describe("agent editor helpers", () => {
  it("formats the editor with rich markdown", () => {
    const markdown = formatEditEditor(
      { ...baseSession(), updatedAt: new Date().toISOString() },
      "my_writer"
    );
    expect(markdown).toContain("## Editing Writer");
    expect(markdown).toContain("`my_writer`");
    expect(markdown).toContain("### Instructions");
    expect(markdown).toContain("Be concise.");
  });

  it("applies field updates and validates bounds", () => {
    const session = { ...baseSession(), updatedAt: new Date().toISOString() };
    expect(applyFieldValue(session, "name", "").ok).toBe(false);
    const renamed = applyFieldValue(session, "name", "Editor");
    expect(renamed).toMatchObject({
      ok: true,
      session: expect.objectContaining({ name: "Editor", awaitingField: undefined }),
    });
    const idChange = applyFieldValue(session, "id", "editor");
    expect(idChange).toMatchObject({
      ok: true,
      session: expect.objectContaining({ pendingId: "editor" }),
    });
    expect(applyFieldValue(session, "id", "my_bad").ok).toBe(false);
  });

  it("formats agent lists and truncates long text", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdefghijklmnop", 8)).toBe("abcdefg…");
    expect(mdCode("my_agent")).toBe("`my_agent`");
    expect(
      formatAgentsList({
        activeName: "Writer",
        primaryName: "Writer",
        lines: ["- ● **Writer**"],
        templateLines: ["- ◇ **Muse**"],
        privateChat: true,
      })
    ).toContain("## Agents");
  });
});
