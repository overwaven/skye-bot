"use client"

import {
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  PhotoIcon,
  InformationCircleIcon,
  MicrophoneIcon,
  ShieldCheckIcon,
  SpeakerWaveIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline"

import {
  Divider,
  FadeIn,
  GlassCard,
  IconWell,
  ListRow,
  SegmentedControl,
  StatusDot,
} from "@/components/panel/primitives"
import type {
  AboutInfo,
  AgentsResponse,
  BillingAccount,
  ChatConfig,
  ModelEntry,
} from "@/lib/api"
import { formatCompactTokens } from "@/lib/format"

const VOICE_OPTIONS = [
  {
    value: "text" as const,
    label: "Text only",
    icon: <ChatBubbleLeftRightIcon aria-hidden className="size-[18px]" />,
  },
  {
    value: "auto" as const,
    label: "If spoken",
    icon: <MicrophoneIcon aria-hidden className="size-[18px]" />,
  },
  {
    value: "always" as const,
    label: "Always voice",
    icon: <SpeakerWaveIcon aria-hidden className="size-[18px]" />,
  },
]

function agentsSummary(agents: AgentsResponse | null): string {
  if (!agents) return "Instructions and models"
  const count = agents.agents.length
  if (count === 0) return "None yet · tap to create"
  return `${count} ${count === 1 ? "agent" : "agents"} · ${
    agents.primaryAgentId ? "Primary set" : "No primary"
  }`
}

export function ProfileView({
  user,
  chatConfig,
  account,
  activeModel,
  about,
  agents,
  onVoiceChange,
  onAgents,
  onAdmin,
  onConfig,
  onAi,
  onAbout,
  onPlus,
}: {
  user: { name: string; handle: string }
  chatConfig: ChatConfig
  account: BillingAccount | null
  activeModel?: ModelEntry
  about: AboutInfo | null
  agents: AgentsResponse | null
  onVoiceChange: (mode: ChatConfig["voiceReplyMode"]) => void
  onAgents: () => void
  onAdmin: () => void
  onConfig: () => void
  onAi: () => void
  onAbout: () => void
  onPlus: () => void
}) {
  const firstName = user.name.split(" ")[0] || "there"

  return (
    <>
      <FadeIn className="flex flex-col items-center justify-center gap-8 px-6 py-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/skye-star.jpg"
          alt=""
          aria-hidden
          width={92}
          height={92}
          className="animate-star size-[92px] rounded-[34px] object-cover shadow-[0_2px_3px_color-mix(in_oklab,var(--ink)_20%,transparent)] outline outline-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
        />
        <h1 className="text-balance text-[30px] leading-8 font-normal tracking-[-0.02em] text-muted">
          Hello, {firstName}.
        </h1>
      </FadeIn>

      <FadeIn delay={0.04}>
        <GlassCard
          as="button"
          onClick={onPlus}
          aria-label="Change text model and plan"
          className="pressable flex w-full flex-col gap-3.5 p-[18px] text-left outline-none focus-visible:ring-2 focus-visible:ring-sky"
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-[17px] leading-[22px] font-semibold tracking-[-0.01em] text-ink">
              {activeModel?.name ?? "Default model"}
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--sky)_16%,transparent)]">
              <ChevronRightIcon
                aria-hidden
                className="size-[18px] text-sky-deep [stroke-width:2]"
              />
            </span>
          </span>
          <span className="flex w-full items-center gap-2">
            <StatusDot tone={account?.hasActiveSub ? "sky" : "faint"} />
            <span className="truncate text-[13px] leading-4 font-medium text-muted">
              {account?.hasActiveSub
                ? `Skye Plus · ${formatCompactTokens(account.remaining)} tokens left`
                : `${activeModel?.multiplier ?? 1}× token cost`}
            </span>
          </span>
        </GlassCard>
      </FadeIn>

      <FadeIn delay={0.08} className="flex flex-col gap-1.5">
        <p className="text-center text-[12px] leading-5 text-muted">
          Voice Mode
        </p>
        <SegmentedControl
          value={chatConfig.voiceReplyMode}
          onChange={onVoiceChange}
          options={VOICE_OPTIONS}
        />
      </FadeIn>

      <FadeIn delay={0.12}>
        <GlassCard className="flex flex-col overflow-hidden">
          <ListRow
            className="min-h-14"
            icon={
              <IconWell>
                <UserGroupIcon aria-hidden className="size-[18px]" />
              </IconWell>
            }
            title="Personal agents"
            subtitle={agentsSummary(agents)}
            onClick={onAgents}
            trailing={
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-faint [stroke-width:2]"
              />
            }
          />
          <Divider />
          <ListRow
            className="min-h-14"
            icon={
              <IconWell>
                <PhotoIcon aria-hidden className="size-[18px]" />
              </IconWell>
            }
            title="Image model"
            subtitle="Generation and editing"
            onClick={onAi}
            trailing={
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-faint [stroke-width:2]"
              />
            }
          />
          <Divider />
          <ListRow
            className="min-h-14"
            icon={
              <IconWell tone="muted">
                <InformationCircleIcon aria-hidden className="size-[18px]" />
              </IconWell>
            }
            title="About Skye"
            subtitle="Version, license, maintainer"
            onClick={onAbout}
            trailing={
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-faint [stroke-width:2]"
              />
            }
          />
          {about?.isAdmin && (
            <>
              <Divider />
              <ListRow
                className="min-h-14"
                icon={
                  <IconWell tone="muted">
                    <ShieldCheckIcon aria-hidden className="size-[18px]" />
                  </IconWell>
                }
                title="Administration"
                subtitle="Access and principals"
                onClick={onAdmin}
                trailing={
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-faint [stroke-width:2]"
                  />
                }
              />
            </>
          )}
          {about?.isOwner && (
            <>
              <Divider />
              <ListRow
                className="min-h-14"
                icon={
                  <IconWell tone="muted">
                    <Cog6ToothIcon aria-hidden className="size-[18px]" />
                  </IconWell>
                }
                title="Server config"
                subtitle="Edit and validate config.yaml"
                onClick={onConfig}
                trailing={
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-faint [stroke-width:2]"
                  />
                }
              />
            </>
          )}
        </GlassCard>
      </FadeIn>
    </>
  )
}
