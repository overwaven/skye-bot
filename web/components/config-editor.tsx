"use client"

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type UIEvent,
} from "react"
import { toast } from "sonner"
import {
  ArrowDownOnSquareIcon,
  ArrowPathIcon,
  CheckIcon,
  CodeBracketSquareIcon,
  ExclamationTriangleIcon,
  HashtagIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlayIcon,
} from "@heroicons/react/24/outline"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  api,
  type SystemConfigIssue,
  type SystemConfigResponse,
  type SystemConfigSection,
} from "@/lib/api"
import { formatDate, formatTokens } from "@/lib/format"
import { confirmTelegram, haptic } from "@/lib/telegram"
import { cn } from "@/lib/utils"

type ValidationState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid"; warnings: string[] }
  | { status: "invalid"; issues: SystemConfigIssue[]; warnings: string[] }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function lineCount(text: string): number {
  if (!text) return 1
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++
  }
  return count
}

function scrollToLine(
  textarea: HTMLTextAreaElement | null,
  line: number
): void {
  if (!textarea || line < 1) return
  const styles = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  const target = Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 3)
  textarea.scrollTop = target + paddingTop
  // Place caret near the line for keyboard users.
  const lines = textarea.value.split(/\n/)
  let offset = 0
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
    offset += lines[i].length + 1
  }
  textarea.focus()
  textarea.setSelectionRange(offset, offset)
}

export function ConfigEditorSheet({
  open,
  onOpenChange,
  onRequestCloseRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Parent can call this for Telegram Back without discarding dirty state silently. */
  onRequestCloseRef?: MutableRefObject<(() => void) | null>
}) {
  const editorId = useId()
  const searchId = useId()
  const statusId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [meta, setMeta] = useState<SystemConfigResponse | null>(null)
  const [draft, setDraft] = useState("")
  const [etag, setEtag] = useState("")
  const [sections, setSections] = useState<SystemConfigSection[]>([])
  const [validation, setValidation] = useState<ValidationState>({
    status: "idle",
  })
  const [busy, setBusy] = useState<"save" | "restart" | "validate" | null>(null)
  const [sectionQuery, setSectionQuery] = useState("")
  const [confirm, setConfirm] = useState<"save" | "restart" | null>(null)
  const [cursorLine, setCursorLine] = useState(1)

  const dirty = meta !== null && draft !== meta.content
  const lines = useMemo(() => lineCount(draft), [draft])
  const lineNumbers = useMemo(
    () => Array.from({ length: lines }, (_, i) => i + 1),
    [lines]
  )

  const filteredSections = useMemo(() => {
    const q = sectionQuery.trim().toLowerCase()
    if (!q) return sections
    return sections.filter((section) => section.key.toLowerCase().includes(q))
  }, [sectionQuery, sections])

  const applySource = useCallback((source: SystemConfigResponse) => {
    setMeta(source)
    setDraft(source.content)
    setEtag(source.etag)
    setSections(source.sections)
    setValidation({ status: "idle" })
    setLoadError(null)
    setCursorLine(1)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      applySource(await api.getSystemConfig())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [applySource])

  useEffect(() => {
    if (!open) return
    // Defer so opening the sheet does not cascade setState in the same commit.
    const id = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [open, dirty])

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop
    }
  }

  const updateCursorLine = () => {
    const el = textareaRef.current
    if (!el) return
    const upto = el.value.slice(0, el.selectionStart)
    setCursorLine(lineCount(upto))
  }

  const validate = async () => {
    setBusy("validate")
    setValidation({ status: "checking" })
    try {
      const result = await api.validateSystemConfig(draft)
      setSections(result.sections)
      if (result.ok) {
        setValidation({ status: "valid", warnings: result.warnings })
        haptic.success()
        toast.success(
          result.warnings.length
            ? `Valid · ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`
            : "Config is valid"
        )
      } else {
        setValidation({
          status: "invalid",
          issues: result.issues ?? [],
          warnings: result.warnings,
        })
        haptic.error()
        toast.error(
          `${result.issues?.length ?? 0} validation issue${(result.issues?.length ?? 0) === 1 ? "" : "s"}`
        )
      }
    } catch (error) {
      setValidation({ status: "idle" })
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const save = async (restart: boolean) => {
    setBusy(restart ? "restart" : "save")
    try {
      const result = await api.saveSystemConfig(draft, etag, restart)
      applySource(result)
      haptic.success()
      if (restart) {
        toast.success("Saved · restarting Skye")
      } else {
        toast.success(
          result.backupName
            ? `Saved · backup ${result.backupName}`
            : "Config saved"
        )
        if (result.restartRequired) {
          toast.message("Restart Skye for most settings to take effect")
        }
      }
      setConfirm(null)
    } catch (error) {
      haptic.error()
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const requestClose = useCallback(
    async (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true)
        return
      }
      if (dirty) {
        const discard = await confirmTelegram("Discard unsaved config changes?")
        if (!discard) return
      }
      onOpenChange(false)
    },
    [dirty, onOpenChange]
  )

  useEffect(() => {
    if (!onRequestCloseRef) return
    onRequestCloseRef.current = () => {
      void requestClose(false)
    }
    return () => {
      onRequestCloseRef.current = null
    }
  }, [onRequestCloseRef, requestClose])

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault()
      if (!dirty || busy) return
      setConfirm("save")
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      if (!busy) void validate()
    }
  }

  const statusLabel =
    validation.status === "checking"
      ? "Checking configuration…"
      : validation.status === "valid"
        ? "Configuration is valid"
        : validation.status === "invalid"
          ? `${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}`
          : dirty
            ? "Unsaved changes"
            : meta
              ? "Loaded from disk"
              : "Ready"

  return (
    <>
      <Sheet open={open} onOpenChange={(value) => void requestClose(value)}>
        <SheetContent
          side="bottom"
          showCloseButton
          className="mx-auto h-[min(96dvh,56rem)] max-h-[96dvh] max-w-5xl rounded-t-[1.75rem] p-0"
        >
          <SheetHeader className="shrink-0 gap-3 border-b px-5 pt-5 pr-16 pb-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
                  Server
                </p>
                <SheetTitle className="font-heading text-2xl tracking-[-0.02em] text-balance sm:text-3xl">
                  Config editor
                </SheetTitle>
                <SheetDescription className="mt-1.5 max-w-2xl text-pretty">
                  Edit{" "}
                  <span className="font-medium text-foreground">
                    {meta?.name ?? "config.yaml"}
                  </span>{" "}
                  on this host. Changes write to disk; most settings need a
                  restart.
                </SheetDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={cn(
                    "rounded-full tabular-nums",
                    dirty &&
                      "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                  )}
                >
                  {dirty ? "Unsaved" : "In sync"}
                </Badge>
                {validation.status === "valid" && (
                  <Badge className="rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
                    Valid
                  </Badge>
                )}
                {validation.status === "invalid" && (
                  <Badge className="rounded-full bg-destructive/12 text-destructive">
                    Invalid
                  </Badge>
                )}
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {loading && !meta ? (
              <div className="space-y-3 p-5 sm:p-6" aria-busy="true">
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-72 rounded-2xl" />
              </div>
            ) : loadError ? (
              <div className="flex flex-1 flex-col items-start justify-center gap-4 p-6">
                <Alert variant="destructive" className="max-w-lg">
                  <ExclamationTriangleIcon />
                  <AlertTitle>Unable to load config</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
                <Button onClick={() => void load()}>
                  <ArrowPathIcon /> Try again
                </Button>
              </div>
            ) : (
              <>
                <div className="shrink-0 space-y-3 border-b px-5 py-3 sm:px-6">
                  <Alert className="rounded-2xl border-border/70 bg-secondary/55">
                    <LockClosedIcon />
                    <AlertTitle className="text-sm">Owner only · secrets visible</AlertTitle>
                    <AlertDescription className="text-xs leading-5 text-pretty">
                      This file includes the bot token and API keys. A backup is
                      written to{" "}
                      <span className="font-mono">
                        {meta?.name ?? "config.yaml"}.bak
                      </span>{" "}
                      on each save.
                    </AlertDescription>
                  </Alert>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy || loading}
                      onClick={() => void load()}
                    >
                      <ArrowPathIcon className={loading ? "animate-spin" : ""} />
                      Reload
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void validate()}
                    >
                      {busy === "validate" ? (
                        <ArrowPathIcon className="animate-spin" />
                      ) : (
                        <CheckIcon />
                      )}
                      Check
                    </Button>
                    <Button
                      size="sm"
                      disabled={!dirty || !!busy}
                      onClick={() => setConfirm("save")}
                    >
                      {busy === "save" ? (
                        <ArrowPathIcon className="animate-spin" />
                      ) : (
                        <ArrowDownOnSquareIcon />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!dirty || !!busy}
                      onClick={() => setConfirm("restart")}
                    >
                      {busy === "restart" ? (
                        <ArrowPathIcon className="animate-spin" />
                      ) : (
                        <PlayIcon />
                      )}
                      Save & restart
                    </Button>
                    <p
                      id={statusId}
                      role="status"
                      aria-live="polite"
                      className="ms-auto text-xs text-muted-foreground"
                    >
                      {statusLabel}
                    </p>
                  </div>

                  {meta && (
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1.5">
                        <dt className="sr-only">Size</dt>
                        <dd className="tabular-nums">
                          {formatBytes(new TextEncoder().encode(draft).length)} ·{" "}
                          {formatTokens(lines)} lines
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="sr-only">Modified</dt>
                        <dd>
                          Updated{" "}
                          {formatDate(new Date(meta.mtimeMs).toISOString())}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="sr-only">Cursor</dt>
                        <dd className="tabular-nums">Line {cursorLine}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                  <div className="shrink-0 border-b border-border/70 px-3 py-2 lg:hidden">
                    <div className="panel-no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                      {sections.map((section) => (
                        <button
                          key={`chip-${section.key}-${section.line}`}
                          type="button"
                          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-card px-3 text-xs font-medium transition-[background-color,transform] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.96]"
                          onClick={() =>
                            scrollToLine(textareaRef.current, section.line)
                          }
                        >
                          <HashtagIcon className="size-3 text-primary/80" />
                          <span className="font-mono">{section.key}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <aside
                    className="hidden w-[13.5rem] shrink-0 flex-col border-e border-border/70 lg:flex"
                    aria-label="Config sections"
                  >
                    <div className="shrink-0 space-y-2 p-3">
                      <Label htmlFor={searchId} className="sr-only">
                        Filter sections
                      </Label>
                      <div className="relative">
                        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id={searchId}
                          value={sectionQuery}
                          onChange={(event) => setSectionQuery(event.target.value)}
                          placeholder="Find section"
                          className="h-9 ps-8 text-sm"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <nav className="panel-no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                      {filteredSections.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-muted-foreground">
                          No matching sections.
                        </p>
                      ) : (
                        <ul className="space-y-0.5">
                          {filteredSections.map((section) => (
                            <li key={`${section.key}-${section.line}`}>
                              <button
                                type="button"
                                className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-start text-xs transition-[background-color,transform,color] hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.96]"
                                onClick={() =>
                                  scrollToLine(textareaRef.current, section.line)
                                }
                              >
                                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                                  <HashtagIcon className="size-3.5 shrink-0 text-primary/80" />
                                  <span className="truncate font-mono">
                                    {section.key}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {section.line}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </nav>
                  </aside>

                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {(validation.status === "invalid" ||
                      (validation.status === "valid" &&
                        validation.warnings.length > 0)) && (
                      <div className="shrink-0 border-b px-4 py-3 sm:px-5">
                        {validation.status === "invalid" && (
                          <div
                            role="alert"
                            className="space-y-2 rounded-2xl border border-destructive/25 bg-destructive/8 p-3"
                          >
                            <p className="text-sm font-medium text-destructive">
                              Fix these issues before saving
                            </p>
                            <ul className="max-h-28 space-y-1.5 overflow-y-auto text-xs leading-5">
                              {validation.issues.map((issue, index) => (
                                <li
                                  key={`${issue.path}-${index}`}
                                  className="flex gap-2"
                                >
                                  <ExclamationTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                                  <span>
                                    <span className="font-mono font-medium">
                                      {issue.path}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {" "}
                                      — {issue.message}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {validation.status === "valid" &&
                          validation.warnings.length > 0 && (
                            <div
                              role="status"
                              className="space-y-1.5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-950 dark:text-amber-100"
                            >
                              {validation.warnings.map((warning) => (
                                <p key={warning}>{warning}</p>
                              ))}
                            </div>
                          )}
                      </div>
                    )}

                    <div className="min-h-0 flex-1 p-3 sm:p-4">
                      <div
                        className={cn(
                          "flex h-full min-h-[18rem] overflow-hidden rounded-2xl border border-border/80",
                          "bg-[oklch(0.985_0.002_250)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]",
                          "dark:bg-[oklch(0.18_0.01_250)] dark:shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]",
                          validation.status === "invalid" &&
                            "border-destructive/40 ring-1 ring-destructive/20",
                          validation.status === "valid" &&
                            "border-emerald-500/35 ring-1 ring-emerald-500/15"
                        )}
                      >
                        <div
                          ref={gutterRef}
                          aria-hidden="true"
                          className="panel-no-scrollbar w-11 shrink-0 overflow-hidden border-e border-border/60 bg-muted/35 py-3 text-end font-mono text-[12px] leading-[1.55] text-muted-foreground select-none sm:w-12 sm:text-[13px]"
                        >
                          <div className="px-2">
                            {lineNumbers.map((n) => (
                              <div
                                key={n}
                                className={cn(
                                  "tabular-nums",
                                  n === cursorLine &&
                                    "font-semibold text-foreground"
                                )}
                              >
                                {n}
                              </div>
                            ))}
                          </div>
                        </div>
                        <Label htmlFor={editorId} className="sr-only">
                          YAML configuration
                        </Label>
                        <textarea
                          ref={textareaRef}
                          id={editorId}
                          spellCheck={false}
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="off"
                          wrap="off"
                          value={draft}
                          onChange={(event) => {
                            setDraft(event.target.value)
                            setValidation({ status: "idle" })
                          }}
                          onScroll={syncScroll}
                          onKeyUp={updateCursorLine}
                          onClick={updateCursorLine}
                          onSelect={updateCursorLine}
                          onKeyDown={onEditorKeyDown}
                          aria-describedby={statusId}
                          aria-invalid={
                            validation.status === "invalid" ? true : undefined
                          }
                          className={cn(
                            "panel-no-scrollbar min-h-0 min-w-0 flex-1 resize-none bg-transparent px-3 py-3",
                            "font-mono text-base leading-[1.55] text-foreground caret-primary",
                            "outline-none focus-visible:outline-none sm:text-[13px]",
                            "placeholder:text-muted-foreground"
                          )}
                          style={{ tabSize: 2 }}
                          placeholder={"# config.yaml\nbot_token: ..."}
                        />
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <CodeBracketSquareIcon className="size-3.5" />
                        <span>
                          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                            ⌘/Ctrl+S
                          </kbd>{" "}
                          save ·{" "}
                          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                            ⌘/Ctrl+Enter
                          </kbd>{" "}
                          check
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) setConfirm(null)
        }}
      >
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              {confirm === "restart" ? "Save and restart Skye?" : "Save config?"}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {confirm === "restart"
                ? "The process will exit after writing the file so PM2 (or your process manager) can reload with the new settings. Active chats may drop for a few seconds."
                : "Writes config.yaml on this server and keeps a .bak backup. The running process keeps the previous settings until you restart."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={!!busy}
              onClick={() => void save(confirm === "restart")}
            >
              {busy ? (
                <ArrowPathIcon className="animate-spin" />
              ) : confirm === "restart" ? (
                <PlayIcon />
              ) : (
                <ArrowDownOnSquareIcon />
              )}
              {confirm === "restart" ? "Save & restart" : "Save config"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
