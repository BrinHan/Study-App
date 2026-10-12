import { useEffect, useState, useCallback } from 'preact/hooks'

const DATA_EVENT = 'margin:data'

/** Tell every mounted screen that stored data changed (import finished, card reviewed, ...). */
export function notifyDataChanged() {
  window.dispatchEvent(new Event(DATA_EVENT))
}

export interface Async<T> { data?: T; error?: unknown; loading: boolean; reload: () => void }

/** Run an async loader, and re-run it whenever stored data changes. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    let alive = true
    load().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    )
    return () => { alive = false }
  }, [...deps, tick])
  useEffect(() => {
    window.addEventListener(DATA_EVENT, reload)
    return () => window.removeEventListener(DATA_EVENT, reload)
  }, [reload])
  return { ...state, reload }
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

// ---- Hash routing: #/today, #/kit/<id>?tab=cards, #/review?kit=<id>&mode=quiz
export interface Route { path: string[]; query: URLSearchParams }

function parse(): Route {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?')
  return { path: p ? p.split('/').map(decodeURIComponent) : ['today'], query: new URLSearchParams(q) }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (to: string) => { location.hash = to }

/** localStorage that never throws (private windows, blocked site data). */
export const safeStorage = {
  get(key: string) { try { return localStorage.getItem(key) } catch { return null } },
  set(key: string, v: string) { try { localStorage.setItem(key, v) } catch { /* not important */ } },
}
