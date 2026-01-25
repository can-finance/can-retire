import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';
import { HowItWorks } from './components/pages/HowItWorks';

function App() {
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'how-it-works'>('dashboard');

  return (
    <AppLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === 'dashboard' ? <Dashboard /> : <HowItWorks />}
    </AppLayout>
  );
}

export default App;
