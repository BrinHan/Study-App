// Service worker registration, update checks and the install prompt.
import { registerSW } from 'virtual:pwa-register'

type Listener = () => void
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l())
export const subscribePwa = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l) } }

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export const pwa = {
  updateReady: false,
  installPrompt: null as InstallPrompt | null,
  installed: typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches,
  registration: undefined as ServiceWorkerRegistration | undefined,
}

const updateSW = registerSW({
  onNeedRefresh() { pwa.updateReady = true; emit() },
  onRegisteredSW(_url, reg) { pwa.registration = reg; emit() },
})

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.installPrompt = e as InstallPrompt; emit() })
window.addEventListener('appinstalled', () => { pwa.installed = true; pwa.installPrompt = null; emit() })

export async function install() {
  if (!pwa.installPrompt) return
  await pwa.installPrompt.prompt()
  pwa.installPrompt = null
  emit()
}

/** Returns 'ready' when a new version is waiting, 'latest' if none, 'unavailable' without a service worker. */
export async function checkForUpdates(): Promise<'ready' | 'latest' | 'unavailable'> {
  if (!pwa.registration) return 'unavailable'
  await pwa.registration.update()
  await new Promise((r) => setTimeout(r, 1500))
  return pwa.updateReady ? 'ready' : 'latest'
}

export const applyUpdate = () => updateSW(true)
