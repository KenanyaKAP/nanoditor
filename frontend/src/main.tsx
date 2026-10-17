import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/index.css'

// One-time move of device state saved under the app's old name ("kc." keys).
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('kc.')) continue
    const nk = 'nd.' + k.slice(3)
    if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k)!)
    localStorage.removeItem(k)
  }
} catch {
  // storage blocked; nothing to migrate
}

// Apply the last theme before first paint to avoid a light flash in dark mode.
try {
  const theme = JSON.parse(localStorage.getItem('nd.theme') ?? '"system"')
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
} catch {
  // ignore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
