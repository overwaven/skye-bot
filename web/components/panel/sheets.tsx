"use client"

import {
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrashIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline"
import {
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import { toast } from "sonner"

import {
  Divider,
  GlassCard,
  IconButton,
  IconWell,
  SheetHandle,
} from "@/components/panel/primitives"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  api,
  type AboutInfo,
  type AdminPrincipalsResponse,
  type AgentsResponse,
  type ConnectorsResponse,
  type CustomConnector,
  type PersonalAgent,
  type PersonalAgentInput,
} from "@/lib/api"
import { confirmTelegram, haptic, openLink } from "@/lib/telegram"
import { cn } from "@/lib/utils"

const inputClass =
  "glass min-h-11 w-full rounded-[14px] px-3.5 py-2.5 text-base leading-5 text-ink outline-none transition-shadow placeholder:text-faint focus-visible:ring-2 focus-visible:ring-sky sm:text-[15px]"

const labelClass = "text-[13px] leading-[18px] font-medium text-muted"

const primaryButtonClass =
  "pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-sky text-[15px] leading-5 font-semibold text-white shadow-[inset_0_1px_0_color-mix(in_oklab,white_35%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45"

const secondaryButtonClass =
  "pressable glass inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] text-[15px] leading-5 font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:pointer-events-none disabled:opacity-45"

const dangerButtonClass =
  "pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[15px] leading-5 font-semibold text-danger outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:pointer-events-none disabled:opacity-45"

export function BottomSheetFrame({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto w-full max-w-md border-transparent bg-transparent p-0 shadow-none"
      >
        <div className="glass-sheet flex max-h-[92dvh] flex-col rounded-t-[28px] pt-3 pb-[calc(var(--safe-bottom)+1.25rem)]">
          <SheetHandle />
          <SheetHeader className="flex-row items-start gap-3 px-5 pt-1 pb-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-ink">
                {title}
              </SheetTitle>
              <SheetDescription className="mt-1 text-[13px] leading-[18px] text-muted">
                {description}
              </SheetDescription>
            </div>
            <IconButton
              label="Close"
              className="glass -mt-1 rounded-[14px]"
              onClick={() => onOpenChange(false)}
            >
              <XMarkIcon aria-hidden className="size-[18px]" />
            </IconButton>
          </SheetHeader>
          <div className="panel-no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-1">
            {children}
          </div>
          {footer && <div className="shrink-0 px-5 pt-4">{footer}</div>}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SelectPill({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  const selected = options.find((option) => option.value === value)
  return (
    <div className="glass relative flex min-h-11 items-center gap-3 rounded-[14px] px-3.5 focus-within:ring-2 focus-within:ring-sky">
      <span className="min-w-0 flex-1 truncate text-[15px] leading-5 text-ink">
        {selected?.label ?? "Choose"}
      </span>
      <ChevronDownIcon
        aria-hidden
        className="size-4 shrink-0 text-faint [stroke-width:2]"
      />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-[14px] text-base opacity-0 outline-none disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AboutSheet({
  about,
  open,
  onOpenChange,
}: {
  about: AboutInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!about) return null
  return (
    <BottomSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="About Skye"
      description="Free software, calm by design."
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => openLink(about.sourceUrl)}
          >
            <CodeBracketIcon aria-hidden className="size-[18px]" />
            View source
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => openLink(about.securityUrl)}
          >
            <ShieldCheckIcon aria-hidden className="size-[18px]" />
            Security policy
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <GlassCard
          strong
          className="flex flex-col gap-2 p-[18px] text-balance"
        >
          <SparklesIcon aria-hidden className="size-6 text-sky-deep" />
          <p className="mt-2 text-[22px] leading-7 font-semibold tracking-[-0.02em] text-ink">
            Inspect it. Improve it. Share it.
          </p>
          <p className="text-[13px] leading-[18px] text-muted">
            Licensed under {about.license}.
          </p>
        </GlassCard>

        <GlassCard className="flex flex-col overflow-hidden">
          {(
            [
              ["Version", about.version],
              ["Commit", about.commit?.slice(0, 12) ?? "not supplied"],
              ["Access", about.accessMode],
              ["Maintainer", about.maintainer.name],
            ] as Array<[string, string]>
          ).map(([label, value], index) => (
            <div key={label}>
              {index > 0 && <Divider />}
              <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                <span className="text-[13px] leading-[18px] text-muted">
                  {label}
                </span>
                <span className="truncate text-[13px] leading-[18px] font-medium text-ink">
                  {value}
                </span>
              </div>
            </div>
          ))}
        </GlassCard>

        <button
          type="button"
          className={cn(secondaryButtonClass, "justify-between px-4")}
          onClick={() =>
            openLink(
              `https://t.me/${about.maintainer.telegram.replace(/^@/, "")}`
            )
          }
        >
          <span className="flex items-center gap-2">
            <ChatBubbleLeftRightIcon aria-hidden className="size-[18px]" />
            {about.maintainer.telegram}
          </span>
          <ArrowTopRightOnSquareIcon
            aria-hidden
            className="size-4 text-faint"
          />
        </button>
      </div>
    </BottomSheetFrame>
  )
}

export function AdminSheet({
  about,
  data,
  open,
  onOpenChange,
  onChange,
}: {
  about: AboutInfo | null
  data: AdminPrincipalsResponse | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (data: AdminPrincipalsResponse) => void
}) {
  const [userId, setUserId] = useState("")
  const [busy, setBusy] = useState(false)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = Number(userId)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return
    setBusy(true)
    try {
      const result = await api.addAdminPrincipal(parsed)
      if (data) onChange({ ...data, admins: result.admins })
      setUserId("")
      toast.success("Administrator added")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    if (
      !(await confirmTelegram(
        `Remove Telegram user ${id} from administrators?`
      ))
    )
      return
    setBusy(true)
    try {
      const result = await api.removeAdminPrincipal(id)
      if (data) onChange({ ...data, admins: result.admins })
      toast.success("Administrator removed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Administration"
      description={`${about?.accessMode ?? "Unknown"} access · ${
        about?.isOwner ? "primary owner" : "administrator"
      }`}
    >
      <div className="flex flex-col gap-4">
        <GlassCard className="flex flex-col overflow-hidden">
          {data?.admins.map((admin, index) => (
            <div key={admin.userId}>
              {index > 0 && <Divider />}
              <div className="flex min-h-14 items-center gap-3 px-4 py-3.5">
                <IconWell tone={admin.role === "owner" ? "sky" : "muted"}>
                  {admin.role === "owner" ? (
                    <KeyIcon aria-hidden className="size-[18px]" />
                  ) : (
                    <UserIcon aria-hidden className="size-[18px]" />
                  )}
                </IconWell>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[14px] leading-[18px] text-ink">
                    {admin.userId}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-4 text-muted">
                    {admin.role === "owner"
                      ? "Primary owner"
                      : admin.removable
                        ? "Delegated admin"
                        : "Config admin"}
                  </p>
                </div>
                {admin.removable && data.canManage && (
                  <IconButton
                    label={`Remove administrator ${admin.userId}`}
                    disabled={busy}
                    onClick={() => void remove(admin.userId)}
                  >
                    <TrashIcon aria-hidden className="size-[18px] text-danger" />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </GlassCard>

        {data?.canManage && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => void add(event)}
          >
            <label htmlFor="admin-id" className={labelClass}>
              Add by Telegram user ID
            </label>
            <div className="flex gap-2">
              <input
                id="admin-id"
                inputMode="numeric"
                value={userId}
                onChange={(event) =>
                  setUserId(event.target.value.replace(/\D/g, ""))
                }
                placeholder="123456789"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={busy || !userId}
                className={cn(primaryButtonClass, "min-h-11 w-auto px-4")}
              >
                <PlusIcon aria-hidden className="size-[18px]" />
                Add
              </button>
            </div>
          </form>
        )}
      </div>
    </BottomSheetFrame>
  )
}

export function AgentsSheet({
  data,
  open,
  onOpenChange,
  onChange,
  onEdit,
}: {
  data: AgentsResponse | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (data: AgentsResponse) => void
  onEdit: (agent: PersonalAgent | "new") => void
}) {
  const select = async (agentId: string | null) => {
    if (!data) return
    try {
      const result = await api.selectAgent(agentId)
      onChange({ ...data, activeAgentId: result.activeAgentId })
      haptic.success()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const setPrimary = async (agentId: string | null) => {
    if (!data) return
    try {
      const result = await api.setPrimaryAgent(agentId)
      onChange({ ...data, primaryAgentId: result.primaryAgentId })
      haptic.success()
      toast.success(agentId ? "Primary agent updated" : "Primary agent cleared")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const createFromTemplate = async (templateId: string) => {
    if (!data) return
    const template = data.templates.find((item) => item.id === templateId)
    if (!template) return
    try {
      const created = await api.createAgent({
        name: template.name,
        description: template.description,
        instructions: template.instructions,
        modelId: null,
      })
      const primary = await api.setPrimaryAgent(created.id)
      const selected = await api.selectAgent(created.id)
      onChange({
        ...data,
        agents: [...data.agents, created],
        activeAgentId: selected.activeAgentId,
        primaryAgentId: primary.primaryAgentId,
      })
      haptic.success()
      toast.success(`${template.name} ready`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const defaultActive = data?.activeAgentId === null

  return (
    <BottomSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Personal agents"
      description="Primary applies everywhere. Active overrides this chat."
      footer={
        <button
          type="button"
          className={primaryButtonClass}
          disabled={!data || data.agents.length >= data.maxAgents}
          onClick={() => onEdit("new")}
        >
          <PlusIcon aria-hidden className="size-[18px]" />
          New agent
        </button>
      }
    >
      {!data ? (
        <div className="flex flex-col gap-2" aria-busy>
          <div className="glass h-16 animate-pulse rounded-[16px]" />
          <div className="glass h-16 animate-pulse rounded-[16px]" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void select(null)}
              aria-pressed={defaultActive}
              className={cn(
                "pressable flex min-h-16 w-full items-center gap-3 rounded-[16px] p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky",
                defaultActive
                  ? "bg-[color-mix(in_oklab,var(--sky)_12%,transparent)]"
                  : "glass"
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[color-mix(in_oklab,white_70%,transparent)] dark:bg-[color-mix(in_oklab,white_10%,transparent)]">
                <SparklesIcon aria-hidden className="size-[18px] text-sky-deep" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-5 font-semibold text-ink">
                  Default Skye
                </span>
                <span
                  className={cn(
                    "mt-0.5 block truncate text-[12px] leading-4 font-medium",
                    defaultActive ? "text-sky-deep" : "text-muted"
                  )}
                >
                  {defaultActive
                    ? "Active · built-in character"
                    : "Built-in character and chat model"}
                </span>
              </span>
            </button>

            {data.agents.map((agent) => {
              const active = data.activeAgentId === agent.id
              const primary = data.primaryAgentId === agent.id
              return (
                <div
                  key={agent.id}
                  className={cn(
                    "flex min-h-16 items-center gap-2 rounded-[16px] p-2 pl-3.5",
                    active
                      ? "bg-[color-mix(in_oklab,var(--sky)_12%,transparent)]"
                      : "glass"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void select(agent.id)}
                    aria-pressed={active}
                    className="pressable flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[color-mix(in_oklab,white_70%,transparent)] dark:bg-[color-mix(in_oklab,white_10%,transparent)]">
                      <UserIcon
                        aria-hidden
                        className={cn(
                          "size-[18px]",
                          active ? "text-sky-deep" : "text-muted"
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] leading-5 font-semibold text-ink">
                        {agent.name}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[12px] leading-4",
                          active
                            ? "font-medium text-sky-deep"
                            : "text-muted"
                        )}
                      >
                        {[
                          active ? "Active" : null,
                          primary ? "Primary" : null,
                          agent.description || "Personal specialist",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                  <IconButton
                    label={
                      primary
                        ? `Clear ${agent.name} as primary`
                        : `Make ${agent.name} primary`
                    }
                    onClick={() => void setPrimary(primary ? null : agent.id)}
                  >
                    <SparklesIcon
                      aria-hidden
                      className={cn(
                        "size-[18px]",
                        primary ? "text-sky-deep" : "text-faint"
                      )}
                    />
                  </IconButton>
                  <IconButton
                    label={`Edit ${agent.name}`}
                    onClick={() => onEdit(agent)}
                  >
                    <PencilSquareIcon
                      aria-hidden
                      className="size-[18px] text-muted"
                    />
                  </IconButton>
                </div>
              )
            })}

            {data.agents.length === 0 && (
              <p className="px-1 py-4 text-center text-[13px] leading-[18px] text-muted">
                Your specialist team is waiting to be built.
              </p>
            )}
          </div>

          {data.templates.length > 0 && data.agents.length < data.maxAgents && (
            <div className="flex flex-col gap-2">
              <p className="px-1 text-[11px] leading-4 font-semibold tracking-[0.06em] text-faint uppercase">
                Start from a template
              </p>
              {data.templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => void createFromTemplate(template.id)}
                  className="pressable flex w-full items-center gap-3 rounded-[16px] border border-dashed border-[var(--divider)] p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-5 font-medium text-ink">
                      {template.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">
                      {template.description}
                    </span>
                  </span>
                  <PlusIcon
                    aria-hidden
                    className="size-4 shrink-0 text-faint"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </BottomSheetFrame>
  )
}

export function AgentDialog({
  data,
  editing,
  onEditing,
  onChange,
}: {
  data: AgentsResponse | null
  editing: PersonalAgent | "new" | null
  onEditing: (agent: PersonalAgent | "new" | null) => void
  onChange: (data: AgentsResponse) => void
}) {
  const [draft, setDraft] = useState<PersonalAgentInput>({
    name: "",
    description: "",
    instructions: "",
    modelId: null,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) return
    queueMicrotask(() =>
      setDraft(
        editing === "new"
          ? { name: "", description: "", instructions: "", modelId: null }
          : {
              name: editing.name,
              description: editing.description,
              instructions: editing.instructions,
              modelId: editing.modelId,
            }
      )
    )
  }, [editing])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!data) return
    setBusy(true)
    try {
      if (editing === "new") {
        const created = await api.createAgent(draft)
        const selected = await api.selectAgent(created.id)
        onChange({
          ...data,
          agents: [...data.agents, created],
          activeAgentId: selected.activeAgentId,
        })
      } else if (editing) {
        const updated = await api.updateAgent(editing.id, draft)
        onChange({
          ...data,
          agents: data.agents.map((agent) =>
            agent.id === updated.id ? updated : agent
          ),
        })
      }
      onEditing(null)
      toast.success("Agent saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!data || !editing || editing === "new") return
    if (!(await confirmTelegram(`Delete ${editing.name}?`))) return
    setBusy(true)
    try {
      await api.deleteAgent(editing.id)
      onChange({
        ...data,
        agents: data.agents.filter((agent) => agent.id !== editing.id),
        activeAgentId:
          data.activeAgentId === editing.id ? null : data.activeAgentId,
        primaryAgentId:
          data.primaryAgentId === editing.id ? null : data.primaryAgentId,
      })
      onEditing(null)
      toast.success("Agent deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(open) => !open && onEditing(null)}
    >
      <DialogContent
        showCloseButton={false}
        className="panel-no-scrollbar max-h-[90dvh] gap-0 overflow-y-auto rounded-[28px] border-transparent bg-transparent p-0 shadow-none ring-0"
      >
        <div className="glass-sheet flex flex-col gap-4 rounded-[28px] p-5">
          <DialogHeader className="flex-row items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-ink">
                {editing === "new" ? "New agent" : "Edit agent"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-[18px] text-muted">
                Give this specialist a clear role and operating brief.
              </DialogDescription>
            </div>
            <IconButton
              label="Close"
              className="glass -mt-1 rounded-[14px]"
              onClick={() => onEditing(null)}
            >
              <XMarkIcon aria-hidden className="size-[18px]" />
            </IconButton>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void save(event)}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="agent-name" className={labelClass}>
                Name
              </label>
              <input
                id="agent-name"
                value={draft.name}
                maxLength={80}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="agent-description" className={labelClass}>
                Short description
              </label>
              <input
                id="agent-description"
                value={draft.description}
                maxLength={180}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="agent-instructions" className={labelClass}>
                Instructions
              </label>
              <textarea
                id="agent-instructions"
                rows={6}
                value={draft.instructions}
                onChange={(event) =>
                  setDraft({ ...draft, instructions: event.target.value })
                }
                className={cn(inputClass, "resize-y")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Model</span>
              <SelectPill
                label="Agent model"
                value={draft.modelId ?? "__current__"}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    modelId: value === "__current__" ? null : value,
                  })
                }
                options={[
                  { value: "__current__", label: "Current chat model" },
                  ...(data?.models ?? []).map((model) => ({
                    value: model.id,
                    label: `${model.name} · ${model.multiplier}×`,
                  })),
                ]}
              />
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="submit"
                disabled={
                  busy || !draft.name.trim() || !draft.instructions.trim()
                }
                className={primaryButtonClass}
              >
                <CheckIcon aria-hidden className="size-[18px]" />
                Save agent
              </button>
              {editing !== "new" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className={dangerButtonClass}
                >
                  <TrashIcon aria-hidden className="size-[18px]" />
                  Delete agent
                </button>
              )}
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface HeaderDraft {
  key: string
  value: string
  inputId: string
}

function headerInputId(key: string, index: number): string {
  const normalized = key
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/^([^A-Z_])/, "_$1")
  return `HEADER_${normalized || index + 1}_${index + 1}`.slice(0, 64)
}

function connectorHeaders(
  connector: CustomConnector | undefined
): HeaderDraft[] {
  const headers = connector?.config.headers
  if (!headers || typeof headers !== "object" || Array.isArray(headers))
    return []
  return Object.entries(headers as Record<string, unknown>).map(
    ([key, raw], index) => {
      const match = String(raw).match(
        /^\$\{input:([A-Za-z_][A-Za-z0-9_]{0,63})\}$/
      )
      return {
        key,
        value: "",
        inputId: match?.[1] ?? headerInputId(key, index),
      }
    }
  )
}

export function ConnectorSheet({
  editing,
  onEditing,
  onChange,
}: {
  editing: CustomConnector | "new" | null
  onEditing: (value: CustomConnector | "new" | null) => void
  onChange: Dispatch<SetStateAction<ConnectorsResponse>>
}) {
  const connector = editing && editing !== "new" ? editing : undefined
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState<HeaderDraft[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) return
    queueMicrotask(() => {
      setName(connector?.name ?? "")
      setUrl(String(connector?.config.url ?? ""))
      setHeaders(connectorHeaders(connector))
      setAcknowledged(false)
    })
  }, [connector, editing])

  const save = async () => {
    const headerConfig: Record<string, string> = {}
    const inputs: Record<string, string> = {}
    headers.forEach((header, index) => {
      const key = header.key.trim()
      if (!key) return
      const inputId = header.inputId || headerInputId(key, index)
      headerConfig[key] = `\${input:${inputId}}`
      if (header.value) inputs[inputId] = header.value
    })
    setBusy(true)
    try {
      const config = {
        type: "http",
        url: url.trim(),
        ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
      }
      const saved = connector
        ? await api.updateCustomConnector(
            connector.id,
            name.trim(),
            config,
            inputs
          )
        : await api.addCustomConnector(name.trim(), config, inputs)
      onChange((current) => ({
        ...current,
        custom: connector
          ? current.custom.map((item) => (item.id === saved.id ? saved : item))
          : [...current.custom, saved],
      }))
      onEditing(null)
      toast.success("Connector saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!connector || !(await confirmTelegram("Delete this custom connector?")))
      return
    setBusy(true)
    try {
      await api.deleteCustomConnector(connector.id)
      onChange((current) => ({
        ...current,
        custom: current.custom.filter((item) => item.id !== connector.id),
      }))
      onEditing(null)
      toast.success("Connector deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const valid = name.trim() && url.trim().startsWith("https://") && acknowledged

  return (
    <BottomSheetFrame
      open={editing !== null}
      onOpenChange={(open) => !open && onEditing(null)}
      title={connector ? "Custom connector" : "New custom connector"}
      description="Connect only to an HTTPS tool server whose operator you trust."
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => void save()}
            className={primaryButtonClass}
          >
            <CheckIcon aria-hidden className="size-[18px]" />
            Save connector
          </button>
          {connector && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className={dangerButtonClass}
            >
              <TrashIcon aria-hidden className="size-[18px]" />
              Delete connector
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-[16px] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] p-3.5">
          <ExclamationTriangleIcon
            aria-hidden
            className="size-[18px] shrink-0 text-warning"
          />
          <p className="text-[13px] leading-[18px] text-ink">
            Custom tools can see their requests, and may return untrusted or
            misleading content.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="connector-name" className={labelClass}>
            Name
          </label>
          <input
            id="connector-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My connector"
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="connector-url" className={labelClass}>
            HTTPS endpoint
          </label>
          <input
            id="connector-url"
            value={url}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://connector.example.com/mcp"
            className={inputClass}
          />
        </div>

        <Divider />

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] leading-[18px] font-medium text-ink">
              Secret headers
            </p>
            <p className="text-[12px] leading-4 text-muted">
              Leave an existing secret blank to keep it.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setHeaders((items) => [
                ...items,
                {
                  key: "",
                  value: "",
                  inputId: headerInputId("", items.length),
                },
              ])
            }
            className="pressable glass inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] leading-4 font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky"
          >
            <PlusIcon aria-hidden className="size-4" />
            Header
          </button>
        </div>

        {headers.map((header, index) => (
          <div
            key={`${header.inputId}-${index}`}
            className="grid grid-cols-[1fr_1fr_auto] gap-2"
          >
            <input
              aria-label="Header name"
              value={header.key}
              placeholder="Authorization"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) =>
                setHeaders((items) =>
                  items.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, key: event.target.value }
                      : item
                  )
                )
              }
              className={inputClass}
            />
            <input
              aria-label="Header secret"
              type="password"
              autoComplete="off"
              value={header.value}
              placeholder={connector ? "Keep current" : "Secret"}
              onChange={(event) =>
                setHeaders((items) =>
                  items.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, value: event.target.value }
                      : item
                  )
                )
              }
              className={inputClass}
            />
            <IconButton
              label="Remove header"
              onClick={() =>
                setHeaders((items) =>
                  items.filter((_, itemIndex) => itemIndex !== index)
                )
              }
            >
              <TrashIcon aria-hidden className="size-[18px] text-danger" />
            </IconButton>
          </div>
        ))}

        <label className="flex cursor-pointer items-start gap-3 rounded-[16px] bg-[color-mix(in_oklab,var(--sky)_10%,transparent)] p-3.5 text-[13px] leading-[18px] text-ink">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--sky-deep)] outline-none focus-visible:ring-2 focus-visible:ring-sky"
          />
          <span>
            I trust this operator and understand that Skye cannot verify how it
            handles my data.
          </span>
        </label>
      </div>
    </BottomSheetFrame>
  )
}
