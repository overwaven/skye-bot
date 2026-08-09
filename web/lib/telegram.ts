export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  header_bg_color?: string
  accent_text_color?: string
  section_bg_color?: string
  section_header_text_color?: string
  section_separator_color?: string
  subtitle_text_color?: string
  destructive_text_color?: string
  bottom_bar_bg_color?: string
}

interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: { user?: TelegramUser }
  version?: string
  colorScheme?: "light" | "dark"
  themeParams?: TelegramThemeParams
  ready?: () => void
  expand?: () => void
  isVersionAtLeast?: (version: string) => boolean
  onEvent?: (event: string, callback: () => void) => void
  offEvent?: (event: string, callback: () => void) => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  setBottomBarColor?: (color: string) => void
  openLink?: (url: string) => void
  openInvoice?: (url: string, callback: (status: string) => void) => void
  showAlert?: (message: string) => void
  showConfirm?: (
    message: string,
    callback: (confirmed: boolean) => void
  ) => void
  BackButton?: {
    show: () => void
    hide: () => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
  }
  HapticFeedback?: {
    selectionChanged?: () => void
    impactOccurred?: (
      style: "light" | "medium" | "heavy" | "rigid" | "soft"
    ) => void
    notificationOccurred?: (type: "error" | "success" | "warning") => void
  }
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp
    }
    __skyeChromeScheme?: "light" | "dark"
  }
}

const CHROME = {
  light: "#F4F7FA",
  dark: "#0A0F16",
} as const

export function webApp(): TelegramWebApp | undefined {
  if (typeof window === "undefined") return undefined
  return window.Telegram?.WebApp
}

export function currentUser(): TelegramUser | null {
  return webApp()?.initDataUnsafe?.user ?? null
}

export function telegramScheme(): "light" | "dark" {
  const preview = new URLSearchParams(window.location.search).get("theme")
  if (preview === "light" || preview === "dark") return preview
  const scheme = webApp()?.colorScheme
  if (scheme === "light" || scheme === "dark") return scheme
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function supportsChromeColors(app: TelegramWebApp): boolean {
  if (typeof app.isVersionAtLeast === "function") {
    return app.isVersionAtLeast("6.1")
  }
  return false
}

/**
 * Paint Telegram chrome to match Liquid Glass once per scheme.
 * Never call this from themeChanged — writing colors there creates a feedback loop.
 */
export function applyTelegramChrome(scheme: "light" | "dark"): void {
  const app = webApp()
  if (!app || !supportsChromeColors(app)) return
  if (window.__skyeChromeScheme === scheme) return

  window.__skyeChromeScheme = scheme
  const chrome = CHROME[scheme]

  try {
    app.setHeaderColor?.(chrome)
    app.setBackgroundColor?.(chrome)
    app.setBottomBarColor?.(chrome)
  } catch {
    // Older or restricted Telegram clients reject some theme color APIs.
  }
}

/**
 * Resolve the active color scheme for React theming.
 * Optionally paints Telegram chrome on first sync only (`paintChrome`).
 */
export function syncTelegramTheme(
  options: { paintChrome?: boolean } = { paintChrome: true }
): "light" | "dark" {
  const scheme = telegramScheme()
  if (options.paintChrome) applyTelegramChrome(scheme)
  return scheme
}

export function onTelegramThemeChange(callback: () => void): () => void {
  const app = webApp()
  let debounceTimer: number | null = null
  let lastSeen = telegramScheme()

  const handler = () => {
    const next = telegramScheme()
    if (next === lastSeen) return
    if (debounceTimer != null) window.clearTimeout(debounceTimer)
    // Hold the new scheme briefly so transient echoes cannot thrash React state.
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null
      const stable = telegramScheme()
      if (stable === lastSeen) return
      lastSeen = stable
      callback()
    }, 150)
  }

  app?.onEvent?.("themeChanged", handler)
  return () => {
    if (debounceTimer != null) window.clearTimeout(debounceTimer)
    app?.offEvent?.("themeChanged", handler)
  }
}

export function readyTelegram(): void {
  const app = webApp()
  app?.ready?.()
  app?.expand?.()
}

export function bindTelegramBackButton(
  callback: (() => void) | null
): () => void {
  const backButton = webApp()?.BackButton
  if (!backButton || !callback) return () => {}
  backButton.show()
  backButton.onClick(callback)
  return () => {
    backButton.offClick(callback)
    backButton.hide()
  }
}

export const haptic = {
  selection: () => webApp()?.HapticFeedback?.selectionChanged?.(),
  light: () => webApp()?.HapticFeedback?.impactOccurred?.("light"),
  success: () => webApp()?.HapticFeedback?.notificationOccurred?.("success"),
  warning: () => webApp()?.HapticFeedback?.notificationOccurred?.("warning"),
  error: () => webApp()?.HapticFeedback?.notificationOccurred?.("error"),
}

export function confirmTelegram(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const app = webApp()
    if (app?.showConfirm) app.showConfirm(message, resolve)
    else resolve(window.confirm(message))
  })
}

export function alertTelegram(message: string): void {
  const app = webApp()
  if (app?.showAlert) app.showAlert(message)
  else window.alert(message)
}

export function openLink(url: string): void {
  const app = webApp()
  if (app?.openLink) app.openLink(url)
  else window.open(url, "_blank", "noopener,noreferrer")
}

export function openInvoice(url: string): Promise<string> {
  return new Promise((resolve) => {
    const app = webApp()
    if (app?.openInvoice) app.openInvoice(url, resolve)
    else {
      window.open(url, "_blank", "noopener,noreferrer")
      resolve("fallback")
    }
  })
}

export {}
