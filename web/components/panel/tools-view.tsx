"use client"

import {
  ArrowPathIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  GlobeAltIcon,
  LinkIcon,
  LinkSlashIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline"
import { useState, type ReactNode } from "react"

import {
  ContextMenu,
  Divider,
  FadeIn,
  GlassCard,
  IconButton,
  IconWell,
  ListRow,
  MenuItem,
} from "@/components/panel/primitives"
import type {
  ConnectorsResponse,
  CustomConnector,
  ManagedConnector,
} from "@/lib/api"
import { cn } from "@/lib/utils"

function ManagedCard({
  connector,
  busy,
  menuOpen,
  onMenu,
  onManaged,
}: {
  connector: ManagedConnector
  busy: boolean
  menuOpen: boolean
  onMenu: (slug: string | null) => void
  onManaged: (slug: string, connected: boolean) => void
}) {
  const well = (
    <IconWell
      tone={connector.connected ? "sky" : "muted"}
      className="relative size-10 overflow-hidden"
    >
      <GlobeAltIcon aria-hidden className="size-5" />
      {connector.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={connector.logo}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </IconWell>
  )

  const body = (
    <span className="flex flex-col gap-1 text-left">
      <span className="truncate text-[15px] leading-5 font-semibold text-ink">
        {connector.name}
      </span>
      <span
        className={cn(
          "truncate text-[12px] leading-4 font-medium",
          connector.connected ? "text-success" : "text-sky-deep"
        )}
      >
        {connector.connected ? "Connected" : "Connect"}
      </span>
    </span>
  )

  if (!connector.connected) {
    return (
      <GlassCard
        as="button"
        disabled={busy}
        onClick={() => onManaged(connector.slug, false)}
        aria-label={`Connect ${connector.name}`}
        className="pressable flex min-h-[132px] flex-col gap-3 rounded-[18px] p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-50"
      >
        <span className="flex w-full items-start justify-between gap-2">
          {well}
        </span>
        {body}
      </GlassCard>
    )
  }

  return (
    <GlassCard className="relative flex min-h-[132px] flex-col gap-3 rounded-[18px] p-4">
      <div className="flex w-full items-start justify-between gap-2">
        {well}
        <IconButton
          label={`Options for ${connector.name}`}
          className="size-7 rounded-lg"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => onMenu(menuOpen ? null : connector.slug)}
        >
          <EllipsisVerticalIcon aria-hidden className="size-3.5 text-faint" />
        </IconButton>
      </div>
      {body}
      <ContextMenu
        open={menuOpen}
        onClose={() => onMenu(null)}
        className="top-12 right-2"
      >
        <MenuItem
          tone="danger"
          icon={<LinkSlashIcon aria-hidden className="size-4" />}
          onClick={() => {
            onMenu(null)
            onManaged(connector.slug, true)
          }}
        >
          Disconnect
        </MenuItem>
      </ContextMenu>
    </GlassCard>
  )
}

function EmptyNote({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <GlassCard className="col-span-2 flex flex-col items-center gap-2 px-6 py-8 text-center">
      <IconWell tone="muted">{icon}</IconWell>
      <p className="mt-1 text-[15px] leading-5 font-semibold text-ink">
        {title}
      </p>
      <p className="max-w-[16rem] text-[13px] leading-[18px] text-muted">
        {description}
      </p>
    </GlassCard>
  )
}

export function ToolsView({
  data,
  busy,
  onRefresh,
  onManaged,
  onCustom,
}: {
  data: ConnectorsResponse
  busy: boolean
  onRefresh: () => void
  onManaged: (slug: string, connected: boolean) => void
  onCustom: (connector: CustomConnector | "new") => void
}) {
  const [menu, setMenu] = useState<string | null>(null)
  const canAdd = data.custom.length < data.maxCustom

  return (
    <>
      <FadeIn className="grid grid-cols-2 gap-2.5">
        {!data.managed.enabled ? (
          <EmptyNote
            icon={<LockClosedIcon aria-hidden className="size-[18px]" />}
            title="Managed apps are off"
            description="The bot operator can enable one-click app connections."
          />
        ) : data.managed.connectors.length === 0 ? (
          <EmptyNote
            icon={<GlobeAltIcon aria-hidden className="size-[18px]" />}
            title={
              data.managedUnavailable
                ? "Apps are unavailable"
                : "No apps enabled"
            }
            description="Refresh in a moment or check with the bot operator."
          />
        ) : (
          data.managed.connectors.map((connector) => (
            <ManagedCard
              key={connector.slug}
              connector={connector}
              busy={busy}
              menuOpen={menu === connector.slug}
              onMenu={setMenu}
              onManaged={onManaged}
            />
          ))
        )}
      </FadeIn>

      <FadeIn delay={0.04} className="flex items-center gap-2">
        {data.customEnabled && (
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => onCustom("new")}
            className="pressable flex min-h-11 flex-1 items-center justify-center rounded-[14px] bg-[color-mix(in_oklab,var(--sky)_16%,transparent)] text-[14px] leading-[18px] font-semibold text-sky-deep outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-45"
          >
            Add connector
          </button>
        )}
        <IconButton
          label="Refresh connections"
          disabled={busy}
          onClick={onRefresh}
          className={cn(
            "glass rounded-[14px]",
            !data.customEnabled && "ml-auto"
          )}
        >
          <ArrowPathIcon
            aria-hidden
            className={cn("size-[18px]", busy && "animate-spin")}
          />
        </IconButton>
      </FadeIn>

      {data.customEnabled && data.custom.length > 0 && (
        <FadeIn delay={0.08}>
          <GlassCard className="flex flex-col overflow-hidden rounded-[18px]">
            {data.custom.map((connector, index) => (
              <div key={connector.id}>
                {index > 0 && <Divider />}
                <ListRow
                  className="min-h-14"
                  icon={
                    <IconWell>
                      <LinkIcon aria-hidden className="size-[18px]" />
                    </IconWell>
                  }
                  title={connector.name}
                  subtitle={`${connector.toolCount} tools · ${
                    connector.connected ? "connected" : "unavailable"
                  }`}
                  onClick={() => onCustom(connector)}
                  trailing={
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 text-faint [stroke-width:2]"
                    />
                  }
                />
              </div>
            ))}
          </GlassCard>
        </FadeIn>
      )}

      {data.customEnabled && data.custom.length === 0 && (
        <FadeIn delay={0.08}>
          <p className="px-1 text-center text-[13px] leading-[18px] text-muted">
            Custom HTTPS tool servers appear here. Only add an endpoint whose
            operator you trust.
          </p>
        </FadeIn>
      )}
    </>
  )
}
