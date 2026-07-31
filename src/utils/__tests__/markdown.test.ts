import { test, expect, describe } from "vitest";
import { cleanMd, unwrapStreamingTextEnvelope, unwrapTextEnvelope } from "../markdown.js";

describe("cleanMd", () => {
  test("keeps rich markdown emphasis", () => {
    expect(cleanMd("hello *world*")).toBe("hello *world*");
  });

  test("keeps underscores", () => {
    expect(cleanMd("_italic_")).toBe("_italic_");
  });

  test("keeps strikethrough", () => {
    expect(cleanMd("~~strikethrough~~")).toBe("~~strikethrough~~");
  });

  test("keeps code spans", () => {
    expect(cleanMd("`code`")).toBe("`code`");
  });

  test("keeps rich blocks", () => {
    const markdown = "# Heading\n\n| A | B |\n|---|---|\n| $x$ | ==marked== |";
    expect(cleanMd(markdown)).toBe(markdown);
  });

  test("unescapes punctuation after backslash", () => {
    expect(cleanMd("hello\\. world")).toBe("hello. world");
    expect(cleanMd("item\\!")).toBe("item!");
  });

  test("leaves plain text untouched", () => {
    expect(cleanMd("just a normal sentence")).toBe("just a normal sentence");
  });

  test("handles empty string", () => {
    expect(cleanMd("")).toBe("");
  });
});

describe("unwrapTextEnvelope", () => {
  test("unwraps an accidental JSON text response", () => {
    expect(unwrapTextEnvelope('{"text":"Hello there"}')).toBe("Hello there");
  });

  test("unwraps a fenced JSON text response", () => {
    expect(unwrapTextEnvelope('```json\n{"text":"Hello there"}\n```')).toBe("Hello there");
  });

  test("preserves other JSON objects", () => {
    const json = '{"text":"Hello","language":"en"}';
    expect(unwrapTextEnvelope(json)).toBe(json);
  });

  test("removes a leaked thought object before the final answer", () => {
    expect(unwrapTextEnvelope('{"thought":"Internal reasoning"} Мяу.')).toBe("Мяу.");
  });

  test("removes leaked thought and tools metadata before the final answer", () => {
    expect(
      unwrapTextEnvelope('{"thought":"Use {care} and \\"warmth\\"","tools":[]}\nБуду осторожна.')
    ).toBe("Буду осторожна.");
  });

  test("preserves JSON requested as the actual response", () => {
    const json = '{"thought":"A visible field","tools":[]}';
    expect(unwrapTextEnvelope(json)).toBe(json);
    expect(unwrapTextEnvelope('{"status":"ok"} Done')).toBe('{"status":"ok"} Done');
  });
});

describe("unwrapStreamingTextEnvelope", () => {
  test("hides partial and complete internal metadata while it is streaming", () => {
    expect(unwrapStreamingTextEnvelope('{"tho')).toBe("");
    expect(unwrapStreamingTextEnvelope('{"thought":"Internal","tools":[]}')).toBe("");
  });

  test("reveals the answer after the internal metadata is complete", () => {
    expect(unwrapStreamingTextEnvelope('{"thought":"Internal","tools":[]}Буду осторожна.')).toBe(
      "Буду осторожна."
    );
  });

  test("preserves ordinary streamed text", () => {
    expect(unwrapStreamingTextEnvelope("A normal answer")).toBe("A normal answer");
  });
});
