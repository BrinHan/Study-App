import type { ComponentChildren } from 'preact'
import { addDays } from './lib/study'

const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5',
  learn: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  cards: 'M7 7h13v12H7zM4 4h13v3M4 4v12h3',
  test: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8.5 14l2.5 2.5 4.5-5',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20',
  plus: 'M12 5v14M5 12h14',
  library: 'M5 4h4v16H5zM11 4h4v16h-4zM17 5l3 .8-3.6 14.5-3-.8',
  progress: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  dot: 'M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  spinner: 'M12 3a9 9 0 1 0 9 9',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  file: 'M14 3H6v18h12V7zM14 3v4h4',
  paste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2',
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ComponentChildren }) {
  return <span class={`badge ${tone}`}>{children}</span>
}

/** Errors and warnings: what happened, what to do, and buttons that do it. */
export function Notice({ tone = 'warning', title, children, actions }: { tone?: Tone; title: string; children?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class={`notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <strong class="notice-title">{title}</strong>
      {children && <div class="notice-body">{children}</div>}
      {actions && <div class="actions">{actions}</div>}
    </div>
  )
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <header class="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <p class="muted">{sub}</p>}
      </div>
      {actions && <div class="actions">{actions}</div>}
    </header>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <div class="loading" role="status">
      <span class="skeleton" style="width:40%" />
      <span class="skeleton" style="width:70%" />
      <span class="skeleton" style="width:55%" />
      <p class="muted small">{label}</p>
    </div>
  )
}

/** Vertical bar chart with value labels. `highlight` marks one bar (e.g. today) in the accent color. */
export function Bars({ values, labels, highlight, format = String }: { values: (number | null)[]; labels: string[]; highlight?: number; format?: (v: number) => string }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0))
  return (
    <div class="bars" role="img" aria-label={labels.map((l, i) => `${l}: ${values[i] === null ? 'no data' : format(values[i]!)}`).join(', ')}>
      {values.map((v, i) => (
        <div class="bar-col" key={i}>
          <span class="bar-value">{v === null ? '–' : format(v)}</span>
          <div class="bar-track">
            <div class={`bar${i === highlight ? ' today' : ''}`} style={{ height: `${v ? Math.max(4, (v / max) * 100) : 0}%` }} />
          </div>
          <span class={`bar-label${i === highlight ? ' strong' : ''}`}>{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
export const fmtDate = (d: Date | number) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
export const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`

/** Highlight `term` (case-insensitive) inside `text`. */
export function Highlight({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>
}

/** Render a cloze prompt with a visible blank. */
export function Prompt({ text }: { text: string }) {
  const parts = text.split('_____')
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <span class="blank" aria-label="blank">&nbsp;</span>}</span>)}</>
}

/** "Today", "Mon", "Tue"... for bar-chart labels `i` days from now. */
export function addDaysLabel(i: number) {
  if (i === 0) return 'Today'
  return addDays(new Date(), i).toLocaleDateString(undefined, { weekday: 'short' })
}
