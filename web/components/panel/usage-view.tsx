"use client"

import { ChevronDownIcon } from "@heroicons/react/24/outline"
import { useState } from "react"

import {
  Divider,
  FadeIn,
  GlassCard,
  StatusDot,
} from "@/components/panel/primitives"
import type { AuditEvent, Monitoring, Stats } from "@/lib/api"
import {
  formatDate,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "@/lib/format"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard className="flex flex-1 flex-col gap-1.5 rounded-[18px] p-4">
      <p className="text-[12px] leading-4 font-medium text-muted">{label}</p>
      <p className="text-[24px] leading-7 font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </p>
    </GlassCard>
  )
}

function eventTone(event: AuditEvent): "success" | "danger" | "warning" {
  const status = event.status ?? (event.error ? "error" : "ok")
  if (event.error) return "danger"
  return ["ok", "success", "completed"].includes(status.toLocaleLowerCase())
    ? "success"
    : "warning"
}

function DetailBlock({ title, body }: { title: string; body: string }) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--divider)]">
      <h4 className="border-b border-[var(--divider)] bg-[color-mix(in_oklab,var(--sky)_8%,transparent)] px-3 py-2 text-[11px] leading-4 font-semibold tracking-[0.06em] text-muted uppercase">
        {title}
      </h4>
      <pre className="panel-no-scrollbar max-h-56 overflow-auto p-3 font-mono text-[11px] leading-4 whitespace-pre-wrap text-ink">
        {body}
      </pre>
    </section>
  )
}

function EventDetails({ event }: { event: AuditEvent }) {
  const fields: Array<[string, string]> = [
    [
      "Chat",
      event.chatId == null
        ? "Not tied to a chat"
        : `${event.chatName ?? "Unknown chat"} · ${event.chatId}`,
    ],
    [
      "User",
      event.firstName || event.username
        ? `${event.firstName ?? ""}${event.username ? ` · @${event.username}` : ""}`
        : String(event.userId),
    ],
    ["Model", event.model ?? "Not applicable"],
    [
      "Request",
      event.command ? `${event.action} · ${event.command}` : event.action,
    ],
    [
      "Chat type",
      event.threadId
        ? `${event.chatType ?? "chat"} · topic ${event.threadId}`
        : (event.chatType ?? "Not recorded"),
    ],
    [
      "Payload",
      event.inputLength == null && event.outputLength == null
        ? "Not recorded"
        : `${formatTokens(event.inputLength)} in · ${formatTokens(event.outputLength)} out`,
    ],
    ["Status", event.status ?? (event.error ? "error" : "ok")],
    [
      "Latency",
      event.latencyMs == null ? "Not recorded" : `${event.latencyMs} ms`,
    ],
    ["When", formatDate(event.ts)],
  ]

  return (
    <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
      <dl className="grid grid-cols-2 gap-2">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="rounded-[12px] bg-[color-mix(in_oklab,var(--ink)_4%,transparent)] p-2.5"
          >
            <dt className="text-[10px] leading-3 font-semibold tracking-[0.06em] text-faint uppercase">
              {label}
            </dt>
            <dd className="mt-1 text-[12px] leading-4 break-words text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {event.inputText != null && (
        <DetailBlock
          title="Full request"
          body={event.inputText || "Empty request body"}
        />
      )}
      {event.outputText != null && (
        <DetailBlock
          title="Full response"
          body={event.outputText || "Empty response body"}
        />
      )}
      {event.toolCalls != null && (
        <DetailBlock
          title="Tool calls"
          body={JSON.stringify(event.toolCalls, null, 2)}
        />
      )}
      {event.details != null && (
        <DetailBlock
          title="Additional details"
          body={JSON.stringify(event.details, null, 2)}
        />
      )}
      {event.error && (
        <section className="rounded-[12px] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] p-3">
          <p className="mb-1 text-[11px] leading-4 font-semibold tracking-[0.06em] text-danger uppercase">
            Error
          </p>
          <p className="text-[12px] leading-4 whitespace-pre-wrap text-danger">
            {event.error}
          </p>
        </section>
      )}
    </div>
  )
}

export function UsageView({
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
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  const pageCount = Math.max(1, Math.ceil(events.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = events.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <>
      <FadeIn className="flex gap-2.5">
        <StatCard label="Requests" value={formatTokens(stats.totalRequests)} />
        <StatCard label="Today" value={formatTokens(stats.requestsToday)} />
      </FadeIn>

      <FadeIn delay={0.04} className="flex gap-2.5">
        <StatCard
          label="Avg. latency"
          value={`${Math.round(stats.avgLatencyMs)} ms`}
        />
        <StatCard
          label="Error rate"
          value={`${(stats.errorRate * 100).toFixed(1)}%`}
        />
      </FadeIn>

      {isAdmin && (
        <FadeIn delay={0.08} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 px-1">
            <StatusDot
              tone={monitoring ? "success" : monitoringFailed ? "danger" : "faint"}
            />
            <p className="text-[13px] leading-[18px] text-muted">
              {monitoring
                ? `Healthy for ${formatDuration(monitoring.uptimeSeconds)}`
                : monitoringFailed
                  ? "Health check failed"
                  : "Checking system health"}
            </p>
          </div>

          {events.length === 0 ? (
            <GlassCard className="rounded-[18px] px-4 py-8 text-center">
              <p className="text-[13px] leading-[18px] text-muted">
                {monitoring ? "No recent events." : "Loading recent activity…"}
              </p>
            </GlassCard>
          ) : (
            <>
              <GlassCard className="flex flex-col overflow-hidden rounded-[18px]">
                {visible.map((event, index) => {
                  const key = `${event.kind}-${event.id}`
                  const open = expanded === key
                  return (
                    <div key={key}>
                      {index > 0 && <Divider />}
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : key)}
                        className="pressable flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:bg-[color-mix(in_oklab,var(--sky)_8%,transparent)]"
                      >
                        <StatusDot tone={eventTone(event)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] leading-[18px] font-medium text-ink capitalize">
                            {event.action.replaceAll("_", " ")}
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">
                            {event.model ?? event.kind}
                            {event.latencyMs != null &&
                              ` · ${event.latencyMs} ms`}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] leading-4 font-medium text-faint">
                          {formatRelativeTime(event.ts)}
                        </span>
                        <ChevronDownIcon
                          aria-hidden
                          className={cn(
                            "size-4 shrink-0 text-faint transition-transform duration-200 [stroke-width:2]",
                            open && "rotate-180"
                          )}
                        />
                      </button>
                      {open && <EventDetails event={event} />}
                    </div>
                  )
                })}
              </GlassCard>

              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-3 px-1">
                  <p className="text-[12px] leading-4 text-muted">
                    Page {current} of {pageCount} · {events.length} events
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={current === 1}
                      onClick={() => setPage(Math.max(1, current - 1))}
                      className="pressable glass min-h-9 rounded-full px-3.5 text-[13px] leading-4 font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={current === pageCount}
                      onClick={() => setPage(Math.min(pageCount, current + 1))}
                      className="pressable glass min-h-9 rounded-full px-3.5 text-[13px] leading-4 font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-sky disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </FadeIn>
      )}
    </>
  )
}
