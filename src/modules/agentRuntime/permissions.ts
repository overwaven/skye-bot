import type { Api } from "grammy";
import type { AdminService } from "../admin/service.js";

const CACHE_TTL_MS = 2 * 60 * 1000;

type CacheEntry = { allowed: boolean; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function cacheKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export function clearChatAgentPermissionCache(): void {
  cache.clear();
}

/**
 * Bot admins and Telegram group creators/administrators may manage shared chat agents.
 * Private chats do not use this gate (personal agents are owner-scoped).
 */
export async function canManageChatAgents(options: {
  api: Api;
  admin: AdminService;
  chatId: number;
  chatType: string;
  userId?: number;
}): Promise<boolean> {
  const { api, admin, chatId, chatType, userId } = options;
  if (!userId) return false;
  if (admin.isAdmin(userId)) return true;
  if (chatType === "private") return false;

  const key = cacheKey(chatId, userId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.allowed;

  let allowed = false;
  try {
    const member = await api.getChatMember(chatId, userId);
    allowed = member.status === "creator" || member.status === "administrator";
  } catch {
    allowed = false;
  }
  cache.set(key, { allowed, expiresAt: Date.now() + CACHE_TTL_MS });
  return allowed;
}
