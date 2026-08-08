"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import {
  IconActivity,
  IconAdjustments,
  IconAlertTriangle,
  IconArrowUpRight,
  IconBolt,
  IconBook2,
  IconBrain,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconCode,
  IconCrown,
  IconDownload,
  IconEdit,
  IconHash,
  IconInfoCircle,
  IconLoader2,
  IconLock,
  IconMessageCircle,
  IconPlus,
  IconPlugConnected,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconServer,
  IconSettings,
  IconShield,
  IconSparkles,
  IconStarFilled,
  IconTrash,
  IconUpload,
  IconUser,
  IconWorld,
} from "@tabler/icons-react"
import { ConfigEditorSheet } from "@/components/config-editor"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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
  type PersonalAgentInput,
  type Plans,
  type Stats,
} from "@/lib/api"
import { formatDate, formatDuration, formatTokens } from "@/lib/format"
import {
  confirmTelegram,
  currentUser,
  haptic,
  onTelegramThemeChange,
  openInvoice,
  openLink,
  readyTelegram,
  syncTelegramTheme,
  bindTelegramBackButton,
  webApp,
} from "@/lib/telegram"
import { cn } from "@/lib/utils"

type TabKey = "profile" | "connectors" | "memory" | "plus" | "activity"
type PanelIcon = ComponentType<{ className?: string }>

const NAV: Array<{ value: TabKey; label: string; icon: PanelIcon }> = [
  { value: "profile", label: "Profile", icon: IconAdjustments },
  { value: "connectors", label: "Tools", icon: IconPlugConnected },
  { value: "memory", label: "Memory", icon: IconBrain },
  { value: "plus", label: "Plus", icon: IconSparkles },
  { value: "activity", label: "Usage", icon: IconActivity },
]

const EMPTY_CONNECTORS: ConnectorsResponse = {
  managed: { enabled: false, connectors: [] },
  custom: [],
  customEnabled: true,
  maxCustom: 8,
}

function ViewHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
          {eyebrow}
        </p>
        <h1 className="font-heading text-4xl leading-[0.95] tracking-[-0.03em] text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </header>
  )
}

function LoadingPanel() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-[calc(var(--safe-top)+2rem)]">
      <div className="mb-10 flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-36" />
        </div>
      </div>
      <Skeleton className="mb-3 h-12 w-52" />
      <Skeleton className="mb-8 h-5 w-72 max-w-full" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-60 rounded-3xl sm:col-span-2" />
      </div>
    </div>
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
      ] = await Promise.all([
        api.getChatConfig(),
        api.getConnectors(),
        api.getMemories(),
        api.getStats(),
        api.getBillingAccount(),
        api.getModels(),
        api.getPlans(),
        api.getAbout(),
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
      if (nextAbout.isAdmin) setAdmins(await api.getAdminPrincipals())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
      readyTelegram()
    }
  }, [])

  useEffect(() => {
    const applyTheme = () => {
      const scheme = syncTelegramTheme()
      const preview = new URLSearchParams(window.location.search).get("theme")
      setTheme(
        webApp() || preview === "light" || preview === "dark"
          ? scheme
          : "system"
      )
    }
    applyTheme()
    const retries = [100, 300, 700].map((delay) =>
      window.setTimeout(applyTheme, delay)
    )
    const unsubscribe = onTelegramThemeChange(applyTheme)
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
      <main className="mx-auto flex min-h-dvh max-w-md items-center px-5">
        <Alert variant="destructive" className="rounded-3xl">
          <IconAlertTriangle />
          <AlertTitle>Skye couldn&apos;t open the panel</AlertTitle>
          <AlertDescription className="space-y-4">
            <p>{loadError}</p>
            <Button variant="outline" onClick={() => void load()}>
              <IconRefresh /> Try again
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  const activeModelId = account?.modelId || defaultModelId
  const activeModel = models.find((model) => model.id === activeModelId)

  return (
    <>
      <div className="panel-grid pointer-events-none fixed inset-x-0 top-0 h-80 opacity-70" />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          haptic.selection()
          setTab(value as TabKey)
          window.scrollTo({ top: 0, behavior: "smooth" })
        }}
        className="relative mx-auto min-h-dvh w-full max-w-5xl"
      >
        <main className="px-4 pt-[calc(var(--safe-top)+1.25rem)] pb-[calc(var(--safe-bottom)+6.5rem)] sm:px-6">
          <TabsContent value="profile" className="animate-panel-in">
            <ProfileView
              user={user}
              chatConfig={chatConfig}
              account={account}
              activeModel={activeModel}
              about={about}
              onVoiceChange={(mode) => void setVoiceMode(mode)}
              onAgents={() => setAgentsOpen(true)}
              onAdmin={() => setAdminOpen(true)}
              onConfig={() => setConfigOpen(true)}
              onAbout={() => setAboutOpen(true)}
              onPlus={() => setTab("plus")}
            />
          </TabsContent>
          <TabsContent value="connectors" className="animate-panel-in">
            <ConnectorsView
              data={connectors}
              busy={busy}
              onRefresh={() => void refreshConnectors()}
              onManaged={(slug, connected) =>
                void handleManagedConnector(slug, connected)
              }
              onCustom={setConnectorEditing}
            />
          </TabsContent>
          <TabsContent value="memory" className="animate-panel-in">
            <MemoryView
              memories={memories}
              search={search}
              onSearch={setSearch}
              onDelete={(memory) => void deleteMemory(memory)}
              onReload={() => void load()}
            />
          </TabsContent>
          <TabsContent value="plus" className="animate-panel-in">
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
          </TabsContent>
          <TabsContent value="activity" className="animate-panel-in">
            <ActivityView
              stats={stats}
              monitoring={monitoring}
              monitoringFailed={monitoringFailed}
              events={auditEvents}
              isAdmin={about?.isAdmin ?? false}
            />
          </TabsContent>
        </main>

        <nav
          aria-label="Panel sections"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl px-3 pb-[calc(var(--safe-bottom)+0.55rem)]"
        >
          <TabsList className="panel-card h-16! w-full rounded-[1.35rem] border border-border/70 bg-card/92 p-1.5 shadow-2xl shadow-foreground/10">
            {NAV.map(({ value, label, icon: NavIcon }) => (
              <TabsTrigger
                key={value}
                value={value}
                aria-label={label}
                className="h-full min-w-0 flex-col gap-1 rounded-[1rem] px-1 text-[10px] font-semibold data-active:bg-primary data-active:text-primary-foreground dark:data-active:border-transparent dark:data-active:bg-primary dark:data-active:text-primary-foreground"
              >
                <NavIcon className="size-[19px]" />
                <span className="truncate">
                  {value === "plus" && !plans?.enabled ? "Models" : label}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
      </Tabs>

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

function ProfileView({
  user,
  chatConfig,
  account,
  activeModel,
  about,
  onVoiceChange,
  onAgents,
  onAdmin,
  onConfig,
  onAbout,
  onPlus,
}: {
  user: { name: string; handle: string }
  chatConfig: ChatConfig
  account: BillingAccount | null
  activeModel?: ModelEntry
  about: AboutInfo | null
  onVoiceChange: (mode: ChatConfig["voiceReplyMode"]) => void
  onAgents: () => void
  onAdmin: () => void
  onConfig: () => void
  onAbout: () => void
  onPlus: () => void
}) {
  return (
    <>
      <ViewHeading
        eyebrow="Your assistant"
        title={`Good to see you, ${user.name.split(" ")[0]}.`}
        description="Shape how Skye thinks, sounds, and works with you."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="panel-card overflow-hidden rounded-3xl md:col-span-2">
          <CardContent className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <Badge variant="outline" className="mb-3 rounded-full">
                <IconSparkles />{" "}
                {account?.hasActiveSub ? "Skye Plus" : "Current model"}
              </Badge>
              <CardTitle className="font-heading text-3xl">
                {activeModel?.name ?? "Default model"}
              </CardTitle>
              <CardDescription className="mt-2">
                {activeModel?.multiplier ?? 1}× token cost
                {account?.hasActiveSub
                  ? ` · ${formatTokens(account.remaining)} tokens left`
                  : ""}
              </CardDescription>
            </div>
            <Button variant="secondary" size="lg" onClick={onPlus}>
              Manage <IconChevronRight />
            </Button>
          </CardContent>
        </Card>

        <Card className="panel-card rounded-3xl md:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-2xl">
              Voice replies
            </CardTitle>
            <CardDescription>
              Choose when Skye answers out loud.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={chatConfig.voiceReplyMode}
              onValueChange={(value) =>
                onVoiceChange(value as ChatConfig["voiceReplyMode"])
              }
            >
              <TabsList className="w-full">
                {(["text", "auto", "always"] as const).map((mode) => (
                  <TabsTrigger key={mode} value={mode} className="capitalize">
                    {mode}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="panel-card rounded-3xl md:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-2xl">Workspace</CardTitle>
            <CardDescription>
              {about?.isOwner
                ? "Agents, access, server config, and project information."
                : "Agents, access, and project information."}
            </CardDescription>
          </CardHeader>
          <CardContent
            className={cn(
              "grid gap-2",
              about?.isOwner
                ? "sm:grid-cols-2"
                : about?.isAdmin
                  ? "sm:grid-cols-3"
                  : "sm:grid-cols-2"
            )}
          >
            <Button
              variant="secondary"
              className="h-12 justify-between"
              onClick={onAgents}
            >
              <span className="flex items-center gap-2">
                <IconRobot /> Personal agents
              </span>
              <IconChevronRight />
            </Button>
            {about?.isAdmin && (
              <Button
                variant="secondary"
                className="h-12 justify-between"
                onClick={onAdmin}
              >
                <span className="flex items-center gap-2">
                  <IconShield /> Administration
                </span>
                <IconChevronRight />
              </Button>
            )}
            {about?.isOwner && (
              <Button
                variant="secondary"
                className="h-12 justify-between"
                onClick={onConfig}
              >
                <span className="flex items-center gap-2">
                  <IconSettings /> Server config
                </span>
                <IconChevronRight />
              </Button>
            )}
            <Button
              variant="secondary"
              className="h-12 justify-between"
              onClick={onAbout}
            >
              <span className="flex items-center gap-2">
                <IconInfoCircle /> About Skye
              </span>
              <IconChevronRight />
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ConnectorsView({
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
  const connected = data.managed.connectors.filter(
    (item) => item.connected
  ).length
  return (
    <>
      <ViewHeading
        eyebrow="Capabilities"
        title="Connected, on your terms."
        description="Give Skye access only to the services you choose. Each connection is private to your Telegram account."
        action={
          <Button
            size="icon"
            variant="outline"
            aria-label="Refresh connections"
            disabled={busy}
            onClick={onRefresh}
          >
            <IconRefresh className={busy ? "animate-spin" : ""} />
          </Button>
        }
      />
      <Card className="panel-card mb-3 rounded-3xl">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <IconBolt className="size-5" />
          </span>
          <div>
            <p className="font-heading text-xl">
              {connected ? `${connected} connected` : "Ready when you are"}
            </p>
            <p className="text-xs text-muted-foreground">
              OAuth credentials never pass through the panel.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        {!data.managed.enabled ? (
          <Alert className="col-span-2 rounded-3xl lg:col-span-3">
            <IconLock />
            <AlertTitle>Managed apps are off</AlertTitle>
            <AlertDescription>
              The bot operator can enable one-click app connections.
            </AlertDescription>
          </Alert>
        ) : data.managed.connectors.length === 0 ? (
          <Alert className="col-span-2 rounded-3xl lg:col-span-3">
            <IconWorld />
            <AlertTitle>
              {data.managedUnavailable
                ? "Apps are temporarily unavailable"
                : "No apps enabled"}
            </AlertTitle>
            <AlertDescription>
              Refresh in a moment or check with the bot operator.
            </AlertDescription>
          </Alert>
        ) : (
          data.managed.connectors.map((connector) => (
            <Card key={connector.slug} className="panel-card rounded-2xl">
              <CardContent className="flex h-full min-h-44 flex-col p-3.5">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
                    <IconWorld className="size-4" />
                    {connector.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={connector.logo}
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                      />
                    )}
                  </span>
                  <Badge
                    variant={connector.connected ? "default" : "secondary"}
                    className="max-w-20 truncate px-2 text-[10px]"
                  >
                    {connector.connected ? "Connected" : "Available"}
                  </Badge>
                </div>
                <h2 className="truncate font-heading text-xl">
                  {connector.name}
                </h2>
                <p className="mt-0.5 mb-3 line-clamp-2 text-[11px] text-muted-foreground">
                  {connector.status ?? "Secure app connection"}
                </p>
                <Button
                  variant={connector.connected ? "outline" : "default"}
                  size="sm"
                  className="mt-auto w-full text-xs"
                  disabled={busy}
                  onClick={() => onManaged(connector.slug, connector.connected)}
                >
                  {connector.connected ? "Disconnect" : "Connect"}
                  {!connector.connected && <IconArrowUpRight />}
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {data.customEnabled && (
        <Card className="panel-card mt-3 rounded-3xl">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="font-heading text-2xl">
                Custom HTTPS
              </CardTitle>
              <CardDescription>
                Advanced, unreviewed tool servers.
              </CardDescription>
            </div>
            <Button
              size="icon"
              disabled={data.custom.length >= data.maxCustom}
              aria-label="Add custom connector"
              onClick={() => onCustom("new")}
            >
              <IconPlus />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.custom.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                No custom connectors. Only add an endpoint whose operator you
                trust.
              </p>
            ) : (
              data.custom.map((connector) => (
                <Button
                  key={connector.id}
                  variant="secondary"
                  className="h-auto w-full justify-between px-4 py-3"
                  onClick={() => onCustom(connector)}
                >
                  <span className="text-left">
                    <span className="block">{connector.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {connector.toolCount} tools ·{" "}
                      {connector.connected ? "connected" : "unavailable"}
                    </span>
                  </span>
                  <IconChevronRight />
                </Button>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}

function MemoryView({
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
  const [activeChat, setActiveChat] = useState("")
  const visibleChat = chatGroups.some(
    (group) => String(group.id) === activeChat
  )
    ? activeChat
    : String(chatGroups[0]?.id ?? "")

  const filtered = memories.filter((memory) =>
    [memory.content, memory.chatName, String(memory.chatId)]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  )

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
      <ViewHeading
        eyebrow="Long-term context"
        title="What Skye remembers."
        description="Review the durable facts and preferences Skye carries between conversations."
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 rounded-full pl-9"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search memory"
          />
        </div>
        <Button variant="outline" size="lg" onClick={() => void exportAll()}>
          <IconDownload /> Export
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => importRef.current?.click()}
        >
          <IconUpload /> Import
        </Button>
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
      </div>

      {memories.length === 0 ? (
        <Card className="panel-card rounded-3xl">
          <CardContent className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
            <IconBook2 className="mb-4 size-8 text-primary" />
            <p className="font-heading text-2xl">A blank page, for now.</p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Ask Skye to remember something in a chat and it will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs
          value={visibleChat}
          onValueChange={setActiveChat}
          className="gap-3"
        >
          <TabsList className="panel-no-scrollbar h-auto! w-full justify-start overflow-x-auto rounded-2xl bg-muted/70 p-1.5">
            {chatGroups.map((group) => (
              <TabsTrigger
                key={group.id}
                value={String(group.id)}
                className="h-auto min-w-36 flex-none items-start rounded-xl px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block max-w-40 truncate text-xs font-semibold text-foreground">
                    {group.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                    {group.id}
                  </span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {chatGroups.map((group) => {
            const visible = filtered.filter(
              (memory) => memory.chatId === group.id
            )
            return (
              <TabsContent
                key={group.id}
                value={String(group.id)}
                className="animate-panel-in"
              >
                <div className="grid grid-cols-2 gap-2.5">
                  {visible.length === 0 ? (
                    <Card className="panel-card col-span-2 rounded-3xl">
                      <CardContent className="flex min-h-40 flex-col items-center justify-center p-6 text-center">
                        <IconSearch className="mb-3 size-6 text-primary" />
                        <p className="font-heading text-xl">No matches</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Try another word in this chat.
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    visible.map((memory) => (
                      <Card
                        key={`${memory.chatId}-${memory.id}`}
                        className="panel-card rounded-2xl"
                      >
                        <CardContent className="flex h-full min-h-40 flex-col p-3.5">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <Badge
                              variant="secondary"
                              className="px-2 text-[10px] capitalize"
                            >
                              {memory.category}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Delete memory"
                              onClick={() => onDelete(memory)}
                            >
                              <IconTrash className="size-4 text-destructive" />
                            </Button>
                          </div>
                          <p className="line-clamp-6 text-[13px] leading-5">
                            {memory.content}
                          </p>
                          <p className="mt-auto pt-4 text-[10px] text-muted-foreground">
                            {formatDate(memory.createdAt)}
                          </p>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </>
  )
}

function PlusView({
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
    ? Math.max(0, Math.min(100, (remaining / quota) * 100))
    : 0
  const activeModel = models.find((model) => model.id === activeModelId)
  const boostStyles = [
    "border-sky-500/25 bg-sky-500/10 hover:bg-sky-500/15",
    "border-violet-500/25 bg-violet-500/10 hover:bg-violet-500/15",
    "border-amber-500/30 bg-amber-500/12 hover:bg-amber-500/20",
    "border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/15",
  ]

  return (
    <>
      <ViewHeading
        eyebrow={plans?.enabled ? "Subscription" : "Intelligence"}
        title={plans?.enabled ? "More room to think." : "Choose your model."}
        description={
          plans?.enabled
            ? "Manage your model, token balance, and Skye Plus plan."
            : "Pick the model that best fits this conversation."
        }
      />

      {plans?.enabled && (
        <Card className="relative mb-3 overflow-hidden rounded-3xl border-primary/20 bg-primary text-primary-foreground">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-white/10 blur-2xl" />
          <CardContent className="relative grid gap-8 p-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Badge className="mb-6 bg-white/15 text-white">
                {account?.hasActiveSub
                  ? account.subStatus === "cancelled"
                    ? "Cancels soon"
                    : "Active plan"
                  : "Skye Plus"}
              </Badge>
              <h2 className="font-heading text-4xl">
                {account?.hasActiveSub
                  ? `${formatTokens(remaining)} tokens left`
                  : plans.title}
              </h2>
              <p className="mt-3 max-w-md text-sm text-primary-foreground/75">
                {account?.hasActiveSub
                  ? account.subStatus === "cancelled"
                    ? `Access ends ${formatDate(account.subExpiresAt * 1000)}`
                    : `Renews ${formatDate(account.subExpiresAt * 1000)}`
                  : `${plans.subscriptionStars} Telegram Stars · ${formatTokens(plans.baseQuotaTokens)} tokens included`}
              </p>
              {account?.hasActiveSub && (
                <Progress
                  value={remainingPercent}
                  className="mt-6 max-w-md [&_[data-slot=progress-indicator]]:bg-white [&_[data-slot=progress-track]]:bg-white/20 [&_[role=presentation]]:hidden"
                />
              )}
            </div>
            {!account?.hasActiveSub && (
              <Button
                size="lg"
                variant="secondary"
                disabled={busy}
                onClick={() => onPurchase("subscription")}
              >
                <IconSparkles /> Subscribe
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="panel-card rounded-3xl">
        <CardHeader>
          <CardTitle className="font-heading text-2xl">
            Conversation model
          </CardTitle>
          <CardDescription>
            Multipliers show relative token usage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={activeModelId}
            onValueChange={(value) => {
              if (value) onModel(value)
            }}
            disabled={busy}
          >
            <SelectTrigger className="h-12 w-full">
              <SelectValue>
                {activeModel
                  ? `${activeModel.name} · ${activeModel.multiplier}×`
                  : "Choose a model"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name} · {model.multiplier}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {plans?.enabled && account?.hasActiveSub && plans.packs.length > 0 && (
        <Card className="panel-card mt-3 rounded-3xl">
          <CardHeader>
            <CardTitle className="font-heading text-2xl">
              Token boosts
            </CardTitle>
            <CardDescription>Extra tokens for a busy month.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {plans.packs.map((pack, index) => (
              <Button
                key={pack.id}
                variant="outline"
                className={`h-auto justify-between border px-4 py-4 ${boostStyles[Math.min(index, boostStyles.length - 1)]}`}
                disabled={busy}
                onClick={() => onPurchase(pack.id)}
              >
                <span className="text-left">
                  <span className="block">{pack.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    +{formatTokens(pack.tokens)} tokens
                  </span>
                </span>
                <Badge className="ml-3 h-9 rounded-xl bg-foreground px-3 text-sm text-background shadow-sm hover:bg-foreground">
                  <IconStarFilled className="size-4 text-amber-400" />
                  {pack.stars}
                </Badge>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {plans?.enabled &&
        account?.hasActiveSub &&
        account.subStatus !== "cancelled" && (
          <Button
            variant="destructive"
            className="mt-5 w-full sm:w-auto"
            onClick={onCancel}
          >
            Cancel subscription
          </Button>
        )}
    </>
  )
}

function ActivityView({
  stats,
  monitoring,
  monitoringFailed,
  events,
  isAdmin,
}: {
  stats: Stats
  monitoring: Monitoring | null
  monitoringFailed: boolean
  events: AuditEvent[]
  isAdmin: boolean
}) {
  const pageSize = 10
  const [auditPage, setAuditPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(events.length / pageSize))
  const page = Math.min(auditPage, pageCount)
  const visibleEvents = events.slice((page - 1) * pageSize, page * pageSize)

  const metrics = [
    {
      label: "All requests",
      value: formatTokens(stats.totalRequests),
      icon: IconActivity,
    },
    {
      label: "Today",
      value: formatTokens(stats.requestsToday),
      icon: IconSparkles,
    },
    {
      label: "Avg. latency",
      value: `${Math.round(stats.avgLatencyMs)} ms`,
      icon: IconServer,
    },
    {
      label: "Error rate",
      value: `${(stats.errorRate * 100).toFixed(1)}%`,
      icon: IconAlertTriangle,
    },
  ]

  return (
    <>
      <ViewHeading
        eyebrow="Pulse"
        title="A clear view of usage."
        description="A compact read on conversations, response time, and reliability."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(({ label, value, icon: MetricIcon }) => (
          <Card key={label} className="panel-card rounded-3xl">
            <CardContent className="p-5">
              <MetricIcon className="mb-8 size-5 text-primary" />
              <p className="font-heading text-3xl leading-none">{value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isAdmin && (
        <Card className="panel-card mt-3 rounded-3xl">
          <CardHeader>
            <CardTitle className="font-heading text-2xl">
              System activity
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                className={
                  monitoring
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : monitoringFailed
                      ? "bg-destructive/12 text-destructive"
                    : ""
                }
                variant={
                  monitoring || monitoringFailed ? "secondary" : "outline"
                }
              >
                {monitoring
                  ? "Healthy"
                  : monitoringFailed
                    ? "Failed"
                    : "Checking"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {monitoring
                  ? `for ${formatDuration(monitoring.uptimeSeconds)}`
                  : monitoringFailed
                    ? "during the latest check"
                  : "operational status"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {monitoring && events.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                No recent events.
              </p>
            ) : events.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
              </div>
            ) : (
              <>
                <div className="max-h-[36rem] overflow-y-auto rounded-2xl border bg-background/45 px-3">
                  <Accordion>
                    {visibleEvents.map((event) => {
                      const status =
                        event.status ?? (event.error ? "error" : "ok")
                      const statusOk = ["ok", "success", "completed"].includes(
                        status.toLocaleLowerCase()
                      )
                      const latencyTone =
                        event.latencyMs == null
                          ? "bg-muted text-muted-foreground"
                          : event.latencyMs < 1_000
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : event.latencyMs < 3_000
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                      const metadata = [
                        {
                          label: "Chat",
                          value:
                            event.chatId == null
                              ? "Not tied to a chat"
                              : `${event.chatName ?? "Unknown chat"} · ${event.chatId}`,
                          icon: IconMessageCircle,
                        },
                        {
                          label: "User",
                          value:
                            event.firstName || event.username
                              ? `${event.firstName ?? ""}${event.username ? ` · @${event.username}` : ""}`
                              : String(event.userId),
                          icon: IconUser,
                        },
                        {
                          label: "Model",
                          value: event.model ?? "Not applicable",
                          icon: IconBrain,
                        },
                        {
                          label: "Request",
                          value: event.command
                            ? `${event.action} · ${event.command}`
                            : event.action,
                          icon: IconCode,
                        },
                        {
                          label: "Chat type",
                          value: event.threadId
                            ? `${event.chatType ?? "chat"} · topic ${event.threadId}`
                            : (event.chatType ?? "Not recorded"),
                          icon: IconHash,
                        },
                        {
                          label: "Payload",
                          value:
                            event.inputLength == null &&
                            event.outputLength == null
                              ? "Not recorded"
                              : `${formatTokens(event.inputLength)} in · ${formatTokens(event.outputLength)} out`,
                          icon: IconBolt,
                        },
                      ]

                      return (
                        <AccordionItem key={`${event.kind}-${event.id}`}>
                          <AccordionTrigger className="gap-2 py-3">
                            <span className="min-w-0 flex-1 text-left">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="capitalize"
                                >
                                  {event.kind}
                                </Badge>
                                <span className="truncate text-xs font-semibold capitalize sm:text-sm">
                                  {event.action.replaceAll("_", " ")}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className={
                                    statusOk
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                      : "bg-destructive/12 text-destructive"
                                  }
                                >
                                  {status}
                                </Badge>
                                {event.latencyMs != null && (
                                  <Badge
                                    variant="secondary"
                                    className={latencyTone}
                                  >
                                    <IconClock />
                                    {event.latencyMs} ms
                                  </Badge>
                                )}
                              </span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-normal text-muted-foreground sm:text-xs">
                                <span className="inline-flex items-center gap-1">
                                  <IconCalendar className="size-3.5" />
                                  {formatDate(event.ts)}
                                </span>
                                {event.chatId != null && (
                                  <span className="inline-flex min-w-0 items-center gap-1">
                                    <IconMessageCircle className="size-3.5" />
                                    <span className="max-w-48 truncate">
                                      {event.chatName ?? "Unknown chat"}
                                    </span>
                                    <span className="font-mono">
                                      {event.chatId}
                                    </span>
                                  </span>
                                )}
                              </span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pb-2">
                              <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                                {metadata.map(
                                  ({ label, value, icon: FieldIcon }) => (
                                    <div
                                      key={label}
                                      className="rounded-xl border bg-card/70 p-3"
                                    >
                                      <dt className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                                        <FieldIcon className="size-3.5" />
                                        {label}
                                      </dt>
                                      <dd className="mt-1.5 break-words text-xs">
                                        {value}
                                      </dd>
                                    </div>
                                  )
                                )}
                              </dl>

                              {event.inputText != null && (
                                <section className="overflow-hidden rounded-xl border">
                                  <h3 className="border-b bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-700 dark:text-sky-300">
                                    Full request
                                  </h3>
                                  <pre className="max-h-64 overflow-auto p-3 font-sans text-xs whitespace-pre-wrap">
                                    {event.inputText || "Empty request body"}
                                  </pre>
                                </section>
                              )}

                              {event.outputText != null && (
                                <section className="overflow-hidden rounded-xl border">
                                  <h3 className="border-b bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
                                    Full response
                                  </h3>
                                  <pre className="max-h-64 overflow-auto p-3 font-sans text-xs whitespace-pre-wrap">
                                    {event.outputText || "Empty response body"}
                                  </pre>
                                </section>
                              )}

                              {event.toolCalls != null && (
                                <AuditData
                                  title="Tool calls"
                                  value={event.toolCalls}
                                />
                              )}
                              {event.details != null && (
                                <AuditData
                                  title="Additional details"
                                  value={event.details}
                                />
                              )}
                              {event.error && (
                                <section className="rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
                                  <p className="mb-1 font-semibold">Error</p>
                                  <p className="whitespace-pre-wrap">
                                    {event.error}
                                  </p>
                                </section>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )
                    })}
                  </Accordion>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {pageCount} · {events.length} events
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() =>
                        setAuditPage((current) => Math.max(1, current - 1))
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === pageCount}
                      onClick={() =>
                        setAuditPage((current) =>
                          Math.min(pageCount, current + 1)
                        )
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}

function AuditData({ title, value }: { title: string; value: unknown }) {
  const entries: Array<[string, unknown]> =
    value != null && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
      : [["value", value]]

  return (
    <section className="overflow-hidden rounded-xl border">
      <h3 className="border-b bg-muted/70 px-3 py-2 text-xs font-semibold">
        {title}
      </h3>
      <dl className="divide-y">
        {entries.map(([key, item]) => (
          <div
            key={key}
            className="grid gap-1 px-3 py-2.5 sm:grid-cols-[9rem_1fr]"
          >
            <dt className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {key.replaceAll("_", " ")}
            </dt>
            <dd className="min-w-0 text-xs">
              <AuditValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function AuditValue({ value }: { value: unknown }) {
  if (value == null || typeof value !== "object") {
    return (
      <span className="inline-flex rounded-md bg-muted/70 px-2 py-1 break-words">
        {String(value ?? "—")}
      </span>
    )
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    return <span className="text-muted-foreground">Empty</span>
  }

  return (
    <dl className="space-y-1.5">
      {entries.map(([key, item]) => (
        <div key={key} className="rounded-lg bg-muted/55 p-2">
          <dt className="mb-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
            {Array.isArray(value)
              ? `Item ${Number(key) + 1}`
              : key.replaceAll("_", " ")}
          </dt>
          <dd>
            <AuditValue value={item} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function BottomSheetFrame({
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
        className="mx-auto max-h-[92dvh] max-w-3xl rounded-t-[2rem]"
      >
        <SheetHeader className="shrink-0 border-b pr-16">
          <SheetTitle className="text-2xl">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="panel-no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
        {footer && (
          <SheetFooter className="shrink-0 border-t">{footer}</SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

function AboutSheet({
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
        <div className="grid w-full gap-2 sm:grid-cols-2">
          <Button onClick={() => openLink(about.sourceUrl)}>
            <IconCode /> View source
          </Button>
          <Button variant="outline" onClick={() => openLink(about.securityUrl)}>
            <IconShield /> Security policy
          </Button>
        </div>
      }
    >
      <div className="mb-6 rounded-3xl bg-primary p-6 text-primary-foreground">
        <IconSparkles className="mb-12 size-7" />
        <p className="font-heading text-4xl">
          Inspect it. Improve it. Share it.
        </p>
        <p className="mt-3 text-sm text-primary-foreground/75">
          Licensed under {about.license}.
        </p>
      </div>
      <div className="space-y-1 rounded-3xl border p-2">
        {[
          ["Version", about.version],
          ["Commit", about.commit?.slice(0, 12) ?? "not supplied"],
          ["Access", about.accessMode],
          ["Maintainer", about.maintainer.name],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 rounded-2xl px-3 py-3 text-sm"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      </div>
      <Button
        variant="secondary"
        className="mt-3 w-full justify-between"
        onClick={() =>
          openLink(
            `https://t.me/${about.maintainer.telegram.replace(/^@/, "")}`
          )
        }
      >
        <span className="flex items-center gap-2">
          <IconMessageCircle /> {about.maintainer.telegram}
        </span>
        <IconArrowUpRight />
      </Button>
    </BottomSheetFrame>
  )
}

function AdminSheet({
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
      description={`${about?.accessMode ?? "Unknown"} access · ${about?.isOwner ? "primary owner" : "administrator"}`}
    >
      <div className="space-y-2">
        {data?.admins.map((admin) => (
          <div
            key={admin.userId}
            className="flex items-center gap-3 rounded-2xl border p-3"
          >
            <Avatar>
              <AvatarFallback>
                {admin.role === "owner" ? <IconCrown /> : <IconUser />}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm">{admin.userId}</p>
              <p className="text-xs text-muted-foreground">
                {admin.role === "owner"
                  ? "Primary owner"
                  : admin.removable
                    ? "Delegated admin"
                    : "Config admin"}
              </p>
            </div>
            {admin.removable && data.canManage && (
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={() => void remove(admin.userId)}
              >
                <IconTrash className="text-destructive" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {data?.canManage && (
        <form
          className="mt-6 space-y-3 rounded-3xl bg-secondary p-4"
          onSubmit={(event) => void add(event)}
        >
          <Label htmlFor="admin-id">Add by Telegram user ID</Label>
          <div className="flex gap-2">
            <Input
              id="admin-id"
              inputMode="numeric"
              value={userId}
              onChange={(event) =>
                setUserId(event.target.value.replace(/\D/g, ""))
              }
              placeholder="123456789"
            />
            <Button type="submit" disabled={busy || !userId}>
              <IconPlus /> Add
            </Button>
          </div>
        </form>
      )}
    </BottomSheetFrame>
  )
}

function AgentsSheet({
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

  return (
    <BottomSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Personal agents"
      description="Build specialists with dedicated instructions and models. Primary applies everywhere; Active overrides this chat."
      footer={
        <Button
          className="w-full"
          disabled={!data || data.agents.length >= data.maxAgents}
          onClick={() => onEdit("new")}
        >
          <IconPlus /> New agent
        </Button>
      }
    >
      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border p-4 text-left"
              onClick={() => void select(null)}
            >
              <Avatar>
                <AvatarFallback>
                  <IconSparkles />
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Default Skye</span>
                <span className="block text-xs text-muted-foreground">
                  Built-in character and current chat model
                </span>
              </span>
              {data.activeAgentId === null && <Badge>Active</Badge>}
            </button>
            {data.agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 rounded-2xl border p-2"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
                  onClick={() => void select(agent.id)}
                >
                  <Avatar>
                    <AvatarFallback>
                      <IconRobot />
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {agent.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {agent.description || "Personal specialist"}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {data.primaryAgentId === agent.id && (
                      <Badge variant="outline">Primary</Badge>
                    )}
                    {data.activeAgentId === agent.id && <Badge>Active</Badge>}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Make ${agent.name} primary`}
                  onClick={() =>
                    void setPrimary(
                      data.primaryAgentId === agent.id ? null : agent.id
                    )
                  }
                >
                  <IconSparkles />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${agent.name}`}
                  onClick={() => onEdit(agent)}
                >
                  <IconEdit />
                </Button>
              </div>
            ))}
            {data.agents.length === 0 && (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Your specialist team is waiting to be built.
              </p>
            )}
          </div>
          {data.templates.length > 0 && data.agents.length < data.maxAgents && (
            <div className="space-y-2">
              <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Start from a template
              </p>
              {data.templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left"
                  onClick={() => void createFromTemplate(template.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{template.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {template.description}
                    </span>
                  </span>
                  <IconPlus className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </BottomSheetFrame>
  )
}

function AgentDialog({
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {editing === "new" ? "New agent" : "Edit agent"}
          </DialogTitle>
          <DialogDescription>
            Give this specialist a clear role and operating brief.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={draft.name}
              maxLength={80}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-description">Short description</Label>
            <Input
              id="agent-description"
              value={draft.description}
              maxLength={180}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              rows={6}
              value={draft.instructions}
              onChange={(event) =>
                setDraft({ ...draft, instructions: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Select
              value={draft.modelId ?? "__current__"}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  modelId: value === "__current__" ? null : value,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {draft.modelId
                    ? (data?.models.find(
                        (model) => model.id === draft.modelId
                      )?.name ?? "Selected model")
                    : "Current chat model"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__current__">Current chat model</SelectItem>
                {data?.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name} · {model.multiplier}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            {editing !== "new" && (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                <IconTrash /> Delete
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                busy || !draft.name.trim() || !draft.instructions.trim()
              }
            >
              {busy ? <IconLoader2 className="animate-spin" /> : <IconCheck />}{" "}
              Save agent
            </Button>
          </DialogFooter>
        </form>
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

function ConnectorSheet({
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
        <div className="grid w-full gap-2 sm:grid-cols-2">
          {connector && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              <IconTrash /> Delete
            </Button>
          )}
          <Button disabled={busy || !valid} onClick={() => void save()}>
            <IconCheck /> Save connector
          </Button>
        </div>
      }
    >
      <Alert className="mb-5 rounded-3xl">
        <IconAlertTriangle />
        <AlertTitle>Custom tools can see their requests</AlertTitle>
        <AlertDescription>
          They may also return untrusted or misleading content.
        </AlertDescription>
      </Alert>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="connector-name">Name</Label>
          <Input
            id="connector-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My connector"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="connector-url">HTTPS endpoint</Label>
          <Input
            id="connector-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://connector.example.com/mcp"
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Secret headers</Label>
            <p className="text-xs text-muted-foreground">
              Leave an existing secret blank to keep it.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
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
          >
            <IconPlus /> Header
          </Button>
        </div>
        {headers.map((header, index) => (
          <div
            key={`${header.inputId}-${index}`}
            className="grid grid-cols-[1fr_1fr_auto] gap-2"
          >
            <Input
              aria-label="Header name"
              value={header.key}
              placeholder="Authorization"
              onChange={(event) =>
                setHeaders((items) =>
                  items.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, key: event.target.value }
                      : item
                  )
                )
              }
            />
            <Input
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
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove header"
              onClick={() =>
                setHeaders((items) =>
                  items.filter((_, itemIndex) => itemIndex !== index)
                )
              }
            >
              <IconTrash />
            </Button>
          </div>
        ))}
        <label className="flex cursor-pointer items-start gap-3 rounded-3xl bg-secondary p-4 text-sm">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
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
