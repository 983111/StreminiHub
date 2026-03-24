import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, CircleDashed, FileText,
  Download, Columns, Play, Search, Plus, Loader2, AlertTriangle, Copy, Check,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';

// ---------------------------------------------------------------------------
// TaskItem
// ---------------------------------------------------------------------------
const TaskItem = ({ title, subtitle, status, active }: any) => (
  <div className={`p-3 rounded-lg border ${active ? 'border-indigo-200 bg-indigo-50' : 'border-transparent hover:bg-slate-50'} transition-colors`}>
    <div className="flex items-center gap-2 mb-1">
      {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
      {status === 'running'   && <CircleDashed  className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />}
      {status === 'pending'   && <CircleDashed  className="w-4 h-4 text-slate-300 shrink-0" />}
      <span className={`font-medium text-sm ${active ? 'text-indigo-900' : 'text-slate-700'}`}>{title}</span>
    </div>
    <p className="text-xs text-slate-500 pl-6">{subtitle}</p>
  </div>
);

const STAGES = ['idle','planning','discovering','assigning','intro','body','synthesis','review','completed'];
function stageStatus(stage: string, current: string) {
  const si = STAGES.indexOf(stage), ci = STAGES.indexOf(current);
  return ci > si ? 'completed' : ci === si ? 'running' : 'pending';
}

// ---------------------------------------------------------------------------
// Compile via latex.ytotech.com
// ---------------------------------------------------------------------------
async function compileToPdf(latex: string): Promise<Blob> {
  const res = await fetch('https://latex.ytotech.com/builds/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      compiler: 'pdflatex',
      resources: [{ main: true, content: latex }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(txt.slice(0, 2000));
  }
  const blob = await res.blob();
  if (!blob.type.includes('pdf')) {
    const txt = await blob.text();
    throw new Error(txt.slice(0, 2000));
  }
  return blob;
}

// ---------------------------------------------------------------------------
// Wrap a section snippet in a minimal compilable IEEE document for preview
// ---------------------------------------------------------------------------
function wrapSnippet(filename: string, content: string): string {
  const stripped = content
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]+\}\s*/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}\s*/g, '')
    .replace(/\\begin\{document\}\s*/g, '')
    .replace(/\\end\{document\}\s*/g, '')
    .replace(/\\maketitle\s*/g, '')
    .trim();

  return `\\documentclass[conference]{IEEEtran}
\\IEEEoverridecommandlockouts
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{multirow}
\\usepackage{url}
\\begin{document}
\\title{Preview: ${filename.replace(/_/g, '\\_')}}
\\author{Preview}
\\maketitle
${stripped}
\\begin{thebibliography}{00}\\end{thebibliography}
\\end{document}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PaperGeneration() {
  const { works, activeWorkId, generationStatus, agentLogs, references, updateGeneratedFile, addReference } = useAppContext();

  const [activeFile,       setActiveFile]       = useState('main.tex');
  const [viewMode,         setViewMode]          = useState<'source' | 'pdf' | 'split'>('split');
  const [activeSidebarTab, setActiveSidebarTab]  = useState<'tasks' | 'references'>('tasks');
  const [selectedCitation, setSelectedCitation]  = useState<{ keys: string[]; start: number; end: number; originalText: string } | null>(null);
  const [referenceSearch,  setReferenceSearch]   = useState('');
  const [showAddRef,       setShowAddRef]         = useState(false);
  const [newRef,           setNewRef]             = useState({ title: '', authors: '', year: String(new Date().getFullYear()), doi: '' });
  const [showDownload,     setShowDownload]       = useState(false);
  const [copied,           setCopied]             = useState(false);

  const [pdfUrl,       setPdfUrl]       = useState<string | null>(null);
  const [isCompiling,  setIsCompiling]  = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);

  const activeWork = works.find(w => w.id === activeWorkId);
  const generatedFiles = activeWork?.generatedFiles || {};
  const generatedContent = generatedFiles[activeFile] || '';

  useEffect(() => {
    if (generationStatus === 'completed') setActiveFile('main.tex');
  }, [generationStatus]);

  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const getLatexToCompile = (): string => {
    if (activeFile === 'references.bib') return '';
    if (activeFile === 'main.tex') return generatedFiles['main.tex'] || '';
    const content = generatedFiles[activeFile] || '';
    return content ? wrapSnippet(activeFile, content) : '';
  };

  // Citation helpers
  const getCitationKey = (ref: any) => {
    const last = ref.authors.split(',')[0].trim().split(' ').pop() || '';
    return last.replace(/[^a-zA-Z]/g, '') + ref.year;
  };

  const handleToggleCitation = (key: string) => {
    if (!selectedCitation || !activeWorkId) return;
    const newKeys = selectedCitation.keys.includes(key)
      ? selectedCitation.keys.filter(k => k !== key)
      : [...selectedCitation.keys, key];
    const prefix = (selectedCitation.originalText.match(/^(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{)/) || ['', '\\cite{'])[1];
    const newText = newKeys.length ? prefix + newKeys.join(', ') + '}' : '';
    const before = generatedContent.slice(0, selectedCitation.start);
    const after  = generatedContent.slice(selectedCitation.end);
    updateGeneratedFile(activeWorkId, activeFile, before + newText + after);
    newKeys.length
      ? setSelectedCitation({ keys: newKeys, start: selectedCitation.start, end: selectedCitation.start + newText.length, originalText: newText })
      : setSelectedCitation(null);
  };

  const renderSource = (content: string) => {
    const rx = /(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{[^}]+\})/g;
    const parts = content.split(rx);
    let offset = 0;
    return parts.map((part, i) => {
      const start = offset; offset += part.length; const end = offset;
      if (/^\\cite/.test(part) && part.endsWith('}')) {
        const keys = (part.match(/\{([^}]+)\}/) || ['', ''])[1].split(',').map(k => k.trim());
        const isSel = selectedCitation?.start === start;
        return (
          <span key={i + '-' + start}
            className={'cursor-pointer rounded px-0.5 ' + (isSel ? 'bg-indigo-500 text-white' : 'bg-indigo-800/50 text-indigo-200 hover:bg-indigo-700/60')}
            onClick={() => { setSelectedCitation({ keys, start, end, originalText: part }); setActiveSidebarTab('references'); }}>
            {part}
          </span>
        );
      }
      return <span key={i + '-' + start}>{part}</span>;
    });
  };

  const handleCompile = async () => {
    const latex = getLatexToCompile();
    if (!latex) {
      setCompileError(activeFile === 'references.bib'
        ? '.bib files cannot be compiled. Select main.tex instead.'
        : 'No content to compile. Generate the paper first.');
      return;
    }
    if (viewMode === 'source') setViewMode('split');
    setIsCompiling(true);
    setCompileError(null);
    try {
      const blob = await compileToPdf(latex);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      const url = URL.createObjectURL(blob);
      blobRef.current = url;
      setPdfUrl(url);
    } catch (e: any) {
      setCompileError(e.message || 'Compile failed');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleCopy = async () => {
    const latex = getLatexToCompile() || generatedContent;
    if (!latex) return;
    await navigator.clipboard.writeText(latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTex = () => {
    setShowDownload(false);
    const latex = getLatexToCompile() || generatedContent;
    if (!latex) { alert('Nothing to download.'); return; }
    const url = URL.createObjectURL(new Blob([latex], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href: url, download: activeFile === 'main.tex' ? 'paper.tex' : activeFile }).click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadBib = () => {
    setShowDownload(false);
    const bib = generatedFiles['references.bib'] || '';
    if (!bib) { alert('references.bib not ready yet.'); return; }
    const url = URL.createObjectURL(new Blob([bib], { type: 'text/plain' }));
    Object.assign(document.createElement('a'), { href: url, download: 'references.bib' }).click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async () => {
    setShowDownload(false);
    const latex = getLatexToCompile();
    if (!latex) { alert('No compilable content.'); return; }
    try {
      const blob = await compileToPdf(latex);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: 'paper.pdf' }).click();
      URL.revokeObjectURL(url);
    } catch (e: any) { alert('PDF compile failed: ' + e.message); }
  };

  const fileList = [
    { name: 'main.tex',         indent: false },
    { name: 'Abstract.tex',     indent: true  },
    { name: 'Introduction.tex', indent: true  },
    { name: 'Methods.tex',      indent: true  },
    { name: 'Results.tex',      indent: true  },
    { name: 'Conclusion.tex',   indent: true  },
    { name: 'references.bib',   indent: false },
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

  const latexToCompile = getLatexToCompile();
  const canCompile = !!latexToCompile && activeFile !== 'references.bib';

  return (
    <div className="flex h-[calc(100vh-4rem)]">

      {/* LEFT SIDEBAR */}
      <div className="w-72 border-r border-slate-200 bg-white flex flex-col shrink-0">
        <div className="flex border-b border-slate-200">
          {(['tasks', 'references'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveSidebarTab(tab)}
              className={'flex-1 py-3 text-sm font-medium capitalize ' + (activeSidebarTab === tab ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700')}>
              {tab}
            </button>
          ))}
        </div>

        {activeSidebarTab === 'tasks' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <TaskItem title="Planning"              subtitle="Creating paper plan"         status={stageStatus('planning',    generationStatus)} active={generationStatus === 'planning'} />
            <TaskItem title="Ref Discovery"         subtitle="Loading reference library"   status={stageStatus('discovering', generationStatus)} active={generationStatus === 'discovering'} />
            <TaskItem title="Ref Assignment"        subtitle="Assigning refs to sections"  status={stageStatus('assigning',   generationStatus)} active={generationStatus === 'assigning'} />
            <TaskItem title="Introduction"          subtitle="With citations and structure" status={stageStatus('intro',       generationStatus)} active={generationStatus === 'intro'} />
            <TaskItem title="Methods + Results"     subtitle="With tables and analysis"    status={stageStatus('body',        generationStatus)} active={generationStatus === 'body'} />
            <TaskItem title="Abstract + Conclusion" subtitle="Synthesis pass"              status={stageStatus('synthesis',   generationStatus)} active={generationStatus === 'synthesis'} />
            <TaskItem title="Assembly"              subtitle="Building main.tex + .bib"    status={stageStatus('review',      generationStatus)} active={generationStatus === 'review'} />
            {generationStatus === 'completed' && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 font-medium text-center">
                ✓ All files ready
              </div>
            )}
          </div>
        )}

        {activeSidebarTab === 'references' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {selectedCitation && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-indigo-900">Edit Citation</span>
                  <button onClick={() => setSelectedCitation(null)} className="text-indigo-400 hover:text-indigo-600 text-lg leading-none">&times;</button>
                </div>
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {references.map(ref => {
                    const k = getCitationKey(ref);
                    return (
                      <label key={ref.id} className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={selectedCitation.keys.includes(k)} onChange={() => handleToggleCitation(k)} className="mt-0.5 rounded text-indigo-600" />
                        <div>
                          <div className="text-xs font-medium text-slate-700 leading-tight">{ref.title}</div>
                          <div className="text-[10px] text-slate-500">{ref.authors} ({ref.year})</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">References ({references.length})</span>
              <button onClick={() => setShowAddRef(true)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
                <Plus className="w-3 h-3" />Add
              </button>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input type="text" placeholder="Search..." value={referenceSearch} onChange={e => setReferenceSearch(e.target.value)}
                className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            {references
              .filter(r => r.title.toLowerCase().includes(referenceSearch.toLowerCase()) || r.authors.toLowerCase().includes(referenceSearch.toLowerCase()))
              .map(ref => (
                <div key={ref.id} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                  <div className="font-mono text-indigo-500 mb-0.5">{getCitationKey(ref)}</div>
                  <div className="font-medium text-slate-800 leading-snug">{ref.title}</div>
                  <div className="text-slate-500 mt-0.5">{ref.authors} · {ref.year}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 flex min-w-0">

        {/* File explorer */}
        <div className="w-48 border-r border-slate-200 bg-white flex flex-col shrink-0">
          <div className="p-2 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Files
          </div>
          <div className="p-1.5 space-y-0.5 flex-1">
            {fileList.map(f => {
              const hasContent = !!generatedFiles[f.name];
              return (
                <div key={f.name} onClick={() => setActiveFile(f.name)}
                  className={'flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ' +
                    (f.indent ? 'pl-5 ' : '') +
                    (activeFile === f.name ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-slate-600 hover:bg-slate-50')}>
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  {hasContent && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                </div>
              );
            })}
          </div>
          {generationStatus === 'completed' && (
            <div className="p-2 border-t border-slate-100 text-xs text-slate-400">
              {fileList.filter(f => generatedFiles[f.name]).length}/{fileList.length} files ready
            </div>
          )}
        </div>

        {/* Editor + PDF */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Toolbar */}
          <div className="h-11 border-b border-slate-200 flex items-center justify-between px-3 bg-slate-50 shrink-0">
            <div className="flex items-center text-sm gap-1">
              {(['source', 'split', 'pdf'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={'px-3 h-11 font-medium capitalize flex items-center gap-1 ' + (viewMode === m ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900')}>
                  {m === 'split' && <Columns className="w-3.5 h-3.5" />}
                  {m}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {/* Copy to clipboard */}
              <button onClick={handleCopy} disabled={!generatedContent}
                className="flex items-center gap-1.5 text-sm text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 disabled:opacity-40 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>

              {/* Compile */}
              <button onClick={handleCompile} disabled={isCompiling || !canCompile}
                className="flex items-center gap-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-3 py-1.5 rounded-md transition-colors">
                {isCompiling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {isCompiling ? 'Compiling...' : 'Compile PDF'}
              </button>

              {/* Download */}
              <div className="relative">
                <button onClick={() => setShowDownload(!showDownload)}
                  className="flex items-center gap-1.5 text-sm text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                {showDownload && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 z-50">
                    <button onClick={handleDownloadTex} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md">
                      LaTeX (.tex)
                    </button>
                    <button onClick={handleDownloadBib} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md">
                      Bibliography (.bib)
                    </button>
                    <button onClick={handleDownloadPdf} disabled={!canCompile} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-40">
                      Compiled PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Panes */}
          <div className="flex-1 flex min-h-0">

            {/* Source pane */}
            {(viewMode === 'source' || viewMode === 'split') && (
              <div className={'flex flex-col min-h-0 border-r border-slate-200 ' + (viewMode === 'split' ? 'w-1/2' : 'flex-1')}>
                <div className="flex-1 overflow-y-auto p-4 bg-[#1a1b2e] font-mono text-xs leading-relaxed text-slate-300">
                  <div className="text-slate-600 mb-3 select-none">% {activeFile}</div>
                  {generatedContent
                    ? <pre className="whitespace-pre-wrap break-words">{renderSource(generatedContent)}</pre>
                    : <span className="text-slate-600 italic">
                        {generationStatus !== 'idle' && generationStatus !== 'completed'
                          ? '% Generating — please wait...'
                          : '% File not yet generated. Run paper generation first.'}
                      </span>
                  }
                </div>
                {generationStatus !== 'completed' && generationStatus !== 'idle' && (
                  <div className="h-40 shrink-0 p-3 bg-slate-950 font-mono text-xs overflow-y-auto border-t border-slate-800">
                    <div className="text-slate-500 mb-2 flex items-center gap-2">
                      Live Logs <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    {agentLogs.slice(-20).map((l, i) => (
                      <div key={i} className="flex gap-2 leading-5">
                        <span className="text-slate-600 shrink-0">[{l.time}]</span>
                        <span className="text-indigo-400 shrink-0 w-20 truncate">[{l.agent}]</span>
                        <span className="text-emerald-300 break-all">{l.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PDF pane */}
            {(viewMode === 'pdf' || viewMode === 'split') && (
              <div className={'flex flex-col min-h-0 bg-slate-100 relative ' + (viewMode === 'split' ? 'w-1/2' : 'flex-1')}>

                {compileError && (
                  <div className="m-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex gap-2 overflow-auto max-h-72 shrink-0">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                    <div className="min-w-0">
                      <div className="font-semibold mb-1">Compile error — tip: copy the LaTeX and paste into Overleaf (overleaf.com) for detailed diagnostics</div>
                      <pre className="whitespace-pre-wrap font-mono text-[10px] break-all">{compileError}</pre>
                    </div>
                  </div>
                )}

                {isCompiling && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center z-10 gap-3">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    <p className="text-sm font-medium text-slate-700">Compiling with pdflatex…</p>
                    <p className="text-xs text-slate-400">Usually 10–30 seconds</p>
                  </div>
                )}

                {pdfUrl && !isCompiling ? (
                  <iframe src={pdfUrl} className="flex-1 w-full border-none bg-white" title="PDF Preview" />
                ) : !compileError && !isCompiling ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-slate-400">
                      <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-600 mb-1">
                        {activeFile === 'references.bib' ? 'Select main.tex to compile' : 'Click "Compile PDF" to render'}
                      </p>
                      <p className="text-xs text-slate-400">Powered by latex.ytotech.com</p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Reference Modal */}
      {showAddRef && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Add Reference</h3>
              <button onClick={() => setShowAddRef(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
                <input type="text" value={newRef.title} placeholder="Paper title"
                  onChange={e => setNewRef({ ...newRef, title: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Authors * (format: Last, First and Last2, First2)</label>
                <input type="text" value={newRef.authors} placeholder="Smith, John and Doe, Jane"
                  onChange={e => setNewRef({ ...newRef, authors: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Year</label>
                  <input type="text" value={newRef.year}
                    onChange={e => setNewRef({ ...newRef, year: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">DOI (optional)</label>
                  <input type="text" value={newRef.doi} placeholder="10.xxx/..."
                    onChange={e => setNewRef({ ...newRef, doi: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowAddRef(false)} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
              <button
                disabled={!newRef.title || !newRef.authors}
                onClick={() => {
                  addReference({ title: newRef.title, authors: newRef.authors, year: parseInt(newRef.year) || new Date().getFullYear(), doi: newRef.doi, linked: 0 });
                  setShowAddRef(false);
                  setNewRef({ title: '', authors: '', year: String(new Date().getFullYear()), doi: '' });
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-40">
                Add Reference
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
