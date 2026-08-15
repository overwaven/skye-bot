import { describe, expect, test } from "vitest";
import {
  isCommandForBot,
  parseTelegramCommand,
  publicCommandSkipsAccessGate,
} from "../commandMessage.js";

describe("parseTelegramCommand", () => {
  test("parses a command with payload and optional mention", () => {
    expect(parseTelegramCommand("/help скай добавь открытый купальник")).toEqual({
      name: "help",
      rest: "скай добавь открытый купальник",
    });
    expect(parseTelegramCommand("/help@SkyeBot draw a cat")).toEqual({
      name: "help",
      mention: "SkyeBot",
      rest: "draw a cat",
    });
    expect(parseTelegramCommand("hello /help")).toBeUndefined();
  });
});

describe("isCommandForBot", () => {
  test("ignores commands addressed to another bot", () => {
    expect(isCommandForBot("/help@other_bot payload", "skye_bot")).toBe(false);
    expect(isCommandForBot("/help@skye_bot payload", "skye_bot")).toBe(true);
  });

  test("can restrict to known command names", () => {
    expect(isCommandForBot("/help extra", "skye_bot", new Set(["start"]))).toBe(false);
    expect(isCommandForBot("/help extra", "skye_bot", new Set(["help"]))).toBe(true);
  });
});

describe("publicCommandSkipsAccessGate", () => {
  test("does not skip the gate for banned users", () => {
    expect(
      publicCommandSkipsAccessGate({
        ok: false,
        reason: "banned",
        message: "banned",
      })
    ).toBe(false);
  });

  test("still lets public commands through without a subscription", () => {
    expect(
      publicCommandSkipsAccessGate({
        ok: false,
        reason: "no_subscription",
        message: "subscribe",
      })
    ).toBe(true);
    expect(publicCommandSkipsAccessGate({ ok: true, reason: "open" })).toBe(true);
  });
});
