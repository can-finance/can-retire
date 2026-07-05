import { useEffect, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import type { PageId } from './components/layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';
import { HowItWorks } from './components/pages/HowItWorks';
import { CppCalculator } from './components/pages/CppCalculator';

// Pages are addressable via the URL hash (e.g. /#cpp-calculator) so they can
// be linked to directly. The dashboard's share links use #start=... and must
// keep resolving to the dashboard.
function pageFromHash(): PageId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash === 'cpp-calculator' || hash === 'cpp') return 'cpp-calculator';
  if (hash === 'how-it-works') return 'how-it-works';
  return 'dashboard';
}

function App() {
  const [currentPage, setCurrentPage] = useState<PageId>(pageFromHash);

  const navigate = (page: PageId) => {
    setCurrentPage(page);
    if (page === 'dashboard') {
      window.history.pushState(null, '', window.location.pathname + window.location.search);
    } else {
      window.location.hash = page;
    }
  };

  // Keep the page in sync with back/forward navigation
  useEffect(() => {
    const onHashChange = () => setCurrentPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <AppLayout currentPage={currentPage} onNavigate={navigate}>
      {currentPage === 'dashboard' && <Dashboard />}
      {currentPage === 'cpp-calculator' && <CppCalculator />}
      {currentPage === 'how-it-works' && <HowItWorks />}
    </AppLayout>
  );
}

export default App;
