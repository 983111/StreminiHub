import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, CircleDashed, FileText, Download,
  Columns, Play, Search, Plus, Loader2, AlertTriangle
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';

// ---------------------------------------------------------------------------
// TaskItem
// ---------------------------------------------------------------------------
const TaskItem = ({ title, subtitle, status, active }: any) => (
  <div className={`p-3 rounded-lg border ${active ? 'border-indigo-200 bg-indigo-50' : 'border-transparent hover:bg-slate-50'} cursor-pointer transition-colors`}>
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        {status === 'running'   && <CircleDashed className="w-4 h-4 text-indigo-500 animate-spin" />}
        {status === 'pending'   && <CircleDashed className="w-4 h-4 text-slate-300" />}
        <span className={`font-medium text-sm ${active ? 'text-indigo-900' : 'text-slate-700'}`}>{title}</span>
      </div>
    </div>
    <p className="text-xs text-slate-500 pl-6">{subtitle}</p>
  </div>
);

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------
const STAGES = ['idle','planning','discovering','assigning','intro','body','synthesis','review','completed'];

function stageStatus(stage: string, current: string) {
  const si = STAGES.indexOf(stage);
  const ci = STAGES.indexOf(current);
  if (ci > si) return 'completed';
  if (ci === si) return 'running';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Build a single compilable .tex string
// ---------------------------------------------------------------------------
function buildCompilableLatex(
  activeFile: string,
  generatedFiles: Record<string, string>
): string {
  if (activeFile === 'main.tex') {
    let tex = generatedFiles['main.tex'] || '';
    tex = tex.replace(/\\input\{([^}]+)\}/g, (_m: string, name: string) => {
      const candidates = [`${name}.tex`, name, `${name.replace(/\.tex$/, '')}.tex`];
      for (const c of candidates) {
        if (generatedFiles[c]) return '\n% -- inlined ' + c + ' --\n' + generatedFiles[c] + '\n';
      }
      return '\n% -- missing: ' + name + ' --\n';
    });
    return tex;
  }

  // Snippet: strip any preamble the model injected, then wrap
  const snippet = generatedFiles[activeFile] || '';
  const clean = snippet
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]+\}\s*/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}\s*/g, '')
    .replace(/\\begin\{document\}\s*/g, '')
    .replace(/\\end\{document\}\s*/g, '')
    .trim();

  return [
    '\\documentclass[conference]{IEEEtran}',
    '\\usepackage{cite}',
    '\\usepackage{amsmath,amssymb,amsfonts}',
    '\\usepackage{graphicx}',
    '\\usepackage{textcomp}',
    '\\usepackage{xcolor}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{hyperref}',
    '\\hypersetup{hidelinks}',
    '\\title{Preview: ' + activeFile.replace(/_/g, '\\_') + '}',
    '\\author{AI Research System}',
    '\\begin{document}',
    '\\maketitle',
    clean,
    '\\end{document}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Compile via latex.ytotech.com  (JSON body, returns PDF bytes)
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
    throw new Error('Compiler returned ' + res.status + ':\n' + txt.slice(0, 600));
  }

  const blob = await res.blob();
  if (blob.type && !blob.type.includes('pdf')) {
    const txt = await blob.text();
    throw new Error('Unexpected response type "' + blob.type + '":\n' + txt.slice(0, 600));
  }
  return blob;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PaperGeneration() {
  const {
    works, activeWorkId, generationStatus, agentLogs,
    references, updateGeneratedFile, addReference,
  } = useAppContext();

  const [activeFile,        setActiveFile]        = useState('main.tex');
  const [viewMode,          setViewMode]           = useState<'source' | 'pdf' | 'split'>('split');
  const [activeSidebarTab,  setActiveSidebarTab]   = useState<'tasks' | 'references'>('tasks');
  const [selectedCitation,  setSelectedCitation]   = useState<{
    keys: string[]; start: number; end: number; originalText: string;
  } | null>(null);
  const [referenceSearch,   setReferenceSearch]    = useState('');
  const [showAddReference,  setShowAddReference]   = useState(false);
  const [newReference,      setNewReference]       = useState({
    title: '', authors: '', year: new Date().getFullYear().toString(), journal: '', doi: '',
  });
  const [showDownload,      setShowDownload]       = useState(false);

  // PDF state
  const [pdfUrl,      setPdfUrl]      = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError,setCompileError]= useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const activeWork = works.find(w => w.id === activeWorkId);

  useEffect(() => {
    if (generationStatus === 'completed') setActiveFile('main.tex');
  }, [generationStatus]);

  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  const generatedContent = activeWork?.generatedFiles?.[activeFile] || '';
  const latexToCompile   = buildCompilableLatex(activeFile, activeWork?.generatedFiles || {});

  // ---- Citation helpers ----------------------------------------------------
  const getCitationKey = (ref: any) => {
    const first = ref.authors.split(',')[0].split(' ').pop() || '';
    return first.replace(/[^a-zA-Z]/g, '') + ref.year;
  };

  const handleToggleCitation = (refKey: string) => {
    if (!selectedCitation || !activeWorkId) return;
    const newKeys = selectedCitation.keys.includes(refKey)
      ? selectedCitation.keys.filter(k => k !== refKey)
      : [...selectedCitation.keys, refKey];
    const prefixMatch = selectedCitation.originalText.match(/^(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{)/);
    const prefix = prefixMatch ? prefixMatch[1] : '\\cite{';
    const newCiteText = newKeys.length > 0 ? prefix + newKeys.join(', ') + '}' : '';
    const before = generatedContent.substring(0, selectedCitation.start);
    const after  = generatedContent.substring(selectedCitation.end);
    updateGeneratedFile(activeWorkId, activeFile, before + newCiteText + after);
    if (newKeys.length > 0) {
      setSelectedCitation({ keys: newKeys, start: selectedCitation.start, end: selectedCitation.start + newCiteText.length, originalText: newCiteText });
    } else {
      setSelectedCitation(null);
    }
  };

  const renderSourceCode = (content: string) => {
    const regex = /(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{[^}]+\})/g;
    const parts  = content.split(regex);
    let offset   = 0;
    return parts.map((part, i) => {
      const start = offset;
      offset += part.length;
      const end = offset;
      if (/^\\cite/.test(part) && part.endsWith('}')) {
        const match = part.match(/\{([^}]+)\}/);
        const keys  = match ? match[1].split(',').map(k => k.trim()) : [];
        const isSel = selectedCitation?.start === start;
        return (
          <span key={i + '-' + start}
            className={'cursor-pointer rounded px-0.5 transition-colors ' + (isSel ? 'bg-indigo-500 text-white' : 'bg-indigo-900/40 text-indigo-300 hover:bg-indigo-700/50')}
            onClick={() => { setSelectedCitation({ keys, start, end, originalText: part }); setActiveSidebarTab('references'); }}
          >{part}</span>
        );
      }
      return <span key={i + '-' + start}>{part}</span>;
    });
  };

  // ---- Compile PDF ---------------------------------------------------------
  const handleCompile = async () => {
    if (viewMode === 'source') setViewMode('split');
    setIsCompiling(true);
    setCompileError(null);
    try {
      const blob = await compileToPdf(latexToCompile);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPdfUrl(url);
    } catch (err: any) {
      setCompileError(err.message || 'Unknown compile error');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleDownloadTex = () => {
    setShowDownload(false);
    const blob = new Blob([latexToCompile], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: activeFile });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async () => {
    setShowDownload(false);
    try {
      const blob = await compileToPdf(latexToCompile);
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: 'paper.pdf' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Download failed: ' + err.message);
    }
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

  return (
    <div className="flex h-[calc(100vh-4rem)]">

      {/* LEFT SIDEBAR */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <div className="flex border-b border-slate-200">
          {(['tasks','references'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveSidebarTab(tab)}
              className={'flex-1 py-3 text-sm font-medium capitalize ' + (activeSidebarTab === tab ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50')}>
              {tab}
            </button>
          ))}
        </div>

        {activeSidebarTab === 'tasks' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <TaskItem title="Planning"             subtitle="Creating paper plan"        status={stageStatus('planning',    generationStatus)} active={generationStatus === 'planning'} />
            <TaskItem title="Reference Discovery"  subtitle="Discovering references"     status={stageStatus('discovering', generationStatus)} active={generationStatus === 'discovering'} />
            <TaskItem title="Reference Assignment" subtitle="Assigning references"       status={stageStatus('assigning',   generationStatus)} active={generationStatus === 'assigning'} />
            <TaskItem title="Introduction"         subtitle="Generating introduction"    status={stageStatus('intro',       generationStatus)} active={generationStatus === 'intro'} />
            <TaskItem title="Body Sections"        subtitle="Methods & Results"          status={stageStatus('body',        generationStatus)} active={generationStatus === 'body'} />
            <TaskItem title="Synthesis"            subtitle="Abstract & Conclusion"      status={stageStatus('synthesis',   generationStatus)} active={generationStatus === 'synthesis'} />
            <TaskItem title="Assembly"             subtitle="main.tex + references.bib"  status={stageStatus('review',      generationStatus)} active={generationStatus === 'review'} />
            {generationStatus === 'completed' && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 text-center font-medium">
                Generation complete — click "Compile PDF"
              </div>
            )}
          </div>
        )}

        {activeSidebarTab === 'references' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {selectedCitation && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-indigo-900">Editing Citation</h3>
                  <button onClick={() => setSelectedCitation(null)} className="text-indigo-400 hover:text-indigo-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {references.map(ref => {
                    const key = getCitationKey(ref);
                    const checked = selectedCitation.keys.includes(key);
                    return (
                      <label key={ref.id} className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => handleToggleCitation(key)}
                          className="mt-0.5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500" />
                        <div>
                          <div className="text-xs font-medium text-slate-700">{ref.title}</div>
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
              {references
                .filter(r => r.title.toLowerCase().includes(referenceSearch.toLowerCase()) || r.authors.toLowerCase().includes(referenceSearch.toLowerCase()))
                .map(ref => (
                  <div key={ref.id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-indigo-300 cursor-pointer"
                    onClick={() => {
                      const key   = getCitationKey(ref);
                      const regex = new RegExp('\\\\(?:cite|citep|citet)(?:\\[[^\\]]*\\])?\\{[^}]*' + key + '[^}]*\\}', 'g');
                      const match = regex.exec(generatedContent);
                      if (match) {
                        setViewMode('source');
                        setSelectedCitation({ keys: (match[0].match(/\{([^}]+)\}/) || ['',key])[1].split(',').map((k: string) => k.trim()), start: match.index, end: match.index + match[0].length, originalText: match[0] });
                      }
                    }}>
                    <div className="text-xs font-mono text-indigo-500 mb-0.5">{getCitationKey(ref)}</div>
                    <div className="text-sm font-medium text-slate-800 leading-snug">{ref.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{ref.authors}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{ref.year}{ref.doi ? ' ' + ref.doi : ''}</div>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 flex bg-slate-50">

        {/* File explorer */}
        <div className="w-52 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-2 border-b border-slate-200 font-medium text-sm flex items-center gap-2 text-slate-800">
            <FileText className="w-4 h-4" /> Explorer
          </div>
          <div className="p-2 text-sm space-y-0.5">
            {fileList.map(f => (
              <div key={f.name} onClick={() => setActiveFile(f.name)}
                className={'flex items-center gap-2 p-1.5 rounded cursor-pointer ' + (f.indent ? 'pl-5 ' : '') + (activeFile === f.name ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-100')}>
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate">{f.name}</span>
                {activeWork?.generatedFiles?.[f.name] && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Editor + PDF */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden">

          {/* Toolbar */}
          <div className="h-12 border-b border-slate-200 flex items-center justify-between px-4 bg-slate-50 shrink-0">
            <div className="flex items-center text-sm">
              {(['source','split','pdf'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={'font-medium h-12 px-3 capitalize flex items-center gap-1 ' + (viewMode === m ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900')}>
                  {m === 'split' && <Columns className="w-3.5 h-3.5" />}{m}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleCompile} disabled={isCompiling || !generatedContent}
                className="flex items-center gap-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-md transition-colors shadow-sm">
                {isCompiling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isCompiling ? 'Compiling...' : 'Compile PDF'}
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
                      Download PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content panes */}
          <div className="flex-1 flex overflow-hidden">

            {/* Source pane */}
            {(viewMode === 'source' || viewMode === 'split') && (
              <div className={'flex flex-col overflow-hidden border-r border-slate-200 ' + (viewMode === 'split' ? 'w-1/2' : 'flex-1')}>
                <div className="flex-1 p-5 overflow-y-auto font-mono text-sm leading-relaxed bg-[#1e1e2e] text-slate-300">
                  <p className="text-slate-500 mb-3 select-none text-xs">% {activeFile}</p>
                  {generatedContent
                    ? <pre className="whitespace-pre-wrap">{renderSourceCode(generatedContent)}</pre>
                    : <span className="text-slate-500 italic">% Not generated yet...</span>
                  }
                </div>
                {generationStatus !== 'completed' && generationStatus !== 'idle' && (
                  <div className="h-40 shrink-0 p-3 bg-slate-950 text-emerald-400 text-xs font-mono overflow-y-auto border-t border-slate-800">
                    <div className="text-slate-500 font-semibold mb-2 flex items-center gap-2">
                      Agent Logs <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    {agentLogs.map((log, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-slate-600 shrink-0">[{log.time}]</span>
                        <span className="text-indigo-400 shrink-0 w-20 truncate">[{log.agent}]</span>
                        <span className="text-emerald-300">{log.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PDF pane */}
            {(viewMode === 'pdf' || viewMode === 'split') && (
              <div className={'overflow-hidden flex flex-col relative bg-slate-100 ' + (viewMode === 'split' ? 'w-1/2' : 'flex-1')}>

                {/* Error banner */}
                {compileError && (
                  <div className="m-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2 overflow-auto max-h-48">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                    <div>
                      <div className="font-semibold mb-1">Compile error</div>
                      <pre className="whitespace-pre-wrap font-mono">{compileError}</pre>
                    </div>
                  </div>
                )}

                {/* Compiling overlay */}
                {isCompiling && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center z-10 gap-3">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    <p className="text-sm text-slate-600 font-medium">Compiling with pdflatex...</p>
                    <p className="text-xs text-slate-400">This usually takes 10-20 seconds</p>
                  </div>
                )}

                {pdfUrl && !isCompiling ? (
                  <iframe
                    src={pdfUrl}
                    className="w-full h-full border-none bg-white"
                    title="PDF Preview"
                  />
                ) : !compileError && !isCompiling ? (
                  <div className="flex-1 flex items-center justify-center text-slate-500 p-8">
                    <div className="text-center">
                      <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-600">PDF preview will appear here</p>
                      <p className="text-xs text-slate-400 mt-1">Click <strong>Compile PDF</strong> to render</p>
                    </div>
                  </div>
                ) : null}
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
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: 'Title',   key: 'title',   placeholder: 'Paper title'           },
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">DOI (optional)</label>
                  <input type="text" value={newReference.doi}
                    onChange={e => setNewReference({ ...newReference, doi: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="10.xxxx/..." />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShowAddReference(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                disabled={!newReference.title || !newReference.authors}
                onClick={() => {
                  addReference({ title: newReference.title, authors: newReference.authors, year: parseInt(newReference.year) || new Date().getFullYear(), doi: newReference.doi, linked: 0 });
                  setShowAddReference(false);
                  setNewReference({ title: '', authors: '', year: new Date().getFullYear().toString(), journal: '', doi: '' });
                }}
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
