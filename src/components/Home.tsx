import React, { useState } from 'react';
import { Network, FileText, Plus, X } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export default function Home({ setView }: { setView: (v: string) => void }) {
  const { works, createWork, setActiveWork } = useAppContext();
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createWork(title, description);
    setShowModal(false);
    setView('graph');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 text-sm font-medium mb-8 border border-indigo-100">
        <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
        AI-Powered Research Platform
      </div>
      <h1 className="text-5xl md:text-7xl font-serif font-medium tracking-tight text-slate-900 mb-6 max-w-4xl leading-tight">
        From Research to <br/> Publication, <span className="text-indigo-600 italic">Automated.</span>
      </h1>
      <p className="text-lg text-slate-600 mb-10 max-w-2xl">
        StreminiHub combines intelligent reference management, visual research mapping, and a multi-agent AI system to generate publication-ready academic papers.
      </p>
      <div className="flex items-center gap-4 mb-12">
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus className="w-5 h-5" />
          New Work
        </button>
        <button onClick={() => setView('graph')} className="flex items-center gap-2 px-6 py-3 bg-white text-slate-700 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 transition-colors shadow-sm">
          <Network className="w-5 h-5" />
          Research Graph
        </button>
      </div>

      {works.length > 0 && (
        <div className="w-full max-w-4xl text-left">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Recent Works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {works.map(work => (
              <div 
                key={work.id} 
                onClick={() => { setActiveWork(work.id); setView('graph'); }}
                className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer"
              >
                <h4 className="font-medium text-slate-900 mb-1 line-clamp-1">{work.title}</h4>
                <p className="text-sm text-slate-500 line-clamp-2">{work.description || 'No description provided.'}</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                  <Network className="w-3 h-3" /> {work.nodes.length} nodes
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Work Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-left">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Create New Research Work</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input 
                  type="text" 
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Enter work title..." 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</label>
                <textarea 
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Enter work description..." 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 h-24 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg font-medium">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">
                  Create Work
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
