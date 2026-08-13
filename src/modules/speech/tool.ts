import type { ToolDefinition } from "../../core/module.js";
import { parseVoiceToolPayload } from "../../utils/markdown.js";
import type { SpeechService } from "./service.js";
import type { SpeechSynthesisOptions } from "./types.js";
import { oggOpusDurationSeconds } from "./transcode.js";

export type VoiceToolMode = "text" | "auto" | "always";

export interface PreparedVoiceMessage {
  audio: Buffer;
  transcript: string;
  options: SpeechSynthesisOptions;
  durationSeconds: number;
}

interface VoiceToolOptions {
  speech: SpeechService;
  mode: VoiceToolMode;
  chatId?: number;
  onStart?: () => Promise<void> | void;
  onPrepared: (message: PreparedVoiceMessage) => Promise<void> | void;
}

export const MAX_VOICE_TRANSCRIPT_CHARS = 5_000;
const MAX_DIRECTION_CHARS = 1_000;

export function createSendVoiceTool(options: VoiceToolOptions): ToolDefinition {
  const capabilities = options.speech.getTtsCapabilities(options.chatId);
  const voices = capabilities.voices ? [...capabilities.voices] : undefined;
  let prepared = false;

  const policy =
    options.mode === "text"
      ? "Use this only when the user explicitly asks for an audio or spoken response."
      : options.mode === "auto"
        ? "Use this when the user asks for audio, or when vocal delivery materially improves the response, such as pronunciation, emotional expression, a joke, a character performance, or a short message in another language. Do not use it for ordinary factual replies where text is clearer."
        : "The chat prefers voice replies. Use this tool when a specific voice or expressive performance would improve the response; otherwise the normal final response will be spoken with the default voice.";

  const properties: Record<string, unknown> = {
    text: {
      type: "string",
      description: `The exact transcript to speak, up to ${MAX_VOICE_TRANSCRIPT_CHARS} characters. You may place English inline audio tags such as [whispers], [laughs], [excited], [serious], [very slow], or [shouting] inside the transcript when supported.`,
    },
    voice: {
      type: "string",
      ...(voices ? { enum: voices } : {}),
      description: voices
        ? `Optional voice. Available voices: ${voices.join(", ")}. Defaults to ${capabilities.defaultVoice}.`
        : `Optional provider-specific voice name. Defaults to ${capabilities.defaultVoice}.`,
    },
  };

  if (capabilities.expressive) {
    properties.style = {
      type: "string",
      description:
        "Optional concise director's notes in English describing tone, emotion, pacing, breathing, articulation, or accent. Do not put spoken words here.",
    };
    properties.scene = {
      type: "string",
      description:
        "Optional concise scene and atmosphere in English that helps establish the performance. Do not put spoken words here.",
    };
  }

  return {
    name: "send_voice",
    timeoutMs: 60_000,
    terminal: true,
    description: `${policy} The audio is delivered as a Telegram voice note. Speak only content that belongs in the conversation. Do not repeat the transcript in the final text; after a successful call, return no text unless separate written context is genuinely useful. At most one voice note can be prepared per response.`,
    parameters: {
      type: "object",
      properties,
      required: ["text"],
      additionalProperties: false,
    },
    execute: async (args, _tenant, signal) => {
      if (prepared) return "A voice note is already prepared for this response.";

      // Models sometimes nest the whole tool payload inside `text` as JSON.
      const nested = parseVoiceToolPayload(String(args.text ?? ""));
      const transcript = (nested?.text ?? String(args.text ?? "")).trim();
      if (!transcript) return "Error: text is required.";
      if (transcript.length > MAX_VOICE_TRANSCRIPT_CHARS) {
        return `Error: the voice transcript must be at most ${MAX_VOICE_TRANSCRIPT_CHARS} characters. Shorten it and try again.`;
      }

      const voiceInput = String(args.voice ?? nested?.voice ?? "").trim();
      let voice: string | undefined;
      if (voiceInput) {
        if (voices) {
          voice = voices.find((candidate) => candidate.toLowerCase() === voiceInput.toLowerCase());
          if (!voice)
            return `Error: unsupported voice "${voiceInput}". Choose one from the tool schema.`;
        } else {
          voice = voiceInput;
        }
      }

      const style = limitedOptionalString(args.style ?? nested?.style);
      const scene = limitedOptionalString(args.scene ?? nested?.scene);
      const synthesisOptions = { voice, style, scene };

      await options.onStart?.();
      const audio = await options.speech.synthesize(
        transcript,
        synthesisOptions,
        signal,
        options.chatId ?? _tenant.chatId
      );
      if (!audio) return "Voice synthesis failed. Continue with a text response instead.";
      const durationSeconds = oggOpusDurationSeconds(audio);
      if (durationSeconds < 0.1) {
        return "Voice synthesis returned empty audio. Continue with a text response instead.";
      }

      prepared = true;
      await options.onPrepared({ audio, transcript, options: synthesisOptions, durationSeconds });
      return "Voice note prepared successfully. Do not repeat its transcript in text.";
    },
  };
}

function limitedOptionalString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.slice(0, MAX_DIRECTION_CHARS);
}
