import type { AccessDecision } from "./access.js";

const COMMAND_RE = /^\/(\w+)(?:@(\S+))?/;

export interface ParsedTelegramCommand {
  name: string;
  mention?: string;
  rest: string;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | undefined {
  const match = text.match(COMMAND_RE);
  if (!match) return undefined;
  return {
    name: match[1],
    ...(match[2] ? { mention: match[2] } : {}),
    rest: text.slice(match[0].length).trim(),
  };
}

export function isCommandForBot(
  text: string,
  botUsername?: string,
  ourCommands?: ReadonlySet<string>
): boolean {
  const parsed = parseTelegramCommand(text);
  if (!parsed) return false;
  if (parsed.mention && botUsername && parsed.mention.toLowerCase() !== botUsername.toLowerCase()) {
    return false;
  }
  if (ourCommands && !ourCommands.has(parsed.name)) return false;
  return true;
}

/** Public commands may skip allowlist/subscription, but never a ban. */
export function publicCommandSkipsAccessGate(decision: AccessDecision): boolean {
  return decision.reason !== "banned";
}
