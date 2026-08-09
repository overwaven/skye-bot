"use client"

import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@heroicons/react/24/outline"
import { useRef, useState } from "react"
import { toast } from "sonner"

import {
  Chip,
  ContextMenu,
  FadeIn,
  GlassCard,
  IconButton,
  MenuItem,
} from "@/components/panel/primitives"
import { api, type Memory } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"

const ALL_CHATS = "all"

export function MemoryView({
  memories,
  search,
  onSearch,
  onDelete,
  onReload,
}: {
  memories: Memory[]
  search: string
  onSearch: (value: string) => void
  onDelete: (memory: Memory) => void
  onReload: () => void
}) {
  const importRef = useRef<HTMLInputElement>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [itemMenu, setItemMenu] = useState<string | null>(null)
  const [chat, setChat] = useState<string>(ALL_CHATS)

  const chatGroups = Array.from(
    memories.reduce((groups, memory) => {
      const group = groups.get(memory.chatId) ?? {
        id: memory.chatId,
        name: memory.chatName || `Chat ${memory.chatId}`,
        memories: [] as Memory[],
      }
      group.memories.push(memory)
      groups.set(memory.chatId, group)
      return groups
    }, new Map<number, { id: number; name: string; memories: Memory[] }>())
  ).map(([, group]) => group)

  const activeChat = chatGroups.some((group) => String(group.id) === chat)
    ? chat
    : ALL_CHATS

  const filtered = memories.filter((memory) => {
    const matchesChat =
      activeChat === ALL_CHATS || String(memory.chatId) === activeChat
    const matchesSearch = [memory.content, memory.chatName, String(memory.chatId)]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
    return matchesChat && matchesSearch
  })

  const exportAll = async () => {
    try {
      const exported = await api.exportMemories()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], {
          type: "application/json",
        })
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = "skye-memory-export.json"
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success("Memory exported")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        memories?: Array<Record<string, unknown>>
      }
      if (!Array.isArray(parsed.memories))
        throw new Error("This file has no memories")
      const grouped = new Map<number, Array<Record<string, unknown>>>()
      for (const memory of parsed.memories) {
        const chatId = Number(memory.chatId)
        if (!Number.isSafeInteger(chatId)) continue
        grouped.set(chatId, [
          ...(grouped.get(chatId) ?? []),
          {
            content: memory.content,
            category: memory.category,
            expiresAt: memory.expiresAt,
          },
        ])
      }
      for (const [chatId, items] of grouped)
        await api.importMemories(chatId, items)
      toast.success("Memory imported")
      onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <FadeIn className="relative flex items-center gap-2">
        <label className="glass flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[16px] px-3.5 py-3">
          <MagnifyingGlassIcon
            aria-hidden
            className="size-[18px] shrink-0 text-faint"
          />
          <span className="sr-only">Search memories</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search memories"
            className="w-full min-w-0 bg-transparent text-base leading-5 text-ink outline-none placeholder:text-faint sm:text-[15px]"
          />
        </label>
        <IconButton
          label="Memory options"
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          onClick={() => setOverflowOpen((open) => !open)}
          className="rounded-[14px] border border-[color-mix(in_oklab,var(--sky)_30%,transparent)] bg-[color-mix(in_oklab,var(--sky)_16%,transparent)]"
        >
          <EllipsisVerticalIcon aria-hidden className="size-[18px] text-muted" />
        </IconButton>
        <ContextMenu
          open={overflowOpen}
          onClose={() => setOverflowOpen(false)}
          className="top-14 right-0 w-[188px]"
        >
          <MenuItem
            icon={<ArrowUpTrayIcon aria-hidden className="size-4" />}
            onClick={() => {
              setOverflowOpen(false)
              void exportAll()
            }}
          >
            Export
          </MenuItem>
          <MenuItem
            icon={<ArrowDownTrayIcon aria-hidden className="size-4" />}
            onClick={() => {
              setOverflowOpen(false)
              importRef.current?.click()
            }}
          >
            Import
          </MenuItem>
        </ContextMenu>
        <input
          ref={importRef}
          hidden
          type="file"
          accept="application/json"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
            event.target.value = ""
          }}
        />
      </FadeIn>

      {chatGroups.length > 1 && (
        <FadeIn
          delay={0.04}
          className="panel-no-scrollbar -mx-5 flex items-center gap-2 overflow-x-auto px-5"
        >
          <Chip
            active={activeChat === ALL_CHATS}
            onClick={() => setChat(ALL_CHATS)}
          >
            All chats
          </Chip>
          {chatGroups.map((group) => (
            <Chip
              key={group.id}
              active={activeChat === String(group.id)}
              onClick={() => setChat(String(group.id))}
            >
              {group.name}
            </Chip>
          ))}
        </FadeIn>
      )}

      {memories.length === 0 ? (
        <FadeIn delay={0.08}>
          <GlassCard className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-[17px] leading-[22px] font-semibold text-ink">
              A blank page, for now.
            </p>
            <p className="max-w-[17rem] text-[13px] leading-[18px] text-muted">
              Ask Skye to remember something in a chat and it will appear here.
            </p>
          </GlassCard>
        </FadeIn>
      ) : filtered.length === 0 ? (
        <FadeIn delay={0.08}>
          <GlassCard className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-[17px] leading-[22px] font-semibold text-ink">
              No memories match “{search || "this filter"}”.
            </p>
            <button
              type="button"
              onClick={() => {
                onSearch("")
                setChat(ALL_CHATS)
              }}
              className="pressable text-[14px] leading-[18px] font-semibold text-sky-deep outline-none focus-visible:ring-2 focus-visible:ring-sky"
            >
              Clear filters
            </button>
          </GlassCard>
        </FadeIn>
      ) : (
        <FadeIn delay={0.08} className="flex flex-col gap-7 py-2">
          {filtered.map((memory) => {
            const key = `${memory.chatId}-${memory.id}`
            return (
              <div key={key} className="relative flex flex-col gap-1.5">
                <div className="flex w-full items-start gap-1">
                  <p className="min-w-0 flex-1 text-[14px] leading-5 font-medium text-ink">
                    {memory.content}
                  </p>
                  <IconButton
                    label="Memory item options"
                    aria-haspopup="menu"
                    aria-expanded={itemMenu === key}
                    className="-mt-1 size-7 rounded-lg"
                    onClick={() =>
                      setItemMenu((current) => (current === key ? null : key))
                    }
                  >
                    <EllipsisVerticalIcon
                      aria-hidden
                      className="size-3.5 text-faint"
                    />
                  </IconButton>
                </div>
                <p className="text-[12px] leading-4 text-muted">
                  {memory.chatName || `Chat ${memory.chatId}`} ·{" "}
                  {formatRelativeTime(memory.createdAt)}
                </p>
                <ContextMenu
                  open={itemMenu === key}
                  onClose={() => setItemMenu(null)}
                  className="top-7 right-0"
                >
                  <MenuItem
                    tone="danger"
                    icon={<TrashIcon aria-hidden className="size-4" />}
                    onClick={() => {
                      setItemMenu(null)
                      onDelete(memory)
                    }}
                  >
                    Delete
                  </MenuItem>
                </ContextMenu>
              </div>
            )
          })}
        </FadeIn>
      )}
    </>
  )
}
