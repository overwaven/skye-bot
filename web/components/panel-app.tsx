"use client"

import { ExclamationTriangleIcon } from "@heroicons/react/24/outline"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { ConfigEditorSheet } from "@/components/config-editor"
import { MemoryView } from "@/components/panel/memory-view"
import { PanelTabBar, type TabKey } from "@/components/panel/nav"
import { PlusView } from "@/components/panel/plus-view"
import {
  FadeIn,
  GlassCard,
  PanelScroll,
  PanelShell,
} from "@/components/panel/primitives"
import { ProfileView } from "@/components/panel/profile-view"
import {
  AboutSheet,
  AdminSheet,
  AgentDialog,
  AgentsSheet,
  ConnectorSheet,
} from "@/components/panel/sheets"
import { ToolsView } from "@/components/panel/tools-view"
import { UsageView } from "@/components/panel/usage-view"
import { Toaster } from "@/components/ui/sonner"
import {
  api,
  type AboutInfo,
  type AdminPrincipalsResponse,
  type AgentsResponse,
  type AuditEvent,
  type BillingAccount,
  type ChatConfig,
  type ConnectorsResponse,
  type CustomConnector,
  type Memory,
  type ModelEntry,
  type Monitoring,
  type PersonalAgent,
  type Plans,
  type Stats,
} from "@/lib/api"
import {
  bindTelegramBackButton,
  currentUser,
  haptic,
  onTelegramThemeChange,
  openInvoice,
  openLink,
  readyTelegram,
  syncTelegramTheme,
  webApp,
  confirmTelegram,
} from "@/lib/telegram"
import {
  DEMO_ABOUT,
  DEMO_ACCOUNT,
  DEMO_ADMINS,
  DEMO_AGENTS,
  DEMO_AUDIT,
  DEMO_CHAT,
  DEMO_CONNECTORS,
  DEMO_MEMORIES,
  DEMO_MODELS,
  DEMO_MONITORING,
  DEMO_PLANS,
  DEMO_STATS,
  DEMO_USER,
  isDemoMode,
} from "@/lib/demo"

const EMPTY_CONNECTORS: ConnectorsResponse = {
  managed: { enabled: false, connectors: [] },
  custom: [],
  customEnabled: true,
  maxCustom: 8,
}

function LoadingPanel() {
  return (
    <PanelShell>
      <PanelScroll>
        <div className="flex flex-col items-center gap-8 px-6 py-8">
          <div className="glass size-[92px] animate-pulse rounded-[34px]" />
          <div className="glass h-7 w-44 animate-pulse rounded-full" />
        </div>
        <div className="glass h-[104px] animate-pulse rounded-[22px]" />
        <div className="glass h-[62px] animate-pulse rounded-[16px]" />
        <div className="glass h-[172px] animate-pulse rounded-[22px]" />
      </PanelScroll>
    </PanelShell>
  )
}

export function PanelApp() {
  const { setTheme } = useTheme()
  const [tab, setTab] = useState<TabKey>("profile")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [user, setUser] = useState({ name: "Telegram user", handle: "" })
  const [chatConfig, setChatConfig] = useState<ChatConfig>({
    voiceReplyMode: "text",
  })
  const [connectors, setConnectors] =
    useState<ConnectorsResponse>(EMPTY_CONNECTORS)
  const [memories, setMemories] = useState<Memory[]>([])
  const [stats, setStats] = useState<Stats>({
    totalRequests: 0,
    requestsToday: 0,
    avgLatencyMs: 0,
    errorRate: 0,
  })
  const [account, setAccount] = useState<BillingAccount | null>(null)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [defaultModelId, setDefaultModelId] = useState("")
  const [plans, setPlans] = useState<Plans | null>(null)
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [admins, setAdmins] = useState<AdminPrincipalsResponse | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [monitoring, setMonitoring] = useState<Monitoring | null>(null)
  const [monitoringFailed, setMonitoringFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState("")
  const [aboutOpen, setAboutOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const configCloseRef = useRef<(() => void) | null>(null)
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [agents, setAgents] = useState<AgentsResponse | null>(null)
  const [agentEditing, setAgentEditing] = useState<
    PersonalAgent | "new" | null
  >(null)
  const [connectorEditing, setConnectorEditing] = useState<
    CustomConnector | "new" | null
  >(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      if (isDemoMode()) {
        setUser(DEMO_USER)
        setChatConfig(DEMO_CHAT)
        setConnectors(DEMO_CONNECTORS)
        setMemories(DEMO_MEMORIES)
        setStats(DEMO_STATS)
        setAccount(DEMO_ACCOUNT)
        setModels(DEMO_MODELS)
        setDefaultModelId(DEMO_MODELS[0].id)
        setPlans(DEMO_PLANS)
        setAbout(DEMO_ABOUT)
        setAdmins(DEMO_ADMINS)
        setAgents(DEMO_AGENTS)
        setMonitoring(DEMO_MONITORING)
        setAuditEvents(DEMO_AUDIT)
        return
      }

      const telegramUser = currentUser()
      if (telegramUser) {
        const name = [telegramUser.first_name, telegramUser.last_name]
          .filter(Boolean)
          .join(" ")
        setUser({
          name: name || "Telegram user",
          handle: telegramUser.username
            ? `@${telegramUser.username}`
            : `ID ${telegramUser.id}`,
        })
      }

      const [
        nextChat,
        nextConnectors,
        nextMemories,
        nextStats,
        nextAccount,
        modelData,
        nextPlans,
        nextAbout,
        nextAgents,
      ] = await Promise.all([
        api.getChatConfig(),
        api.getConnectors(),
        api.getMemories(),
        api.getStats(),
        api.getBillingAccount(),
        api.getModels(),
        api.getPlans(),
        api.getAbout(),
        api.getAgents().catch(() => null),
      ])

      setChatConfig(nextChat)
      setConnectors(nextConnectors)
      setMemories(nextMemories)
      setStats(nextStats)
      setAccount(nextAccount)
      setModels(modelData.models)
      setDefaultModelId(modelData.defaultModelId)
      setPlans(nextPlans)
      setAbout(nextAbout)
      if (nextAgents) setAgents(nextAgents)
      if (nextAbout.isAdmin) setAdmins(await api.getAdminPrincipals())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
      readyTelegram()
    }
  }, [])

  useEffect(() => {
    let lastTheme: string | null = null

    const applyTheme = (paintChrome: boolean) => {
      const scheme = syncTelegramTheme({ paintChrome })
      const preview = new URLSearchParams(window.location.search).get("theme")
      const nextTheme =
        webApp() || preview === "light" || preview === "dark"
          ? scheme
          : "system"
      if (nextTheme === lastTheme) return
      lastTheme = nextTheme
      setTheme(nextTheme)
    }

    // Paint Telegram chrome only on the initial sync. themeChanged must only
    // update React theme — rewriting chrome colors causes a light/dark loop.
    applyTheme(true)
    const retries = [100, 300, 700].map((delay) =>
      window.setTimeout(() => applyTheme(true), delay)
    )
    const unsubscribe = onTelegramThemeChange(() => applyTheme(false))
    return () => {
      retries.forEach(window.clearTimeout)
      unsubscribe()
    }
  }, [setTheme])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
      if (new URLSearchParams(window.location.search).has("agents"))
        setAgentsOpen(true)
    })
  }, [load])

  useEffect(() => {
    if (
      tab !== "activity" ||
      !about?.isAdmin ||
      monitoring ||
      monitoringFailed
    )
      return
    Promise.all([api.getMonitoring(), api.getAuditEvents()])
      .then(([health, events]) => {
        setMonitoring(health)
        setAuditEvents(events)
      })
      .catch((error) => {
        setMonitoringFailed(true)
        toast.error(error instanceof Error ? error.message : String(error))
      })
  }, [about?.isAdmin, monitoring, monitoringFailed, tab])

  useEffect(() => {
    if (!agentsOpen || agents) return
    api
      .getAgents()
      .then(setAgents)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
  }, [agents, agentsOpen])

  useEffect(() => {
    const close = agentEditing
      ? () => setAgentEditing(null)
      : connectorEditing
        ? () => setConnectorEditing(null)
        : agentsOpen
          ? () => setAgentsOpen(false)
          : configOpen
            ? () => {
                configCloseRef.current?.()
              }
            : adminOpen
              ? () => setAdminOpen(false)
              : aboutOpen
                ? () => setAboutOpen(false)
                : null
    return bindTelegramBackButton(close)
  }, [
    aboutOpen,
    adminOpen,
    agentEditing,
    agentsOpen,
    configOpen,
    connectorEditing,
  ])

  const setVoiceMode = async (voiceReplyMode: ChatConfig["voiceReplyMode"]) => {
    const previous = chatConfig
    setChatConfig({ voiceReplyMode })
    haptic.selection()
    try {
      setChatConfig(await api.updateChatConfig({ voiceReplyMode }))
    } catch (error) {
      setChatConfig(previous)
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const refreshConnectors = async () => {
    setBusy(true)
    try {
      setConnectors(await api.getConnectors())
      toast.success("Connections refreshed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleManagedConnector = async (slug: string, connected: boolean) => {
    setBusy(true)
    try {
      if (connected) {
        if (!(await confirmTelegram("Disconnect this app from Skye?"))) return
        await api.disconnectManagedConnector(slug)
        setConnectors(await api.getConnectors())
        haptic.success()
      } else {
        const { redirectUrl } = await api.authorizeManagedConnector(slug)
        openLink(redirectUrl)
      }
    } catch (error) {
      haptic.error()
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const deleteMemory = async (memory: Memory) => {
    if (!(await confirmTelegram("Forget this memory?"))) return
    try {
      await api.deleteMemory(memory.chatId, memory.id)
      setMemories((items) => items.filter((item) => item.id !== memory.id))
      haptic.success()
      toast.success("Memory removed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const selectModel = async (modelId: string) => {
    setBusy(true)
    try {
      await api.selectModel(modelId)
      setAccount((current) => (current ? { ...current, modelId } : current))
      haptic.success()
      toast.success("Model updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const openPurchase = async (kind: "subscription" | string) => {
    setBusy(true)
    try {
      const invoice =
        kind === "subscription"
          ? await api.createSubscriptionInvoice()
          : await api.createPackInvoice(kind)
      const status = await openInvoice(invoice.url)
      if (status === "paid") {
        setAccount(await api.getBillingAccount())
        haptic.success()
        toast.success("Payment received")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const cancelSubscription = async () => {
    if (!(await confirmTelegram("Cancel Skye Plus at the end of this period?")))
      return
    try {
      await api.cancelSubscription()
      setAccount(await api.getBillingAccount())
      toast.success("Subscription will end at renewal")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  if (loading) return <LoadingPanel />

  if (loadError) {
    return (
      <PanelShell>
        <main className="relative z-10 flex min-h-dvh items-center px-5">
          <FadeIn className="w-full">
            <GlassCard className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <ExclamationTriangleIcon
                aria-hidden
                className="size-6 text-warning"
              />
              <p className="text-[17px] leading-[22px] font-semibold text-ink">
                Skye couldn&apos;t open the panel
              </p>
              <p className="text-[13px] leading-[18px] text-muted">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="pressable mt-2 inline-flex min-h-11 items-center justify-center rounded-[14px] bg-[color-mix(in_oklab,var(--sky)_16%,transparent)] px-5 text-[14px] leading-[18px] font-semibold text-sky-deep outline-none focus-visible:ring-2 focus-visible:ring-sky"
              >
                Try again
              </button>
            </GlassCard>
          </FadeIn>
        </main>
      </PanelShell>
    )
  }

  const activeModelId = account?.modelId || defaultModelId
  const activeModel = models.find((model) => model.id === activeModelId)

  return (
    <>
      <PanelShell>
        <PanelScroll key={tab} className="animate-panel-in">
          {tab === "profile" && (
            <ProfileView
              user={user}
              chatConfig={chatConfig}
              account={account}
              activeModel={activeModel}
              about={about}
              agents={agents}
              onVoiceChange={(mode) => void setVoiceMode(mode)}
              onAgents={() => setAgentsOpen(true)}
              onAdmin={() => setAdminOpen(true)}
              onConfig={() => setConfigOpen(true)}
              onAbout={() => setAboutOpen(true)}
              onPlus={() => setTab("plus")}
            />
          )}
          {tab === "connectors" && (
            <ToolsView
              data={connectors}
              busy={busy}
              onRefresh={() => void refreshConnectors()}
              onManaged={(slug, connected) =>
                void handleManagedConnector(slug, connected)
              }
              onCustom={setConnectorEditing}
            />
          )}
          {tab === "memory" && (
            <MemoryView
              memories={memories}
              search={search}
              onSearch={setSearch}
              onDelete={(memory) => void deleteMemory(memory)}
              onReload={() => void load()}
            />
          )}
          {tab === "plus" && (
            <PlusView
              account={account}
              models={models}
              activeModelId={activeModelId}
              plans={plans}
              busy={busy}
              onModel={(id) => void selectModel(id)}
              onPurchase={(id) => void openPurchase(id)}
              onCancel={() => void cancelSubscription()}
            />
          )}
          {tab === "activity" && (
            <UsageView
              stats={stats}
              monitoring={monitoring}
              monitoringFailed={monitoringFailed}
              events={auditEvents}
              isAdmin={about?.isAdmin ?? false}
            />
          )}
        </PanelScroll>
      </PanelShell>

      <PanelTabBar
        value={tab}
        labels={plans?.enabled ? undefined : { plus: "Models" }}
        onChange={(next) => {
          haptic.selection()
          setTab(next)
          window.scrollTo({ top: 0, behavior: "smooth" })
        }}
      />

      <AboutSheet about={about} open={aboutOpen} onOpenChange={setAboutOpen} />
      <AdminSheet
        about={about}
        data={admins}
        open={adminOpen}
        onOpenChange={setAdminOpen}
        onChange={setAdmins}
      />
      <ConfigEditorSheet
        open={configOpen}
        onOpenChange={setConfigOpen}
        onRequestCloseRef={configCloseRef}
      />
      <AgentsSheet
        data={agents}
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        onChange={setAgents}
        onEdit={setAgentEditing}
      />
      <AgentDialog
        data={agents}
        editing={agentEditing}
        onEditing={setAgentEditing}
        onChange={setAgents}
      />
      <ConnectorSheet
        editing={connectorEditing}
        onEditing={setConnectorEditing}
        onChange={setConnectors}
      />
      <Toaster position="top-center" />
    </>
  )
}
