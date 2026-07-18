import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { redirectTargetForHash } from './utils/bootRedirect.ts'
import './index.css'

// Legacy hash routes (/#cpp-calculator, /#how-it-works) now live at their own
// MPA paths. Redirect synchronously, BEFORE React renders, so an old bookmark
// never flashes the dashboard first. `#start=` share links and everything else
// fall through to the dashboard below.
const redirectTarget = redirectTargetForHash(window.location.hash)
if (redirectTarget) {
  window.location.replace(redirectTarget)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
