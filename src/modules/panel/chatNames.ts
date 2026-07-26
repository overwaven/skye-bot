import type { ModuleContext } from "../../core/module.js";

const CHAT_NAME_TTL_MS = 10 * 60 * 1_000;
const chatNameCache = new Map<number, { name: string; expiresAt: number }>();

function displayName(chat: {
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}): string | undefined {
  if (chat.title?.trim()) return chat.title.trim();
  const personalName = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  if (personalName) return personalName;
  if (chat.username?.trim()) return `@${chat.username.trim()}`;
  return undefined;
}

export async function resolveChatNames(
  ctx: ModuleContext,
  chatIds: Array<number | null>
): Promise<Map<number, string>> {
  const ids = [...new Set(chatIds.filter((id): id is number => id != null))];
  const now = Date.now();
  const resolved = new Map<number, string>();
  const missing: number[] = [];

  for (const id of ids) {
    const cached = chatNameCache.get(id);
    if (cached && cached.expiresAt > now) resolved.set(id, cached.name);
    else missing.push(id);
  }

  const bot = ctx.services.has("telegramBot") ? ctx.services.get("telegramBot") : null;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      if (id == null) continue;
      let name = `Chat ${id}`;
      if (bot) {
        try {
          name = displayName(await bot.api.getChat(id)) ?? name;
        } catch {
          // A chat can become unavailable after the original request was recorded.
        }
      }
      chatNameCache.set(id, { name, expiresAt: now + CHAT_NAME_TTL_MS });
      resolved.set(id, name);
    }
  });
  await Promise.all(workers);

  return resolved;
}
