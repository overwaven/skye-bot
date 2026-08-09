"use client"

import {
  ChartBarIcon,
  DocumentTextIcon,
  LinkIcon,
  SparklesIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline"
import { motion, useReducedMotion } from "framer-motion"
import type { ComponentType, SVGProps } from "react"

import { cn } from "@/lib/utils"

export type TabKey = "profile" | "connectors" | "memory" | "plus" | "activity"

export type PanelIcon = ComponentType<SVGProps<SVGSVGElement>>

export const NAV: Array<{ value: TabKey; label: string; icon: PanelIcon }> = [
  { value: "profile", label: "Profile", icon: UserCircleIcon },
  { value: "connectors", label: "Tools", icon: LinkIcon },
  { value: "memory", label: "Memory", icon: DocumentTextIcon },
  { value: "plus", label: "Plus", icon: SparklesIcon },
  { value: "activity", label: "Usage", icon: ChartBarIcon },
]

export function PanelTabBar({
  value,
  onChange,
  labels,
}: {
  value: TabKey
  onChange: (value: TabKey) => void
  labels?: Partial<Record<TabKey, string>>
}) {
  const reduceMotion = useReducedMotion()

  return (
    <nav
      aria-label="Panel sections"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md px-4 pb-[calc(var(--safe-bottom)+0.85rem)]"
    >
      <div className="glass-tab flex items-center gap-1 rounded-full px-2 py-1.5">
        {NAV.map((item) => {
          const active = item.value === value
          const label = labels?.[item.value] ?? item.label
          const Icon = item.icon
          return (
            <button
              key={item.value}
              type="button"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(item.value)}
              className="pressable relative flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky"
            >
              {active && (
                <motion.span
                  layoutId="panel-tab-pill"
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--sky)_18%,transparent)]"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", duration: 0.35, bounce: 0 }
                  }
                />
              )}
              <span className="relative z-10 flex flex-col items-center gap-1">
                <Icon
                  aria-hidden
                  className={cn(
                    "size-5",
                    active
                      ? "text-sky-deep [stroke-width:2.15]"
                      : "text-faint [stroke-width:1.85]"
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] leading-3",
                    active
                      ? "font-semibold text-sky-deep"
                      : "font-medium text-faint"
                  )}
                >
                  {label}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
