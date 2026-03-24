import React from 'react';
import { ShieldCheck, Moon, Sun } from 'lucide-react';

interface NavbarProps {
  currentView: string;
  setView: (view: string) => void;
}

export default function Navbar({ currentView, setView }: NavbarProps) {
  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'graph', label: 'Research Graph' },
    { id: 'generation', label: 'Paper Generation' },
    { id: 'references', label: 'References' },
    { id: 'agents', label: 'Agents' },
  ];

  return (
    <nav className="fixed top-0 w-full bg-white/90 backdrop-blur-md border-b border-slate-200 z-50 flex items-center justify-between px-8 h-16">
      <div className="flex items-center gap-2 font-bold text-3xl tracking-tight cursor-pointer font-serif" onClick={() => setView('home')}>
        <span className="text-slate-800">AcademicHub</span>
      </div>
      <div className="flex items-center gap-1">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentView === item.id ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <button className="text-slate-500 hover:text-slate-900"><Sun className="w-4 h-4" /></button>
        <button className="text-slate-500 hover:text-slate-900"><Moon className="w-4 h-4" /></button>
        <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 font-semibold">
          <ShieldCheck className="w-4 h-4" />
        </div>
      </div>
    </nav>
  );
}
