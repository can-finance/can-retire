import React from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneTutorialsPage } from './tutorials-page';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';

/**
 * Client entry for /tutorials/ — a crawlable page with its own URL and meta
 * tags. Mounts the shared StandaloneTutorialsPage component (also used by the
 * build-time prerender). createRoot().render() replaces the prerendered static
 * markup in #root on mount — we intentionally do NOT hydrate, mirroring the
 * other standalone pages.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <StandaloneTutorialsPage />
        </ErrorBoundary>
    </React.StrictMode>,
);
