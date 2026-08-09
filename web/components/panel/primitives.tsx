"use client"

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from "framer-motion"
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react"
import { cn } from "@/lib/utils"

export function AmbientGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-[-40px] right-[-60px] size-[260px] rounded-full bg-[radial-gradient(circle_farthest-corner_at_50%_50%,color-mix(in_oklab,var(--sky)_35%,transparent)_0%,transparent_70%)] animate-glow",
        className
      )}
    />
  )
}

export function PanelShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative mx-auto min-h-dvh w-full max-w-md overflow-x-hidden",
        className
      )}
    >
      <AmbientGlow />
      {children}
    </div>
  )
}

export function PanelScroll({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <main
      className={cn(
        "relative z-10 flex flex-col gap-4 px-5 pt-[calc(var(--safe-top)+0.75rem)] pb-[calc(var(--safe-bottom)+7.25rem)]",
        className
      )}
    >
      {children}
    </main>
  )
}

export function GlassCard({
  children,
  className,
  strong = false,
  as: Comp = "div",
  type,
  ...props
}: {
  children: ReactNode
  className?: string
  strong?: boolean
  as?: "div" | "section" | "article" | "button"
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = cn(
    strong ? "glass-strong" : "glass",
    "rounded-[22px]",
    Comp === "button" &&
      "pressable w-full text-left outline-none transition-transform focus-visible:ring-2 focus-visible:ring-sky",
    className
  )

  if (Comp === "button") {
    return (
      <button type={type ?? "button"} className={classes} {...props}>
        {children}
      </button>
    )
  }

  return (
    <Comp className={classes}>{children}</Comp>
  )
}

export function IconWell({
  children,
  className,
  tone = "sky",
}: {
  children: ReactNode
  className?: string
  tone?: "sky" | "muted" | "success" | "warning" | "danger" | "violet" | "amber"
}) {
  const tones = {
    sky: "bg-[color-mix(in_oklab,var(--sky)_16%,transparent)] text-sky-deep",
    muted: "bg-[color-mix(in_oklab,var(--muted)_10%,transparent)] text-muted",
    success:
      "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-success",
    warning:
      "bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] text-warning",
    danger: "bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-danger",
    violet: "bg-[#7B6CC41F] text-[#5E54A8] dark:text-[#B7A9F0]",
    amber: "bg-[#C49A4A1F] text-[#9A7428] dark:text-[#E0C08A]",
  } as const

  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[12px]",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function GlassButton({
  children,
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft"
}) {
  const variants = {
    primary:
      "bg-sky text-white shadow-[inset_0_1px_0_color-mix(in_oklab,white_35%,transparent)]",
    secondary: "glass text-ink",
    soft: "bg-[color-mix(in_oklab,var(--sky)_16%,transparent)] text-sky-deep",
    ghost: "bg-transparent text-muted hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
    danger: "bg-transparent text-danger",
  } as const

  return (
    <button
      type="button"
      className={cn(
        "pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-[14px] leading-[18px] font-semibold outline-none transition-[background-color,color,opacity,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ className, label, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "pressable inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] text-muted outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
})

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{
    value: T
    label: string
    icon: ReactNode
  }>
}) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      role="radiogroup"
      className="flex w-full items-center gap-1 rounded-[16px] border border-[var(--segment-border)] bg-[var(--segment-fill)] p-1"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "pressable relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-[11px] leading-[14px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky",
              active ? "font-semibold text-ink" : "font-medium text-muted"
            )}
          >
            {active && (
              <motion.span
                layoutId="voice-segment"
                className="absolute inset-0 rounded-[12px] bg-[var(--segment-active)] shadow-[0_1px_3px_color-mix(in_oklab,var(--ink)_8%,transparent)]"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", duration: 0.3, bounce: 0 }
                }
              />
            )}
            <span className="relative z-10 flex flex-col items-center gap-1">
              <span className={cn(active && "animate-icon-pop")}>
                {option.icon}
              </span>
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ListRow({
  icon,
  title,
  subtitle,
  onClick,
  trailing,
  className,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  onClick?: () => void
  trailing?: ReactNode
  className?: string
}) {
  const Comp = onClick ? "button" : "div"
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors duration-150",
        onClick &&
          "pressable focus-visible:bg-[color-mix(in_oklab,var(--sky)_8%,transparent)]",
        className
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-5 font-medium text-ink">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
    </Comp>
  )
}

export function Divider() {
  return <div className="h-px w-full shrink-0 bg-[var(--divider)]" />
}

export function StatusDot({
  tone = "sky",
}: {
  tone?: "sky" | "success" | "warning" | "danger" | "faint"
}) {
  const tones = {
    sky: "bg-sky",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    faint: "bg-faint",
  } as const
  return (
    <span className={cn("size-2 shrink-0 rounded-full", tones[tone])} />
  )
}

export function Chip({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable inline-flex shrink-0 items-center justify-center rounded-full px-3.5 py-2 text-[12px] leading-4 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky",
        active
          ? "bg-[color-mix(in_oklab,var(--sky)_18%,transparent)] font-semibold text-sky-deep"
          : "glass font-medium text-muted"
      )}
    >
      {children}
    </button>
  )
}

export function ContextMenu({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <>
          <button
            type="button"
            aria-label="Dismiss menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={onClose}
          />
          <motion.div
            role="menu"
            initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: -4, scale: 0.98 }
            }
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className={cn(
              "glass-menu absolute z-50 flex w-[168px] flex-col rounded-[14px] p-1.5",
              className
            )}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export function MenuItem({
  children,
  onClick,
  tone = "default",
  icon,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: "default" | "danger"
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "pressable flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] leading-[18px] font-medium outline-none transition-colors duration-150 focus-visible:bg-[color-mix(in_oklab,var(--sky)_10%,transparent)]",
        tone === "danger" ? "text-danger" : "text-ink"
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function FadeIn({
  children,
  className,
  delay = 0,
  ...props
}: HTMLMotionProps<"div"> & { delay?: number }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.28, delay, ease: [0.2, 0, 0, 1] }
      }
      {...props}
    >
      {children}
    </motion.div>
  )
}

export function SheetHandle() {
  return (
    <div className="flex w-full items-center justify-center pt-1 pb-2">
      <div className="h-[5px] w-10 shrink-0 rounded-full bg-[color-mix(in_oklab,var(--faint)_45%,transparent)]" />
    </div>
  )
}
