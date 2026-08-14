"use client"

import { PhotoIcon } from "@heroicons/react/24/outline"
import { useEffect, useId, useMemo, useState } from "react"
import { toast } from "sonner"

import { GlassCard, IconWell } from "@/components/panel/primitives"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { api, type AiCatalog } from "@/lib/api"
import { isDemoMode } from "@/lib/demo"
import { haptic } from "@/lib/telegram"

export function AiSettingsSheet({
  open,
  onOpenChange,
  initialCatalog,
  onCatalogChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialCatalog: AiCatalog | null
  onCatalogChange: (catalog: AiCatalog) => void
}) {
  const fieldPrefix = useId()
  const [catalog, setCatalog] = useState<AiCatalog | null>(initialCatalog)
  const [busy, setBusy] = useState(false)

  useEffect(() => setCatalog(initialCatalog), [initialCatalog])

  const defaultModelName = useMemo(
    () =>
      catalog?.models.find((model) => model.id === catalog.defaultImageModelId)
        ?.name ?? "Not configured",
    [catalog]
  )

  const selectChat = async (chatId: number) => {
    if (!catalog || chatId === catalog.chatId) return
    if (isDemoMode()) {
      const next = { ...catalog, chatId, imageModelId: null }
      setCatalog(next)
      onCatalogChange(next)
      haptic.selection()
      return
    }
    setBusy(true)
    try {
      const next = await api.getAiCatalog(chatId)
      setCatalog(next)
      onCatalogChange(next)
      haptic.selection()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const selectImageModel = async (imageModelId: string | null) => {
    if (!catalog) return
    const previous = catalog
    const next = { ...catalog, imageModelId }
    setCatalog(next)
    if (isDemoMode()) {
      onCatalogChange(next)
      haptic.success()
      return
    }
    try {
      const result = await api.updateAiRouting(catalog.chatId, imageModelId)
      const saved = { ...next, imageModelId: result.imageModelId }
      setCatalog(saved)
      onCatalogChange(saved)
      haptic.success()
    } catch (error) {
      setCatalog(previous)
      haptic.error()
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="panel-no-scrollbar mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-[1.75rem] p-0"
      >
        <SheetHeader className="px-5 pt-5 pr-14 pb-3 text-left">
          <SheetTitle>Image model</SheetTitle>
          <SheetDescription>
            Choose one model for creating and editing images.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
          {catalog && catalog.chats.length > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${fieldPrefix}-chat`}>Chat</Label>
              <select
                id={`${fieldPrefix}-chat`}
                value={catalog.chatId}
                disabled={busy}
                onChange={(event) => void selectChat(Number(event.target.value))}
                className="min-h-12 w-full rounded-[14px] border border-[var(--segment-border)] bg-[var(--segment-fill)] px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-50"
              >
                {catalog.chats.map((chat) => (
                  <option key={chat.chatId} value={chat.chatId}>
                    {chat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <GlassCard strong className="flex items-start gap-3 p-4">
            <IconWell className="shrink-0">
              <PhotoIcon aria-hidden className="size-[18px]" />
            </IconWell>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor={`${fieldPrefix}-image-model`}
                className="text-[15px] font-semibold text-ink"
              >
                Generation and editing
              </Label>
              <p className="mt-1 text-[12px] leading-[17px] text-muted">
                Applies to both new images and edits in this chat.
              </p>
              <select
                id={`${fieldPrefix}-image-model`}
                value={catalog?.imageModelId ?? ""}
                disabled={busy || !catalog || catalog.models.length === 0}
                onChange={(event) =>
                  void selectImageModel(event.target.value || null)
                }
                className="mt-3 min-h-12 w-full rounded-[14px] border border-[var(--segment-border)] bg-[var(--segment-fill)] px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-50"
              >
                <option value="">Bot default · {defaultModelName}</option>
                {catalog?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              {catalog && catalog.models.length === 0 && (
                <p className="mt-2 text-[12px] leading-[17px] text-muted">
                  No image model is available. The bot administrator can add one
                  in config.yaml.
                </p>
              )}
            </div>
          </GlassCard>
        </div>
      </SheetContent>
    </Sheet>
  )
}
