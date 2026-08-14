"use client"

import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  MicrophoneIcon,
  PhotoIcon,
  PlusIcon,
  SpeakerWaveIcon,
  TrashIcon,
} from "@heroicons/react/24/outline"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  GlassButton,
  GlassCard,
  IconButton,
  IconWell,
} from "@/components/panel/primitives"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  api,
  type AiCatalog,
  type AiModelInput,
  type AiModelRecord,
  type AiProviderRecord,
  type AiRouting,
  type ChatConfig,
  type DiscoveredAiModel,
  type ModelCapability,
  type ProviderAdminResponse,
  type ProviderInput,
  type ProviderKind,
} from "@/lib/api"
import { confirmTelegram, haptic } from "@/lib/telegram"
import { cn } from "@/lib/utils"
import { DEMO_PROVIDERS, isDemoMode } from "@/lib/demo"

const PROVIDER_PRESETS: Array<{
  kind: ProviderKind
  name: string
  description: string
  baseUrl: string
}> = [
  {
    kind: "openrouter",
    name: "OpenRouter",
    description: "Text, image, and audio models from multiple vendors.",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    kind: "openai",
    name: "OpenAI",
    description: "OpenAI text, image, speech, and transcription models.",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    kind: "xai",
    name: "xAI",
    description: "Grok chat, Imagine, speech, and transcription.",
    baseUrl: "https://api.x.ai/v1",
  },
  {
    kind: "perplexity",
    name: "Perplexity",
    description: "Search-grounded text models and agent responses.",
    baseUrl: "https://api.perplexity.ai/v1",
  },
  {
    kind: "openai-compatible",
    name: "Compatible API",
    description: "A custom server that implements OpenAI-compatible endpoints.",
    baseUrl: "",
  },
]

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text: "Text",
  vision: "Vision",
  image_generation: "Image generation",
  image_edit: "Image editing",
  tts: "Text to speech",
  stt: "Speech to text",
}

const ROUTES: Array<{
  key: keyof Pick<
    AiRouting,
    | "imageGenerationModelId"
    | "imageEditModelId"
    | "ttsModelId"
    | "sttModelId"
  >
  capability: ModelCapability
  label: string
  description: string
  icon: typeof PhotoIcon
}> = [
  {
    key: "imageGenerationModelId",
    capability: "image_generation",
    label: "Image generator",
    description: "Creates new images in this chat.",
    icon: PhotoIcon,
  },
  {
    key: "imageEditModelId",
    capability: "image_edit",
    label: "Image editor",
    description: "Edits images shared in this chat.",
    icon: PhotoIcon,
  },
  {
    key: "ttsModelId",
    capability: "tts",
    label: "Voice model",
    description: "Turns Skye's replies into voice notes.",
    icon: SpeakerWaveIcon,
  },
  {
    key: "sttModelId",
    capability: "stt",
    label: "Transcription model",
    description: "Understands voice notes and audio files.",
    icon: MicrophoneIcon,
  },
]

const DEFAULT_ROUTES: Array<{
  key: keyof Pick<AiRouting, "textModelId" | "imageGenerationModelId" | "imageEditModelId" | "ttsModelId" | "sttModelId">
  capability: ModelCapability
  label: string
}> = [
  { key: "textModelId", capability: "text", label: "Default text model" },
  { key: "imageGenerationModelId", capability: "image_generation", label: "Default image generator" },
  { key: "imageEditModelId", capability: "image_edit", label: "Default image editor" },
  { key: "ttsModelId", capability: "tts", label: "Default voice model" },
  { key: "sttModelId", capability: "stt", label: "Default transcription model" },
]

function SelectField({
  id,
  label,
  description,
  value,
  models,
  defaultModelId,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string | null
  models: AiModelRecord[]
  defaultModelId: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label htmlFor={id} className="text-[14px] font-semibold text-ink">
          {label}
        </Label>
        <p className="mt-0.5 text-[12px] leading-4 text-muted">{description}</p>
      </div>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-h-11 w-full rounded-[14px] border border-[var(--segment-border)] bg-[var(--segment-fill)] px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky"
      >
        <option value="">
          Use bot default
          {defaultModelId
            ? ` · ${models.find((model) => model.id === defaultModelId)?.name ?? "model"}`
            : ""}
        </option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name} · {model.providerName}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AiSettingsSheet({
  open,
  onOpenChange,
  initialCatalog,
  initialChatConfig,
  onCatalogChange,
  onManageProviders,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialCatalog: AiCatalog | null
  initialChatConfig: ChatConfig
  onCatalogChange: (catalog: AiCatalog) => void
  onManageProviders: () => void
}) {
  const fieldPrefix = useId()
  const [catalog, setCatalog] = useState<AiCatalog | null>(initialCatalog)
  const [chatConfig, setChatConfig] = useState(initialChatConfig)
  const [busy, setBusy] = useState(false)

  useEffect(() => setCatalog(initialCatalog), [initialCatalog])
  useEffect(() => setChatConfig(initialChatConfig), [initialChatConfig])

  const selectChat = async (chatId: number) => {
    setBusy(true)
    try {
      const [nextCatalog, nextChatConfig] = await Promise.all([
        api.getAiCatalog(chatId),
        api.getChatConfig(chatId),
      ])
      setCatalog(nextCatalog)
      setChatConfig(nextChatConfig)
      onCatalogChange(nextCatalog)
      haptic.selection()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const updateRoute = async (key: keyof AiRouting, value: string | null) => {
    if (!catalog) return
    const previous = catalog
    setCatalog({
      ...catalog,
      overrides: { ...catalog.overrides, [key]: value },
      routing: {
        ...catalog.routing,
        [key]: value ?? catalog.defaults[key],
      },
    })
    try {
      const result = await api.updateAiRouting(catalog.chatId, { [key]: value })
      const next = { ...catalog, routing: result.routing, overrides: result.overrides }
      setCatalog(next)
      onCatalogChange(next)
      haptic.success()
    } catch (error) {
      setCatalog(previous)
      haptic.error()
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const updateVoiceMode = async (voiceReplyMode: ChatConfig["voiceReplyMode"]) => {
    if (!catalog) return
    const previous = chatConfig
    setChatConfig({ voiceReplyMode })
    try {
      setChatConfig(
        await api.updateChatConfig({ voiceReplyMode, chatId: catalog.chatId })
      )
      haptic.selection()
    } catch (error) {
      setChatConfig(previous)
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto h-[min(94dvh,50rem)] max-h-[94dvh] max-w-md overflow-y-auto rounded-t-[1.75rem] p-0"
      >
        <SheetHeader className="px-5 pt-5 pr-14 pb-4 text-left">
          <SheetTitle>AI for this chat</SheetTitle>
          <SheetDescription>
            Choose from models enabled by the bot administrators.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
          {catalog && catalog.chats.length > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${fieldPrefix}-chat`}>Chat</Label>
              <select
                id={`${fieldPrefix}-chat`}
                value={catalog.chatId}
                disabled={busy}
                onChange={(event) => void selectChat(Number(event.target.value))}
                className="min-h-11 rounded-[14px] border border-[var(--segment-border)] bg-[var(--segment-fill)] px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-50"
              >
                {catalog.chats.map((chat) => (
                  <option key={chat.chatId} value={chat.chatId}>
                    {chat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!catalog?.configured ? (
            <GlassCard className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <IconWell tone="warning">
                <ExclamationTriangleIcon aria-hidden className="size-[18px]" />
              </IconWell>
              <div>
                <p className="text-[15px] font-semibold text-ink">AI is not set up</p>
                <p className="mt-1 text-[13px] leading-[18px] text-muted">
                  An administrator needs to connect a provider and add a text model.
                </p>
              </div>
              {catalog?.canManageProviders && (
                <GlassButton onClick={onManageProviders}>Set up AI</GlassButton>
              )}
            </GlassCard>
          ) : (
            <>
              <section className="flex flex-col gap-4" aria-labelledby={`${fieldPrefix}-voice-heading`}>
                <h3 id={`${fieldPrefix}-voice-heading`} className="text-[15px] font-semibold text-ink">
                  Voice replies
                </h3>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Voice reply mode">
                  {(["text", "auto", "always"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={chatConfig.voiceReplyMode === mode}
                      onClick={() => void updateVoiceMode(mode)}
                      className={cn(
                        "pressable min-h-11 rounded-[14px] px-2 text-[12px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sky",
                        chatConfig.voiceReplyMode === mode
                          ? "bg-sky text-white"
                          : "glass text-muted"
                      )}
                    >
                      {mode === "text" ? "Text only" : mode === "auto" ? "When useful" : "Always voice"}
                    </button>
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-5" aria-labelledby={`${fieldPrefix}-models-heading`}>
                <h3 id={`${fieldPrefix}-models-heading`} className="text-[15px] font-semibold text-ink">
                  Media and voice models
                </h3>
                {ROUTES.map((route) => (
                  <SelectField
                    key={route.key}
                    id={`${fieldPrefix}-${route.key}`}
                    label={route.label}
                    description={route.description}
                    value={catalog.overrides[route.key]}
                    defaultModelId={catalog.defaults[route.key]}
                    models={catalog.models.filter((model) =>
                      model.capabilities.includes(route.capability)
                    )}
                    onChange={(value) => void updateRoute(route.key, value)}
                  />
                ))}

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${fieldPrefix}-voice`}>Default voice</Label>
                  <Input
                    id={`${fieldPrefix}-voice`}
                    value={catalog.overrides.ttsVoice ?? ""}
                    placeholder={catalog.defaults.ttsVoice || "Provider default"}
                    onChange={(event) =>
                      setCatalog({
                        ...catalog,
                        overrides: { ...catalog.overrides, ttsVoice: event.target.value },
                      })
                    }
                    onBlur={(event) =>
                      void updateRoute("ttsVoice", event.target.value.trim() || null)
                    }
                  />
                  <p className="text-[12px] leading-4 text-muted">
                    Enter a voice supported by the selected voice model.
                  </p>
                </div>
              </section>

              {catalog.canManageProviders && (
                <GlassButton variant="secondary" onClick={onManageProviders}>
                  <CpuChipIcon aria-hidden className="size-[18px]" />
                  Manage AI providers
                </GlassButton>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

type ProviderDraft = ProviderInput & { apiKey: string }

function ProviderChoice({
  preset,
  onSelect,
}: {
  preset: (typeof PROVIDER_PRESETS)[number]
  onSelect: () => void
}) {
  return (
    <GlassCard
      as="button"
      onClick={onSelect}
      className="pressable flex min-h-[92px] items-center gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-sky"
    >
      <IconWell>
        <CpuChipIcon aria-hidden className="size-[18px]" />
      </IconWell>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold text-ink">{preset.name}</span>
        <span className="mt-1 block text-[12px] leading-4 text-muted">{preset.description}</span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-faint" />
    </GlassCard>
  )
}

function CapabilityPicker({
  value,
  onChange,
}: {
  value: ModelCapability[]
  onChange: (value: ModelCapability[]) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-semibold text-ink">Capabilities</legend>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(CAPABILITY_LABELS) as ModelCapability[]).map((capability) => (
          <label
            key={capability}
            className="flex min-h-11 items-center gap-2 rounded-[12px] bg-[color-mix(in_oklab,var(--muted)_7%,transparent)] px-3 text-[12px] text-ink"
          >
            <input
              type="checkbox"
              checked={value.includes(capability)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, capability]
                    : value.filter((item) => item !== capability)
                )
              }
              className="size-4 accent-[var(--sky)]"
            />
            {CAPABILITY_LABELS[capability]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ModelForm({
  providerId,
  model,
  onSaved,
  onCancel,
}: {
  providerId: string
  model?: AiModelRecord | DiscoveredAiModel
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(model?.name ?? "")
  const [upstreamId, setUpstreamId] = useState(model?.upstreamId ?? "")
  const [capabilities, setCapabilities] = useState<ModelCapability[]>(model?.capabilities ?? ["text"])
  const [contextWindow, setContextWindow] = useState(
    String(model?.contextWindow ?? 128_000)
  )
  const [multiplier, setMultiplier] = useState(
    String("multiplier" in (model ?? {}) ? (model as AiModelRecord).multiplier : 1)
  )
  const [voice, setVoice] = useState(
    "config" in (model ?? {}) ? (model as AiModelRecord).config.voice ?? "" : ""
  )
  const [enabled, setEnabled] = useState(
    model && "enabled" in model ? (model as AiModelRecord).enabled : true
  )
  const [apiMode, setApiMode] = useState<"responses" | "chat-completions">(
    "config" in (model ?? {})
      ? (model as AiModelRecord).config.apiMode ?? "responses"
      : "responses"
  )
  const [busy, setBusy] = useState(false)
  const record = model && "id" in model ? (model as AiModelRecord) : null

  const save = async () => {
    if (!name.trim() || !upstreamId.trim() || capabilities.length === 0) {
      toast.error("Enter a name, model ID, and at least one capability.")
      return
    }
    setBusy(true)
    const input: AiModelInput = {
      name: name.trim(),
      upstreamId: upstreamId.trim(),
      capabilities,
      contextWindow: Number(contextWindow),
      multiplier: Number(multiplier),
      enabled,
      config: {
        ...(record?.config ?? {}),
        apiMode,
        ...(voice.trim() ? { voice: voice.trim() } : {}),
      },
    }
    try {
      if (record) await api.updateProviderModel(record.id, input)
      else await api.createProviderModel(providerId, input)
      haptic.success()
      onSaved()
    } catch (error) {
      haptic.error()
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassCard strong className="flex flex-col gap-4 p-4">
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ai-model-name">Display name</Label>
          <Input id="ai-model-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Grok Imagine" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ai-model-id">Provider model ID</Label>
          <Input id="ai-model-id" value={upstreamId} onChange={(event) => setUpstreamId(event.target.value)} placeholder="grok-imagine-image" autoCapitalize="off" autoCorrect="off" />
        </div>
        <CapabilityPicker value={capabilities} onChange={setCapabilities} />
        {capabilities.includes("text") && (
          <div className="grid gap-1.5">
            <Label htmlFor="ai-api-mode">Text API</Label>
            <select
              id="ai-api-mode"
              value={apiMode}
              onChange={(event) => setApiMode(event.target.value as "responses" | "chat-completions")}
              className="min-h-11 rounded-[12px] border border-[var(--segment-border)] bg-[var(--segment-fill)] px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky"
            >
              <option value="responses">Responses API</option>
              <option value="chat-completions">Chat Completions API</option>
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ai-context">Context window</Label>
            <Input id="ai-context" type="number" inputMode="numeric" min="1" value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-multiplier">Token cost</Label>
            <Input id="ai-multiplier" type="number" inputMode="decimal" min="0.01" step="0.1" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} />
          </div>
        </div>
        {capabilities.includes("tts") && (
          <div className="grid gap-1.5">
            <Label htmlFor="ai-default-voice">Default voice</Label>
            <Input id="ai-default-voice" value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="alloy" />
          </div>
        )}
        <label className="flex min-h-11 items-center gap-3 rounded-[12px] bg-[color-mix(in_oklab,var(--muted)_7%,transparent)] px-3 text-[13px] text-ink">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4 accent-[var(--sky)]" />
          Make this model available to users
        </label>
      </div>
      <div className="flex gap-2">
        <GlassButton variant="ghost" className="flex-1" onClick={onCancel}>Cancel</GlassButton>
        <GlassButton className="flex-1" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : record ? "Save model" : "Add model"}
        </GlassButton>
      </div>
    </GlassCard>
  )
}

export function ProviderManagerSheet({
  open,
  onOpenChange,
  onboarding = false,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onboarding?: boolean
  onChanged: () => Promise<void> | void
}) {
  const [data, setData] = useState<ProviderAdminResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<"list" | "choose" | "credentials" | "models">("list")
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [createdProvider, setCreatedProvider] = useState<AiProviderRecord | null>(null)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState<DiscoveredAiModel[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingModel, setEditingModel] = useState<{ providerId: string; model?: AiModelRecord } | null>(null)
  const adminModels = useMemo(() => {
    const names = new Map(data?.providers.map((provider) => [provider.id, provider.name]) ?? [])
    return (data?.providers.flatMap((provider) => provider.models) ?? []).map((model) => ({
      ...model,
      providerName: names.get(model.providerId),
    }))
  }, [data])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = isDemoMode() ? DEMO_PROVIDERS : await api.getProviders()
      setData(next)
      if (next.onboardingRequired && onboarding) setStep("choose")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [onboarding])

  useEffect(() => {
    if (open) void load()
  }, [load, open])

  const chooseProvider = (kind: ProviderKind) => {
    const preset = PROVIDER_PRESETS.find((item) => item.kind === kind)!
    setDraft({ name: preset.name, kind, baseUrl: preset.baseUrl, apiKey: "", enabled: true })
    setEditingProviderId(null)
    setStep("credentials")
  }

  const connect = async () => {
    if (!draft) return
    if (!draft.name.trim() || !draft.baseUrl.trim() || (!editingProviderId && !draft.apiKey.trim())) {
      toast.error(editingProviderId ? "Enter a name and base URL." : "Enter a name, base URL, and API key.")
      return
    }
    setLoading(true)
    try {
      if (editingProviderId) {
        const { apiKey, ...providerDraft } = draft
        const provider = await api.updateProvider(editingProviderId, {
          ...providerDraft,
          ...(apiKey.trim() ? { apiKey } : {}),
        })
        await api.testProvider(provider.id)
        setEditingProviderId(null)
        setDraft(null)
        setStep("list")
        await load()
        await onChanged()
        toast.success("Provider updated")
        return
      }
      const provider = await api.createProvider(draft)
      setCreatedProvider(provider)
      await api.testProvider(provider.id)
      const result = await api.discoverProviderModels(provider.id)
      setDiscovered(result.models)
      setSelected(new Set(result.models.slice(0, 8).map((model) => model.upstreamId)))
      setStep("models")
      haptic.success()
    } catch (error) {
      haptic.error()
      toast.error(error instanceof Error ? error.message : String(error))
      await load()
    } finally {
      setLoading(false)
    }
  }

  const addSelectedModels = async () => {
    if (!createdProvider) return
    const models = discovered.filter((model) => selected.has(model.upstreamId))
    if (models.length === 0) {
      toast.error("Select at least one model.")
      return
    }
    setLoading(true)
    try {
      for (const model of models) {
        await api.createProviderModel(createdProvider.id, {
          ...model,
          contextWindow: model.contextWindow ?? 128_000,
          multiplier: 1,
          enabled: true,
          config: {
            apiMode:
              createdProvider.kind === "openai-compatible"
                ? "chat-completions"
                : "responses",
            ...(createdProvider.kind === "perplexity"
              ? { builtinTools: ["web_search" as const, "fetch_url" as const] }
              : {}),
          },
        })
      }
      toast.success(`${models.length} ${models.length === 1 ? "model" : "models"} added`)
      setStep("list")
      setDraft(null)
      setCreatedProvider(null)
      setDiscovered([])
      await load()
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const removeProvider = async (provider: AiProviderRecord) => {
    if (!(await confirmTelegram(`Delete ${provider.name} and all of its models?`))) return
    try {
      await api.deleteProvider(provider.id)
      await load()
      await onChanged()
      toast.success("Provider deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const removeModel = async (model: AiModelRecord) => {
    if (!(await confirmTelegram(`Delete ${model.name}?`))) return
    try {
      await api.deleteProviderModel(model.id)
      await load()
      await onChanged()
      toast.success("Model deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const title =
    step === "choose"
      ? "Choose a provider"
      : step === "credentials"
        ? editingProviderId
          ? "Edit provider"
          : "Connect provider"
        : step === "models"
          ? "Choose models"
          : data?.onboardingRequired
            ? "Set up AI"
            : "AI providers"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto h-[min(96dvh,56rem)] max-h-[96dvh] max-w-md overflow-y-auto rounded-t-[1.75rem] p-0">
        <SheetHeader className="px-5 pt-5 pr-14 pb-4 text-left">
          <div className="flex items-center gap-2">
            {step !== "list" && (
              <IconButton
                label="Go back"
                onClick={() => {
                  if (step === "credentials" && editingProviderId) {
                    setEditingProviderId(null)
                    setDraft(null)
                    setStep("list")
                  } else {
                    setStep(step === "credentials" ? "choose" : "list")
                  }
                }}
              >
                <ArrowLeftIcon aria-hidden className="size-4" />
              </IconButton>
            )}
            <div>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>
                {step === "list"
                  ? "Manage server credentials and the models available in Skye."
                  : `Step ${step === "choose" ? 1 : step === "credentials" ? 2 : 3} of 3`}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
          {loading && !data ? (
            <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-[13px] text-muted">
              <ArrowPathIcon aria-hidden className="size-4 animate-spin" /> Loading providers…
            </div>
          ) : step === "choose" ? (
            PROVIDER_PRESETS.map((preset) => (
              <ProviderChoice key={preset.kind} preset={preset} onSelect={() => chooseProvider(preset.kind)} />
            ))
          ) : step === "credentials" && draft ? (
            <GlassCard strong className="flex flex-col gap-4 p-4">
              <div className="grid gap-1.5">
                <Label htmlFor="provider-name">Provider name</Label>
                <Input id="provider-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="provider-url">Base URL</Label>
                <Input id="provider-url" type="url" inputMode="url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" autoCapitalize="off" autoCorrect="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="provider-key">API key</Label>
                <Input id="provider-key" type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={editingProviderId ? "Leave blank to keep the saved key" : "Paste a server API key"} />
                <p className="text-[12px] leading-4 text-muted">{editingProviderId ? "Enter a new key only when you want to replace the saved key." : "The key is encrypted at rest and is never shown again."}</p>
              </div>
              <label className="flex min-h-11 items-center gap-3 rounded-[12px] bg-[color-mix(in_oklab,var(--muted)_7%,transparent)] px-3 text-[13px] text-ink">
                <input type="checkbox" checked={draft.enabled !== false} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="size-4 accent-[var(--sky)]" />
                Enable this provider
              </label>
              <GlassButton disabled={loading} onClick={() => void connect()}>
                <KeyIcon aria-hidden className="size-[18px]" />
                {loading ? "Checking connection…" : editingProviderId ? "Save provider" : "Connect and continue"}
              </GlassButton>
            </GlassCard>
          ) : step === "models" ? (
            <>
              {discovered.length === 0 ? (
                <GlassCard className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                  <ExclamationTriangleIcon aria-hidden className="size-6 text-warning" />
                  <div>
                    <p className="text-[15px] font-semibold text-ink">No models were discovered</p>
                    <p className="mt-1 text-[13px] text-muted">Finish setup, then add a model ID manually.</p>
                  </div>
                  <GlassButton onClick={() => { setStep("list"); void load(); void onChanged() }}>Finish setup</GlassButton>
                </GlassCard>
              ) : (
                <>
                  <p className="text-[13px] leading-[18px] text-muted">Select the models users can access. You can edit capabilities later.</p>
                  <div className="flex flex-col gap-2">
                    {discovered.map((model) => (
                      <label key={model.upstreamId} className="glass flex min-h-[68px] items-center gap-3 rounded-[16px] p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(model.upstreamId)}
                          onChange={(event) => {
                            const next = new Set(selected)
                            if (event.target.checked) next.add(model.upstreamId)
                            else next.delete(model.upstreamId)
                            setSelected(next)
                          }}
                          className="size-5 shrink-0 accent-[var(--sky)]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-ink">{model.name}</span>
                          <span className="mt-1 block truncate text-[11px] text-muted">{model.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(" · ")}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <GlassButton disabled={loading} onClick={() => void addSelectedModels()}>
                    {loading ? "Adding models…" : "Add selected models"}
                  </GlassButton>
                </>
              )}
            </>
          ) : editingModel ? (
            <ModelForm
              providerId={editingModel.providerId}
              model={editingModel.model}
              onCancel={() => setEditingModel(null)}
              onSaved={() => { setEditingModel(null); void load(); void onChanged() }}
            />
          ) : (
            <>
              {data && data.providers.length > 0 && (
                <GlassCard strong className="flex flex-col gap-4 p-4">
                  <div>
                    <p className="text-[15px] font-semibold text-ink">Bot defaults</p>
                    <p className="mt-1 text-[12px] leading-4 text-muted">Used when a chat has not selected its own model.</p>
                  </div>
                  {DEFAULT_ROUTES.map((route) => {
                    const choices = adminModels.filter((model) => model.enabled && model.capabilities.includes(route.capability))
                    return (
                      <div key={route.key} className="grid gap-1.5">
                        <Label htmlFor={`default-${route.key}`}>{route.label}</Label>
                        <select
                          id={`default-${route.key}`}
                          value={data.defaults[route.key] ?? ""}
                          onChange={async (event) => {
                            try {
                              await api.updateAiDefaults({ [route.key]: event.target.value || null })
                              await load()
                              await onChanged()
                              haptic.selection()
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : String(error))
                            }
                          }}
                          className="min-h-11 rounded-[12px] border border-[var(--segment-border)] bg-[var(--segment-fill)] px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky"
                        >
                          <option value="">Not configured</option>
                          {choices.map((model) => (
                            <option key={model.id} value={model.id}>{model.name} · {model.providerName}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </GlassCard>
              )}
              {data?.providers.length === 0 ? (
                <GlassCard className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                  <IconWell><CpuChipIcon aria-hidden className="size-[18px]" /></IconWell>
                  <div>
                    <p className="text-[15px] font-semibold text-ink">No providers yet</p>
                    <p className="mt-1 text-[13px] leading-[18px] text-muted">Connect a provider to make text, image, and audio models available.</p>
                  </div>
                  <GlassButton onClick={() => setStep("choose")}><PlusIcon aria-hidden className="size-[18px]" /> Add provider</GlassButton>
                </GlassCard>
              ) : (
                data?.providers.map((provider) => (
                  <GlassCard key={provider.id} className="flex flex-col gap-4 p-4">
                    <div className="flex items-start gap-3">
                      <IconWell tone={provider.status === "ready" ? "success" : provider.status === "error" ? "danger" : "muted"}>
                        {provider.status === "ready" ? <CheckCircleIcon aria-hidden className="size-[18px]" /> : <CpuChipIcon aria-hidden className="size-[18px]" />}
                      </IconWell>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-ink">{provider.name}</p>
                        <p className="mt-0.5 text-[12px] text-muted">{provider.kind} · {provider.models.length} {provider.models.length === 1 ? "model" : "models"}</p>
                        {provider.lastError && <p role="alert" className="mt-2 text-[12px] leading-4 text-danger">{provider.lastError}</p>}
                      </div>
                      <IconButton label={`Delete ${provider.name}`} className="text-danger" onClick={() => void removeProvider(provider)}>
                        <TrashIcon aria-hidden className="size-4" />
                      </IconButton>
                    </div>
                    {provider.models.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {provider.models.map((model) => (
                          <div key={model.id} className="flex items-center gap-1 rounded-[12px] bg-[color-mix(in_oklab,var(--muted)_7%,transparent)] p-1">
                            <button
                              type="button"
                              onClick={() => setEditingModel({ providerId: provider.id, model })}
                              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold text-ink">{model.name}</span>
                                <span className="block truncate text-[11px] text-muted">{model.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(" · ")}</span>
                              </span>
                              <ChevronRightIcon aria-hidden className="size-4 text-faint" />
                            </button>
                            <IconButton label={`Delete ${model.name}`} className="text-danger" onClick={() => void removeModel(model)}>
                              <TrashIcon aria-hidden className="size-4" />
                            </IconButton>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <GlassButton variant="ghost" className="px-2" onClick={async () => {
                        try { await api.testProvider(provider.id); toast.success("Connection works"); await load() }
                        catch (error) { toast.error(error instanceof Error ? error.message : String(error)); await load() }
                      }}>
                        Test
                      </GlassButton>
                      <GlassButton variant="ghost" className="px-2" onClick={() => {
                        setEditingProviderId(provider.id)
                        setDraft({ name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, apiKey: "", enabled: provider.enabled })
                        setStep("credentials")
                      }}>
                        Edit
                      </GlassButton>
                      <GlassButton variant="soft" className="px-2" onClick={() => setEditingModel({ providerId: provider.id })}>
                        Add model
                      </GlassButton>
                    </div>
                  </GlassCard>
                ))
              )}
              {data && data.providers.length > 0 && (
                <GlassButton variant="secondary" onClick={() => setStep("choose")}>
                  <PlusIcon aria-hidden className="size-[18px]" /> Add provider
                </GlassButton>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
