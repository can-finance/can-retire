import React from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneHowItWorksPage } from './how-it-works-page';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

/**
 * Client entry for /how-it-works/ — a crawlable page with its own URL and meta
 * tags. Mounts the shared StandaloneHowItWorksPage component (also used by the
 * build-time prerender). createRoot().render() replaces the prerendered static
 * markup in #root on mount — we intentionally do NOT hydrate, because the page's
 * collapsible <details> state would make server/client markup fragile to match.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneHowItWorksPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
