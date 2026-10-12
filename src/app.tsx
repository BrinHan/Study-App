import { useState } from 'preact/hooks'
import { getDB } from './lib/db'
import { useAsync, useOnline, useRoute, safeStorage } from './lib/hooks'
import { loadStudyData, todayQueue } from './lib/study'
import { Icon, Loading, Notice } from './ui'
import { Today } from './screens/Today'
import { Library } from './screens/Library'
import { KitScreen } from './screens/Kit'
import { Review } from './screens/Review'
import { Done } from './screens/Done'
import { Progress } from './screens/Progress'
import { Settings, StorageHelp } from './screens/Settings'

const NAV = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

function Sidebar({ active, collapsed, onToggle, due }: { active: string; collapsed: boolean; onToggle: () => void; due?: number }) {
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
          {n.id === 'today' && !!due && <span class="nav-count" aria-label={`${due} due`}>{due}</span>}
        </a>
      ))}
      <button class="nav-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
        <Icon name={collapsed ? 'expand' : 'collapse'} />
        {!collapsed && <span class="nav-label">Collapse</span>}
      </button>
    </nav>
  )
}

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
  const study = useAsync(() => (storage.data ? loadStudyData() : Promise.resolve(null)), [storage.data])
  const [collapsed, setCollapsed] = useState(safeStorage.get('margin.sidebar') === 'collapsed')
  const toggle = () => { setCollapsed(!collapsed); safeStorage.set('margin.sidebar', collapsed ? 'open' : 'collapsed') }
  const [screen] = route.path
  const active = ({ kit: 'library', review: 'today', done: 'today' } as Record<string, string>)[screen] ?? screen

  let body
  if (storage.loading) body = <Loading label="Opening your library…" />
  else if (storage.error && screen !== 'settings') body = <StorageBlocked />
  else if (screen === 'today') body = <Today />
  else if (screen === 'library') body = <Library query={route.query} />
  else if (screen === 'kit') body = <KitScreen id={route.path[1]} query={route.query} />
  else if (screen === 'review') body = <Review query={route.query} />
  else if (screen === 'done') body = <Done />
  else if (screen === 'progress') body = <Progress />
  else if (screen === 'settings') body = <Settings storageBlocked={!!storage.error} />
  else body = <Notice title="This page doesn’t exist" actions={<a class="btn primary" href="#/today">Go to Today</a>}>The link may be from an older version of Margin.</Notice>

  return (
    <div class={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar active={active} collapsed={collapsed} onToggle={toggle} due={study.data ? todayQueue(study.data).length : undefined} />
      <main id="main">
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
