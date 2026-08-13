import { InlineKeyboard } from "grammy";
import type { AgentEditField, AgentEditSession } from "./editSessions.js";

export function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Escape text for safe inclusion inside inline `code` spans. */
export function mdCode(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function fence(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2);
  const ticks = "`".repeat(longest + 1);
  return `${ticks}\n${text}\n${ticks}`;
}

export function formatEditEditor(session: AgentEditSession, displayId: string): string {
  const pending =
    session.pendingId && session.pendingId !== session.agentId
      ? ` → ${mdCode(session.pendingId)}`
      : "";
  return [
    `## Editing ${session.name}`,
    "",
    `| | |`,
    `|---|---|`,
    `| **Id** | ${mdCode(displayId)}${pending} |`,
    `| **Name** | ${session.name.replace(/\|/g, "\\|")} |`,
    `| **Description** | ${truncate(session.description, 180).replace(/\|/g, "\\|")} |`,
    "",
    "### Instructions",
    "",
    fence(truncate(session.instructions, 1200)),
    "",
    "_Tap a field to change it, then **Save** or **Cancel**._",
  ].join("\n");
}

export function formatAgentsList(options: {
  activeName: string;
  primaryName?: string;
  lines: string[];
  templateLines: string[];
  privateChat: boolean;
}): string {
  return [
    "## Agents",
    "",
    `| | |`,
    `|---|---|`,
    `| **Active** | ${options.activeName} |`,
    ...(options.privateChat ? [`| **Primary** | ${options.primaryName ?? "Default Skye"} |`] : []),
    "",
    ...(options.lines.length > 0 ? options.lines : ["_No agents in this library yet._"]),
    ...(options.templateLines.length > 0
      ? ["", "### Templates", "", ...options.templateLines]
      : []),
    "",
    options.privateChat
      ? "Switch with `/agent <id>`. Set primary with `/agent primary <id>`. Reset override with `/agent default`."
      : "Admins: switch with `/agent <id>`, or `/agent default` for Default Skye.",
  ].join("\n");
}

export function editFieldKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Name", "agent:edit:field:name")
    .text("Description", "agent:edit:field:description")
    .row()
    .text("Instructions", "agent:edit:field:instructions")
    .text("Change id", "agent:edit:field:id")
    .row()
    .text("Save", "agent:edit:save")
    .text("Cancel", "agent:edit:cancel");
}

export function editPickKeyboard(agents: Array<{ id: string; name: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const agent of agents.slice(0, 20)) {
    keyboard.text(agent.name, `agent:edit:pick:${agent.id}`).row();
  }
  keyboard.text("Cancel", "agent:edit:cancel");
  return keyboard;
}

export function fieldPrompt(field: AgentEditField): { text: string; placeholder: string } {
  switch (field) {
    case "name":
      return {
        text: "Send the new **name** (1–80 characters).",
        placeholder: "Agent name",
      };
    case "description":
      return {
        text: "Send the new short **description** (1–500 characters).",
        placeholder: "Short description",
      };
    case "instructions":
      return {
        text: "Send the full **instructions** (1–16,000 characters).",
        placeholder: "Full instructions",
      };
    case "id":
      return {
        text: "Send a new **id** (lowercase letters, numbers, `_` or `-`), or send `-` to keep the current id.",
        placeholder: "agent_id",
      };
  }
}

export function applyFieldValue(
  session: AgentEditSession,
  field: AgentEditField,
  value: string
): { ok: true; session: Omit<AgentEditSession, "updatedAt"> } | { ok: false; error: string } {
  const text = value.trim();
  if (field === "name") {
    if (!text || text.length > 80) return { ok: false, error: "Name must be **1–80** characters." };
    return { ok: true, session: { ...session, name: text, awaitingField: undefined } };
  }
  if (field === "description") {
    if (!text || text.length > 500) {
      return { ok: false, error: "Description must be **1–500** characters." };
    }
    return { ok: true, session: { ...session, description: text, awaitingField: undefined } };
  }
  if (field === "instructions") {
    if (!text || text.length > 16_000) {
      return { ok: false, error: "Instructions must be **1–16,000** characters." };
    }
    return { ok: true, session: { ...session, instructions: text, awaitingField: undefined } };
  }
  if (text === "-" || text === "") {
    return {
      ok: true,
      session: { ...session, pendingId: undefined, awaitingField: undefined },
    };
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(text) || text.startsWith("my_") || text.startsWith("chat_")) {
    return {
      ok: false,
      error: "Id must be lowercase, start with a letter, and not use the `my_` or `chat_` prefix.",
    };
  }
  return {
    ok: true,
    session: { ...session, pendingId: text, awaitingField: undefined },
  };
}
