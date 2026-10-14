import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { getDB } from './lib/db'
import { go, useAsync, useOnline, useRoute, safeStorage } from './lib/hooks'
import { Icon, Loading, Notice } from './ui'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { KitScreen } from './screens/Kit'
import { Learn } from './screens/Learn'
import { Flashcards } from './screens/Flashcards'
import { TestMode } from './screens/Test'
import { Progress } from './screens/Progress'
import { Settings, StorageHelp } from './screens/Settings'

const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

function Sidebar({ active, collapsed, onToggle }: { active: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <nav class="sidebar" aria-label="Main">
      <div class="brand">
        <img src="./icon.svg" width="28" height="28" alt="" />
        {!collapsed && <span>Margin</span>}
      </div>
      {NAV.map((n) => (
        <a key={n.id} href={`#/${n.id}`} aria-current={active === n.id ? 'page' : undefined} title={collapsed ? n.label : undefined}>
          <Icon name={n.icon} />
          {!collapsed && <span class="nav-label">{n.label}</span>}
        </a>
      ))}
      <button class="nav-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
        <Icon name={collapsed ? 'expand' : 'collapse'} />
        {!collapsed && <span class="nav-label">Collapse</span>}
      </button>
    </nav>
  )
}

function TopBar({ query }: { query: string }) {
  const [q, setQ] = useState(query)
  return (
    <div class="topbar">
      <form class="search" role="search" onSubmit={(e) => { e.preventDefault(); go(`/library${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) }}>
        <Icon name="search" size={18} />
        <input type="search" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Search your kits" aria-label="Search your kits" />
      </form>
      <a class="btn primary" href="#/library?import=pdf"><Icon name="plus" size={18} /> Import notes</a>
    </div>
  )
}

const STUDY_SCREENS: Record<string, (p: { kitId: string; query: URLSearchParams }) => JSX.Element> = { learn: Learn, flashcards: Flashcards, test: TestMode }

function StorageBlocked() {
  return (
    <div class="stack">
      <Notice tone="danger" title="Margin can’t save anything in this window">
        <p>Your browser is blocking on-device storage, which Margin needs to keep your kits and review history. This usually happens in private or incognito windows, or when site data is blocked.</p>
      </Notice>
      <StorageHelp />
    </div>
  )
}

export function App() {
  const route = useRoute()
  const online = useOnline()
  const storage = useAsync(() => getDB().then(() => true))
  const [collapsed, setCollapsed] = useState(safeStorage.get('margin.sidebar') === 'collapsed')
  const toggle = () => { setCollapsed(!collapsed); safeStorage.set('margin.sidebar', collapsed ? 'open' : 'collapsed') }
  const screen = route.path[0] === 'today' ? 'home' : route.path[0]
  const active = screen === 'kit' ? 'library' : screen

  const Study = STUDY_SCREENS[screen]
  if (Study) {
    return (
      <div class="focus">
        {storage.loading ? <Loading label="Opening your library…" /> : storage.error ? <div class="study-col"><StorageBlocked /></div> : <Study key={route.path[1] + route.query.toString()} kitId={route.path[1]} query={route.query} />}
      </div>
    )
  }

  let body
  if (storage.loading) body = <Loading label="Opening your library…" />
  else if (storage.error && screen !== 'settings') body = <StorageBlocked />
  else if (screen === 'home') body = <Home />
  else if (screen === 'library') body = <Library query={route.query} />
  else if (screen === 'kit') body = <KitScreen id={route.path[1]} query={route.query} />
  else if (screen === 'progress') body = <Progress />
  else if (screen === 'settings') body = <Settings storageBlocked={!!storage.error} />
  else body = <Notice title="This page doesn’t exist" actions={<a class="btn primary" href="#/home">Go to Home</a>}>The link may be from an older version of Margin.</Notice>

  return (
    <div class={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar active={active} collapsed={collapsed} onToggle={toggle} />
      <main id="main">
        <TopBar key={screen + (route.query.get('q') ?? '')} query={route.query.get('q') ?? ''} />
        {!online && (
          <div class="offline-banner" role="status">
            <strong>You’re offline.</strong> Everything still works: your kits, reviews and imports run on this device. Only installing the app and checking for updates need a connection.
          </div>
        )}
        {body}
      </main>
    </div>
  )
}
