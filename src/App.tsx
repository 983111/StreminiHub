/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Navbar, Home, ResearchGraph, PaperGeneration, References, Agents } from './components';
import { AppProvider } from './context/AppContext';

export default function App() {
  const [currentView, setCurrentView] = useState('home');

  const renderView = () => {
    switch (currentView) {
      case 'home': return <Home setView={setCurrentView} />;
      case 'graph': return <ResearchGraph setView={setCurrentView} />;
      case 'generation': return <PaperGeneration />;
      case 'references': return <References />;
      case 'agents': return <Agents />;
      default: return <Home setView={setCurrentView} />;
    }
  };

  return (
    <AppProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        <Navbar currentView={currentView} setView={setCurrentView} />
        <main className="pt-16">
          {renderView()}
        </main>
      </div>
    </AppProvider>
  );
}
