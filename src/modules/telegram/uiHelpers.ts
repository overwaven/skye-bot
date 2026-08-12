import { InlineKeyboard, type Context as GrammyContext } from "grammy";
import type { InputChecklist, ReplyParameters } from "grammy/types";

export function uniqByCommand<T extends { command: string }>(v: T, i: number, arr: T[]): boolean {
  return arr.findIndex((x) => x.command === v.command) === i;
}

export function formatToolBlock(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  source?: string
): string {
  const sourceTag = source ? ` \`${source}\`` : "";
  const desc = description || "_No description_";
  const params = JSON.stringify(parameters, null, 2);
  return [`**${name}**${sourceTag}`, "", desc, "", "Parameters:", "```json", params, "```"].join(
    "\n"
  );
}

export function imageControlKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function imageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Variation", "img:var")
    .text("Prompt+", "img:prompt")
    .row()
    .text("Square", "img:square")
    .text("Wide", "img:wide");
}

export function replyParametersFor(ctx: GrammyContext): ReplyParameters | undefined {
  const messageId = ctx.message?.message_id;
  return messageId == null ? undefined : { message_id: messageId };
}

export function shouldPreferChecklist(inputText: string, outputText: string): boolean {
  const wantsChecklist = /(чеклист|список дел|todo|to-do|tasks|checklist|план|шаги|steps)/i.test(
    inputText
  );
  return wantsChecklist && extractChecklist(outputText) != null;
}

export function extractChecklist(text: string): InputChecklist | undefined {
  const lines = text.split("\n").map((line) => line.trim());
  const title =
    lines
      .find((line) => line.startsWith("#"))
      ?.replace(/^#+\s*/, "")
      .slice(0, 255) || "Checklist";

  const tasks = lines
    .map((line) => {
      const match = line.match(/^(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+[.)]\s+)(.+)$/);
      return match?.[1].trim();
    })
    .filter((line): line is string => Boolean(line))
    .filter((line) => line.length >= 3 && line.length <= 100)
    .slice(0, 30)
    .map((line, index) => ({ id: index + 1, text: line }));

  if (tasks.length < 2) return undefined;
  return {
    title,
    tasks,
    others_can_add_tasks: true,
    others_can_mark_tasks_as_done: true,
  };
}
