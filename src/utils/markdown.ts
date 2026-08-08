// Telegram rich messages support GitHub-flavored Markdown plus Telegram
// extensions. Keep model formatting intact and only normalize common escaping
// artifacts produced for the older MarkdownV2 path.
export function cleanMd(text: string) {
  return text.replace(/\\([.!(){}[\]])/g, "$1").trim();
}

const INTERNAL_METADATA_KEYS = new Set(["thought", "tools"]);
/** Keys the send_voice tool accepts — models sometimes emit these as plain JSON text. */
const VOICE_TOOL_PAYLOAD_KEYS = new Set(["text", "voice", "style", "scene"]);

export interface VoiceToolPayload {
  text: string;
  voice?: string;
  style?: string;
  scene?: string;
}

function leadingJsonObjectEnd(text: string): number | undefined {
  if (text[0] !== "{") return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i + 1;
  }
  return undefined;
}

function startsWithInternalMetadata(text: string): boolean {
  if (text[0] !== "{") return false;
  const afterBrace = text.slice(1).trimStart();
  if (!afterBrace) return true;
  if (!afterBrace.startsWith('"')) return false;
  const closingQuote = afterBrace.indexOf('"', 1);
  const key = afterBrace.slice(1, closingQuote === -1 ? undefined : closingQuote);
  return closingQuote === -1
    ? [...INTERNAL_METADATA_KEYS].some((candidate) => candidate.startsWith(key))
    : INTERNAL_METADATA_KEYS.has(key);
}

function stripInternalMetadataPrefix(text: string): string {
  const trimmed = text.trimStart();
  const objectEnd = leadingJsonObjectEnd(trimmed);
  if (objectEnd == null) return text;

  let metadata: unknown;
  try {
    metadata = JSON.parse(trimmed.slice(0, objectEnd));
  } catch {
    return text;
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return text;

  const keys = Object.keys(metadata);
  const remainder = trimmed.slice(objectEnd).trimStart();
  if (
    !remainder ||
    typeof (metadata as { thought?: unknown }).thought !== "string" ||
    keys.some((key) => !INTERNAL_METADATA_KEYS.has(key))
  ) {
    return text;
  }
  return remainder;
}

/**
 * Detect a leaked send_voice argument object (plain or fenced JSON).
 * Models sometimes print tool args as the final answer instead of calling the tool.
 */
export function parseVoiceToolPayload(text: string): VoiceToolPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed;
  if (fenced[0] !== "{") return null;

  let value: unknown;
  try {
    value = JSON.parse(fenced);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some((key) => !VOICE_TOOL_PAYLOAD_KEYS.has(key))) return null;
  if (typeof record.text !== "string") return null;

  const transcript = record.text.trim();
  if (!transcript) return null;

  const payload: VoiceToolPayload = { text: transcript };
  for (const key of ["voice", "style", "scene"] as const) {
    const raw = record[key];
    if (typeof raw !== "string") continue;
    const trimmedValue = raw.trim();
    if (trimmedValue) payload[key] = trimmedValue;
  }
  return payload;
}

export function unwrapTextEnvelope(text: string): string {
  const voicePayload = parseVoiceToolPayload(text);
  if (voicePayload) return voicePayload.text;

  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;

  try {
    const value = JSON.parse(fenced) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
  } catch {
    return stripInternalMetadataPrefix(text);
  }

  return stripInternalMetadataPrefix(text);
}

export function unwrapStreamingTextEnvelope(text: string): string {
  const trimmed = text.trimStart();
  if (startsWithInternalMetadata(trimmed) && leadingJsonObjectEnd(trimmed) == null) return "";

  const unwrapped = stripInternalMetadataPrefix(text);
  if (unwrapped !== text) return unwrapped;
  if (
    startsWithInternalMetadata(trimmed) &&
    trimmed.slice(leadingJsonObjectEnd(trimmed)).trim() === ""
  ) {
    return "";
  }
  return text;
}
