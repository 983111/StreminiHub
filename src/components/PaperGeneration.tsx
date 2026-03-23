import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, CircleDashed, FileText, ChevronRight, Download, Loader2, Columns, Play, Settings, Search, Plus } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const TaskItem = ({ title, subtitle, status, count, active }: any) => (
  <div className={`p-3 rounded-lg border ${active ? 'border-indigo-200 bg-indigo-50' : 'border-transparent hover:bg-slate-50'} cursor-pointer transition-colors`}>
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        {status === 'running' && <CircleDashed className="w-4 h-4 text-indigo-500 animate-spin" />}
        {status === 'pending' && <CircleDashed className="w-4 h-4 text-slate-300" />}
        <span className={`font-medium text-sm ${active ? 'text-indigo-900' : 'text-slate-700'}`}>{title}</span>
      </div>
      {count && <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{count}</span>}
    </div>
    <p className="text-xs text-slate-500 pl-6">{subtitle}</p>
  </div>
);

const STAGES = ['idle', 'planning', 'discovering', 'assigning', 'intro', 'body', 'synthesis', 'review', 'completed'];

// ─── Build the final LaTeX that gets sent to texlive.net ──────────────────
// Strategy: use main.tex verbatim IF it already has \documentclass.
// Otherwise wrap the snippet. We never inject extra \documentclass lines.
function buildCompilableLatex(
  activeFile: string,
  generatedFiles: Record<string, string>
): string {
  if (activeFile === 'main.tex') {
    let tex = generatedFiles['main.tex'] || '';

    // Inline every \input{...} reference
    tex = tex.replace(/\\input\{([^}]+)\}/g, (_match, name) => {
      const candidates = [
        `${name}.tex`,
        name,
        `${name.replace(/\.tex$/, '')}.tex`,
      ];
      for (const c of candidates) {
        if (generatedFiles[c]) {
          return `\n% ── inlined ${c} ──\n${generatedFiles[c]}\n`;
        }
      }
      return `\n% ── missing: ${name} ──\n`;
    });

    return tex;
  }

  // For a snippet file, produce a minimal self-contained IEEE doc
  const snippet = generatedFiles[activeFile] || '';

  // Strip any stray preamble the model may have injected into the snippet
  const clean = snippet
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]+\}\s*/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}\s*/g, '')
    .replace(/\\begin\{document\}\s*/g, '')
    .replace(/\\end\{document\}\s*/g, '')
    .trim();

  return `\\documentclass[conference]{IEEEtran}
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{hyperref}
\\hypersetup{hidelinks}
\\title{Preview: ${activeFile.replace(/_/g, '\\_')}}
\\author{AI Research System}
\\begin{document}
\\maketitle
${clean}
\\end{document}`;
}

export default function PaperGeneration() {
  const { works, activeWorkId, generationStatus, agentLogs, references, updateGeneratedFile, addReference } = useAppContext();
  const [activeFile, setActiveFile] = useState('main.tex');
  const [viewMode, setViewMode] = useState<'source' | 'pdf' | 'split'>('split');
  const [showSettings, setShowSettings] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'tasks' | 'references'>('tasks');
  const [selectedCitation, setSelectedCitation] = useState<{ keys: string[], start: number, end: number, originalText: string } | null>(null);
  const [referenceSearch, setReferenceSearch] = useState('');
  const [showAddReference, setShowAddReference] = useState(false);
  const [newReference, setNewReference] = useState({
    title: '', authors: '', year: new Date().getFullYear().toString(), journal: '', doi: ''
  });
  const [iframeKey, setIframeKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const activeWork = works.find(w => w.id === activeWorkId);

  // Auto-switch to main.tex when generation completes
  useEffect(() => {
    if (generationStatus === 'completed') setActiveFile('main.tex');
  }, [generationStatus]);

  const getStatus = (stage: string) => {
    const si = STAGES.indexOf(stage);
    const ci = STAGES.indexOf(generationStatus);
    if (ci > si) return 'completed';
    if (ci === si) return 'running';
    return 'pending';
  };

  const getCitationKey = (ref: any) => {
    const first = ref.authors.split(',')[0].split(' ').pop() || '';
    return `${first.replace(/[^a-zA-Z]/g, '')}${ref.year}`;
  };

  const generatedContent = activeWork?.generatedFiles?.[activeFile] || '';
  const latexToCompile = buildCompilableLatex(activeFile, activeWork?.generatedFiles || {});

  const handleToggleCitation = (refKey: string) => {
    if (!selectedCitation || !activeWorkId) return;
    const newKeys = selectedCitation.keys.includes(refKey)
      ? selectedCitation.keys.filter(k => k !== refKey)
      : [...selectedCitation.keys, refKey];
    const prefixMatch = selectedCitation.originalText.match(/^(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{)/);
    const prefix = prefixMatch ? prefixMatch[1] : '\\cite{';
    const newCiteText = newKeys.length > 0 ? `${prefix}${newKeys.join(', ')}}` : '';
    const before = generatedContent.substring(0, selectedCitation.start);
    const after = generatedContent.substring(selectedCitation.end);
    updateGeneratedFile(activeWorkId, activeFile, before + newCiteText + after);
    if (newKeys.length > 0) {
      setSelectedCitation({ keys: newKeys, start: selectedCitation.start, end: selectedCitation.start + newCiteText.length, originalText: newCiteText });
    } else {
      setSelectedCitation(null);
    }
  };

  const renderSourceCode = (content: string) => {
    const regex = /(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{[^}]+\})/g;
    const parts = content.split(regex);
    let offset = 0;
    return parts.map((part, i) => {
      const start = offset;
      offset += part.length;
      const end = offset;
      if (part.startsWith('\\cite') && part.endsWith('}')) {
        const match = part.match(/\{([^}]+)\}/);
        const keys = match ? match[1].split(',').map(k => k.trim()) : [];
        const isSelected = selectedCitation?.start === start;
        return (
          <span key={`${i}-${start}`}
            className={`cursor-pointer rounded px-1 transition-colors ${isSelected ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}
            onClick={() => { setSelectedCitation({ keys, start, end, originalText: part }); setActiveSidebarTab('references'); }}
          >{part}</span>
        );
      }
      return <span key={`${i}-${start}`}>{part}</span>;
    });
  };

  const handleCompile = () => {
    if (viewMode === 'source') setViewMode('split');
    setIframeKey(k => k + 1);
    setTimeout(() => formRef.current?.submit(), 80);
  };

  const handleDownloadTex = () => {
    setShowDownload(false);
    const blob = new Blob([latexToCompile], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = activeFile;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    setShowDownload(false);
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://texlive.net/cgi-bin/latexcgi';
    form.target = '_blank';
    const fields: Record<string, string> = {
      'filecontents[]': latexToCompile,
      'filename[]': 'document.tex',
      'engine': 'pdflatex',
      'return': 'pdf',
    };
    Object.entries(fields).forEach(([name, value]) => {
      const inp = document.createElement('input');
      inp.type = 'hidden'; inp.name = name; inp.value = value;
      form.appendChild(inp);
    });
    document.body.appendChild(form); form.submit(); document.body.removeChild(form);
  };

  const fileList = [
    { name: 'main.tex', label: 'main.tex', indent: false },
    { name: 'Abstract.tex', label: 'Abstract.tex', indent: true },
    { name: 'Introduction.tex', label: 'Introduction.tex', indent: true },
    { name: 'Methods.tex', label: 'Methods.tex', indent: true },
    { name: 'Results.tex', label: 'Results.tex', indent: true },
    { name: 'Conclusion.tex', label: 'Conclusion.tex', indent: true },
    { name: 'references.bib', label: 'references.bib', indent: false },
  ];

  if (generationStatus === 'idle') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-slate-50">
        <div className="text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-slate-700 mb-2">No Generation in Progress</h2>
          <p className="text-slate-500">Go to the Research Graph and click "Generate Paper" to start.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* ── Sidebar ── */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <div className="flex border-b border-slate-200">
          <button onClick={() => setActiveSidebarTab('tasks')}
            className={`flex-1 py-3 text-sm font-medium ${activeSidebarTab === 'tasks' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
            Tasks
          </button>
          <button onClick={() => setActiveSidebarTab('references')}
            className={`flex-1 py-3 text-sm font-medium ${activeSidebarTab === 'references' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
            References
          </button>
        </div>

        {activeSidebarTab === 'tasks' ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <TaskItem title="Planning" subtitle="Creating paper plan" status={getStatus('planning')} active={generationStatus === 'planning'} />
            <TaskItem title="Reference Discovery" subtitle="Discovering references" status={getStatus('discovering')} active={generationStatus === 'discovering'} />
            <TaskItem title="Reference Assignment" subtitle="Assigning references" status={getStatus('assigning')} active={generationStatus === 'assigning'} />
            <TaskItem title="Introduction" subtitle="Generating introduction" status={getStatus('intro')} active={generationStatus === 'intro'} />
            <TaskItem title="Body Sections" subtitle="Methods & Results" status={getStatus('body')} active={generationStatus === 'body'} />
            <TaskItem title="Synthesis" subtitle="Abstract & Conclusion" status={getStatus('synthesis')} active={generationStatus === 'synthesis'} />
            <TaskItem title="Assembly" subtitle="main.tex + references.bib" status={getStatus('review')} active={generationStatus === 'review'} />
            {generationStatus === 'completed' && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 text-center font-medium">
                ✓ Generation complete — click "Compile PDF"
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {selectedCitation && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-2 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-indigo-900">Editing Citation</h3>
                  <button onClick={() => setSelectedCitation(null)} className="text-indigo-400 hover:text-indigo-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                <p className="text-xs text-indigo-700 mb-3">Toggle references for this citation.</p>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {references.map(ref => {
                    const key = getCitationKey(ref);
                    const isChecked = selectedCitation.keys.includes(key);
                    return (
                      <label key={ref.id} className="flex items-start gap-2 cursor-pointer group">
                        <input type="checkbox" checked={isChecked} onChange={() => handleToggleCitation(key)}
                          className="mt-1 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500" />
                        <div>
                          <div className={`text-xs font-medium ${isChecked ? 'text-indigo-900' : 'text-slate-700'}`}>{ref.title}</div>
                          <div className="text-[10px] text-slate-500">{ref.authors} ({ref.year})</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">All References</h3>
                <button onClick={() => setShowAddReference(true)} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
                <input type="text" placeholder="Search references..." value={referenceSearch}
                  onChange={e => setReferenceSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="space-y-3 mt-3">
                {references.filter(ref =>
                  ref.title.toLowerCase().includes(referenceSearch.toLowerCase()) ||
                  ref.authors.toLowerCase().includes(referenceSearch.toLowerCase())
                ).map(ref => (
                  <div key={ref.id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-indigo-300 cursor-pointer"
                    onClick={() => {
                      const key = getCitationKey(ref);
                      const regex = new RegExp(`\\\\(?:cite|citep|citet)(?:\\[[^\\]]*\\])?\\{[^}]*${key}[^}]*\\}`, 'g');
                      const match = regex.exec(generatedContent);
                      if (match) {
                        setViewMode('source');
                        setSelectedCitation({
                          keys: match[0].match(/\{([^}]+)\}/)?.[1].split(',').map(k => k.trim()) || [key],
                          start: match.index, end: match.index + match[0].length, originalText: match[0]
                        });
                      }
                    }}>
                    <div className="text-xs font-mono text-indigo-500 mb-1">{getCitationKey(ref)}</div>
                    <div className="text-sm font-medium text-slate-800 mb-1 leading-snug">{ref.title}</div>
                    <div className="text-xs text-slate-500">{ref.authors}</div>
                    <div className="text-xs text-slate-400 mt-1">{ref.year}{ref.doi && ` • ${ref.doi}`}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex bg-slate-50">
        {/* File explorer */}
        <div className="w-56 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-2 border-b border-slate-200 font-medium text-sm flex items-center gap-2 text-slate-800">
            <FileText className="w-4 h-4" /> Explorer
          </div>
          <div className="p-2 text-sm space-y-0.5">
            {fileList.map(f => (
              <div key={f.name}
                onClick={() => setActiveFile(f.name)}
                className={`flex items-center gap-2 p-1.5 rounded cursor-pointer ${f.indent ? 'pl-5' : ''} ${activeFile === f.name ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-100'}`}>
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate">{f.label}</span>
                {activeWork?.generatedFiles?.[f.name] ? (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Generated" />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Editor + PDF */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          {/* Toolbar */}
          <div className="h-12 border-b border-slate-200 flex items-center justify-between px-4 bg-slate-50 shrink-0">
            <div className="flex items-center gap-4 text-sm">
              {(['source', 'pdf', 'split'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`font-medium h-12 px-2 capitalize flex items-center gap-1 ${viewMode === m ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900'}`}>
                  {m === 'split' && <Columns className="w-4 h-4" />}{m}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleCompile}
                className="flex items-center gap-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-md transition-colors shadow-sm">
                <Play className="w-4 h-4" /> Compile PDF
              </button>
              <div className="relative">
                <button onClick={() => setShowDownload(!showDownload)}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-md shadow-sm">
                  <Download className="w-4 h-4" /> Download
                </button>
                {showDownload && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-slate-200 rounded-lg shadow-xl p-2 z-50">
                    <button onClick={handleDownloadTex} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md">
                      Download LaTeX (.tex)
                    </button>
                    <button onClick={handleDownloadPdf} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md">
                      Download PDF (via texlive.net)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Source pane */}
            {(viewMode === 'source' || viewMode === 'split') && (
              <div className={`flex flex-col flex-1 overflow-hidden ${viewMode === 'split' ? 'border-r border-slate-200' : ''}`}>
                <div className="flex-1 p-6 overflow-y-auto font-mono text-sm text-slate-800 leading-relaxed bg-[#1e1e2e]">
                  <p className="text-slate-500 mb-4 select-none">% {activeFile}</p>
                  {generatedContent ? (
                    <pre className="whitespace-pre-wrap font-mono text-sm text-emerald-300">
                      {renderSourceCode(generatedContent)}
                    </pre>
                  ) : (
                    <p className="text-slate-500 italic">% {activeFile} has not been generated yet…</p>
                  )}
                </div>
                {generationStatus !== 'completed' && generationStatus !== 'idle' && (
                  <div className="h-48 shrink-0 p-4 bg-slate-900 text-emerald-400 text-xs font-mono overflow-y-auto border-t border-slate-800">
                    <div className="mb-2 text-slate-400 font-semibold border-b border-slate-700 pb-2 flex items-center justify-between">
                      <span>Agent Logs</span>
                      <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Running</span>
                    </div>
                    <div className="space-y-2">
                      {agentLogs.map((log, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="text-slate-500 shrink-0">[{log.time}]</span>
                          <span className="text-indigo-400 shrink-0 w-24">[{log.agent}]</span>
                          <span className="text-emerald-300">{log.message}</span>
                        </div>
                      ))}
                      <div className="flex gap-3 animate-pulse">
                        <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span>
                        <span className="text-indigo-400 w-24">[System]</span>
                        <span className="text-emerald-300">_</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PDF pane */}
            {(viewMode === 'pdf' || viewMode === 'split') && (
              <div className="flex-1 bg-slate-200 overflow-hidden flex flex-col relative">
                {generatedContent ? (
                  <>
                    {/* Hidden form — submitted programmatically by handleCompile */}
                    <form ref={formRef} action="https://texlive.net/cgi-bin/latexcgi"
                      method="POST" target="pdf-preview-frame" className="hidden">
                      <input type="hidden" name="filecontents[]" value={latexToCompile} />
                      <input type="hidden" name="filename[]" value="document.tex" />
                      <input type="hidden" name="engine" value="pdflatex" />
                      <input type="hidden" name="return" value="pdfjs" />
                    </form>
                    <iframe
                      key={iframeKey}
                      name="pdf-preview-frame"
                      className="w-full h-full border-none bg-white"
                      title="PDF Preview"
                    />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-slate-500 bg-white/80 backdrop-blur px-3 py-1 rounded-full border border-slate-200 shadow">
                      Click <strong>Compile PDF</strong> to render
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-slate-500">
                    <div className="text-center">
                      <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-50" />
                      <p>No content to preview</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Reference Modal */}
      {showAddReference && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Add New Reference</h3>
              <button onClick={() => setShowAddReference(false)} className="text-slate-400 hover:text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: 'Title', key: 'title', placeholder: 'Paper title' },
                { label: 'Authors', key: 'authors', placeholder: 'e.g. Smith J., Doe J.' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                  <input type="text" value={(newReference as any)[key]}
                    onChange={e => setNewReference({ ...newReference, [key]: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder={placeholder} />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Year</label>
                  <input type="text" value={newReference.year}
                    onChange={e => setNewReference({ ...newReference, year: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">DOI (Optional)</label>
                  <input type="text" value={newReference.doi}
                    onChange={e => setNewReference({ ...newReference, doi: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="10.xxxx/..." />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowAddReference(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                onClick={() => {
                  if (newReference.title && newReference.authors) {
                    addReference({ title: newReference.title, authors: newReference.authors, year: parseInt(newReference.year) || new Date().getFullYear(), doi: newReference.doi, linked: 0 });
                    setShowAddReference(false);
                    setNewReference({ title: '', authors: '', year: new Date().getFullYear().toString(), journal: '', doi: '' });
                  }
                }}
                disabled={!newReference.title || !newReference.authors}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
                Add Reference
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
