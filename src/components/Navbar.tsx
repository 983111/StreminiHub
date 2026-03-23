import React from 'react';
import { Beaker, Moon, User } from 'lucide-react';

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
    <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 flex items-center justify-between px-6 h-16">
      <div className="flex items-center gap-2 font-bold text-xl tracking-tight cursor-pointer" onClick={() => setView('home')}>
        <Beaker className="w-6 h-6 text-indigo-600" />
        <span>StreminiHub</span>
      </div>
      <div className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-full border border-slate-200">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              currentView === item.id ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <button className="text-slate-500 hover:text-slate-900"><Moon className="w-5 h-5" /></button>
        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-semibold">
          <User className="w-4 h-4" />
        </div>
      </div>
    </nav>
  );
}
