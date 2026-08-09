"use client"

import {
  BoltIcon,
  ChevronDownIcon,
  RocketLaunchIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline"
import { StarIcon } from "@heroicons/react/24/solid"

import { FadeIn, GlassCard, IconWell } from "@/components/panel/primitives"
import type { BillingAccount, ModelEntry, Plans } from "@/lib/api"
import { formatCompactTokens, formatDate, formatTokens } from "@/lib/format"
import { cn } from "@/lib/utils"

const PACK_TONES = ["sky", "violet", "amber"] as const
const PACK_ICONS = [BoltIcon, SparklesIcon, RocketLaunchIcon]

export function PlusView({
  account,
  models,
  activeModelId,
  plans,
  busy,
  onModel,
  onPurchase,
  onCancel,
}: {
  account: BillingAccount | null
  models: ModelEntry[]
  activeModelId: string
  plans: Plans | null
  busy: boolean
  onModel: (id: string) => void
  onPurchase: (id: string) => void
  onCancel: () => void
}) {
  const quota = (account?.baseQuotaTokens ?? 0) + (account?.packsTokens ?? 0)
  const remaining = account?.remaining ?? 0
  const remainingPercent = quota
    ? Math.max(0, Math.min(100, Math.round((remaining / quota) * 100)))
    : 0
  const activeModel = models.find((model) => model.id === activeModelId)
  const hasActiveSub = Boolean(account?.hasActiveSub)
  const cancelled = account?.subStatus === "cancelled"
  const billingOn = Boolean(plans?.enabled)

  return (
    <>
      <FadeIn className="flex flex-col gap-4 px-1 pt-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 flex-1 text-[22px] leading-7 font-semibold tracking-[-0.02em] text-ink">
            {billingOn
              ? hasActiveSub
                ? `${formatTokens(remaining)} tokens`
                : (plans?.title ?? "Skye Plus")
              : "Choose your model."}
          </h1>
          {billingOn && hasActiveSub && (
            <span
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[12px] leading-4 font-semibold",
                cancelled
                  ? "bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-warning"
                  : "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-success"
              )}
            >
              {cancelled ? "Cancels soon" : "Active"}
            </span>
          )}
        </div>

        {billingOn && hasActiveSub ? (
          <div className="flex flex-col gap-2">
            <div
              role="progressbar"
              aria-label="Monthly allowance remaining"
              aria-valuenow={remainingPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,white_70%,transparent)] dark:bg-[color-mix(in_oklab,white_12%,transparent)]"
            >
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--sky)_0%,var(--sky-deep)_100%)]"
                style={{ width: `${remainingPercent}%` }}
              />
            </div>
            <p className="text-[12px] leading-4 font-medium text-muted">
              {remainingPercent}% of monthly allowance remaining ·{" "}
              {cancelled ? "ends " : "renews "}
              {formatDate((account?.subExpiresAt ?? 0) * 1000)}
            </p>
          </div>
        ) : (
          <p className="text-[13px] leading-[18px] text-muted">
            {billingOn && plans
              ? `${plans.subscriptionStars} Telegram Stars · ${formatCompactTokens(
                  plans.baseQuotaTokens
                )} tokens included`
              : "Multipliers show relative token usage."}
          </p>
        )}
      </FadeIn>

      <FadeIn delay={0.04}>
        <div className="glass relative flex min-h-14 items-center gap-3 rounded-full px-4 py-1.5 focus-within:ring-2 focus-within:ring-sky">
          <span className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold text-ink">
            {activeModel
              ? `${activeModel.name} · ${activeModel.multiplier}×`
              : "Choose a model"}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-faint [stroke-width:2]"
          />
          <select
            aria-label="Conversation model"
            value={activeModel ? activeModelId : ""}
            disabled={busy || models.length === 0}
            onChange={(event) => {
              if (event.target.value) onModel(event.target.value)
            }}
            className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full text-base opacity-0 outline-none disabled:cursor-not-allowed"
          >
            {!activeModel && <option value="">Choose a model</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.multiplier}×
              </option>
            ))}
          </select>
        </div>
      </FadeIn>

      {billingOn && !hasActiveSub && (
        <FadeIn delay={0.08}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPurchase("subscription")}
            className="pressable flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-sky text-[15px] leading-5 font-semibold text-white shadow-[inset_0_1px_0_color-mix(in_oklab,white_35%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-45"
          >
            <StarIcon aria-hidden className="size-4 text-star" />
            Subscribe · {plans?.subscriptionStars} Stars
          </button>
        </FadeIn>
      )}

      {billingOn && hasActiveSub && (plans?.packs.length ?? 0) > 0 && (
        <FadeIn delay={0.08}>
          <GlassCard
            strong
            className="flex flex-col gap-3.5 p-[18px] shadow-[inset_0_1px_0_color-mix(in_oklab,white_90%,transparent),0_16px_48px_color-mix(in_oklab,var(--sky-deep)_12%,transparent)]"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-[17px] leading-[22px] font-semibold tracking-[-0.02em] text-ink">
                Token boosts
              </h2>
              <p className="text-[13px] leading-[18px] text-muted">
                Extra tokens for a busy month.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {plans?.packs.map((pack, index) => {
                const tone = PACK_TONES[index % PACK_TONES.length]
                const PackIcon = PACK_ICONS[index % PACK_ICONS.length]
                return (
                  <button
                    key={pack.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onPurchase(pack.id)}
                    aria-label={`Buy ${pack.name} for ${pack.stars} Telegram Stars`}
                    className={cn(
                      "pressable flex w-full items-center gap-3 rounded-[16px] p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-45",
                      tone === "sky" &&
                        "bg-[color-mix(in_oklab,var(--sky)_12%,transparent)]",
                      tone === "violet" && "bg-[#7B6CC41F]",
                      tone === "amber" && "bg-[#C49A4A1F]"
                    )}
                  >
                    <IconWell tone={tone} className="size-10">
                      <PackIcon aria-hidden className="size-5" />
                    </IconWell>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px] leading-5 font-semibold text-ink">
                        {pack.name}
                      </span>
                      <span className="truncate text-[12px] leading-4 font-medium text-muted">
                        +{formatCompactTokens(pack.tokens)} tokens
                      </span>
                    </span>
                    <span className="flex min-w-[84px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] bg-boost-ink/95 px-3.5 py-2.5">
                      <StarIcon aria-hidden className="size-4 text-star" />
                      <span className="text-[20px] leading-6 font-bold tracking-[-0.02em] text-white tabular-nums">
                        {pack.stars}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </GlassCard>
        </FadeIn>
      )}

      {billingOn && hasActiveSub && !cancelled && (
        <FadeIn delay={0.12}>
          <button
            type="button"
            onClick={onCancel}
            className="pressable flex min-h-11 w-full items-center justify-center rounded-[14px] p-3 text-[14px] leading-[18px] font-medium text-danger outline-none focus-visible:ring-2 focus-visible:ring-sky"
          >
            Cancel Skye Plus
          </button>
        </FadeIn>
      )}
    </>
  )
}
