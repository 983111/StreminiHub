import React from 'react';
import { Bot, CheckCircle2, CircleDashed, Activity } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export default function Agents() {
  const { agentLogs, generationStatus } = useAppContext();
  
  const agents = [
    { name: "Paper Parser", desc: "Research paper understanding and parsing agent", endpoints: 1 },
    { name: "Template Parser", desc: "Parses LaTeX template packages to extract format rules and structure", endpoints: 1 },
    { name: "Commander", desc: "Orchestrates paper writing by assembling context and compiling prompts for content generation", endpoints: 2 },
    { name: "Writer", desc: "Generates LaTeX content with iterative review for academic quality", endpoints: 2 },
    { name: "Typesetter", desc: "Handles resource fetching, template injection, and LaTeX compilation with self-healing", endpoints: 1 },
    { name: "Metadata", desc: "Metadata-based paper generation", endpoints: 4 },
    { name: "Reviewer", desc: "Reviews paper content and provides feedback for improvement", endpoints: 3 },
    { name: "Planner", desc: "Creates detailed paragraph-level paper plans", endpoints: 2 },
  ];

  return (
    <div className="max-w-6xl mx-auto p-8 flex flex-col lg:flex-row gap-8">
      {/* Agents List */}
      <div className="flex-1">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">Agents</h1>
          <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Agent Service is online and running
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent, i) => {
            const isActive = agentLogs.some(log => log.agent === agent.name) && generationStatus !== 'completed' && generationStatus !== 'idle';
            return (
              <div key={i} className={`bg-white border ${isActive ? 'border-indigo-300 shadow-md' : 'border-slate-200 hover:shadow-md'} rounded-xl p-5 transition-all`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-50 text-slate-500'} flex items-center justify-center transition-colors`}>
                      <Bot className="w-5 h-5" />
                    </div>
                    <h3 className="font-semibold text-slate-900">{agent.name}</h3>
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border ${isActive ? 'text-indigo-600 bg-indigo-50 border-indigo-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100'}`}>
                    {isActive ? <CircleDashed className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    {isActive ? 'Working' : 'Online'}
                  </div>
                </div>
                <p className="text-sm text-slate-600 mb-4 h-10 line-clamp-2">{agent.desc}</p>
                <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-3">
                  <span>{agent.endpoints} endpoint{agent.endpoints > 1 ? 's' : ''}</span>
                  <span className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'}`}></span> {isActive ? 'Active now' : 'Standby'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Logs Panel */}
      <div className="w-full lg:w-96 flex flex-col bg-slate-900 rounded-xl shadow-xl overflow-hidden border border-slate-800 h-[calc(100vh-8rem)] sticky top-24">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-2 text-slate-200 font-medium">
            <Activity className="w-4 h-4 text-indigo-400" />
            Live Agent Activity
          </div>
          {generationStatus !== 'idle' && generationStatus !== 'completed' && (
            <span className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Recording
            </span>
          )}
        </div>
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-3">
          {agentLogs.length === 0 ? (
            <div className="text-slate-500 text-center mt-10 italic">
              No recent agent activity. Start a paper generation to see live logs.
            </div>
          ) : (
            agentLogs.map((log, i) => (
              <div key={i} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                <span className="text-slate-500 shrink-0">[{log.time}]</span>
                <span className="text-indigo-400 shrink-0 w-24">[{log.agent}]</span>
                <span className="text-emerald-300">{log.message}</span>
              </div>
            ))
          )}
          {generationStatus !== 'idle' && generationStatus !== 'completed' && (
            <div className="flex gap-3 animate-pulse">
              <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span>
              <span className="text-indigo-400 w-24">[System]</span>
              <span className="text-emerald-300">_</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
