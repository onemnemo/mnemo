import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from '@/app/SettingsProvider'
import { queryClient } from '@/app/query-client'
import { AppErrorBoundary } from '@/components/error/AppErrorBoundary'
import { installGlobalErrorHandlers } from '@/components/error/global-error-handlers'
import { EventStreamProvider } from '@/events/EventStreamProvider'
import { KeybindProvider } from '@/keybinds/KeybindProvider'
import { applyRenderEngine } from '@/lib/engine'

installGlobalErrorHandlers()

// Stamp the browser engine on <html> before React mounts, so the notes
// stylesheet's content-visibility gate is in place on the first paint.
applyRenderEngine()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <EventStreamProvider>
          <KeybindProvider>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </KeybindProvider>
        </EventStreamProvider>
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
)
