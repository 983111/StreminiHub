import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, CircleDashed, FileText, ChevronRight, Download, Loader2, Columns, Play, Settings, Search, Plus } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const TaskItem = ({ title, subtitle, status, count, active }: any) => {
  return (
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
};

const STAGES = ['idle', 'planning', 'discovering', 'assigning', 'intro', 'body', 'synthesis', 'review', 'completed'];

export default function PaperGeneration() {
  const { works, activeWorkId, generationStatus, agentLogs, references, updateGeneratedFile, addReference } = useAppContext();
  const [activeFile, setActiveFile] = useState('Introduction.tex');
  const [viewMode, setViewMode] = useState<'source' | 'pdf' | 'split'>('split');
  const [docClass, setDocClass] = useState('article');
  const [pageSize, setPageSize] = useState('a4paper');
  const [margin, setMargin] = useState('1in');
  const [showSettings, setShowSettings] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'tasks' | 'references'>('tasks');
  const [selectedCitation, setSelectedCitation] = useState<{ keys: string[], start: number, end: number, originalText: string } | null>(null);
  const [referenceSearch, setReferenceSearch] = useState('');
  const [showAddReference, setShowAddReference] = useState(false);
  const [newReference, setNewReference] = useState({
    title: '',
    authors: '',
    year: new Date().getFullYear().toString(),
    journal: '',
    doi: ''
  });
  const formRef = useRef<HTMLFormElement>(null);

  const activeWork = works.find(w => w.id === activeWorkId);

  const getStatus = (stage: string) => {
    const stageIndex = STAGES.indexOf(stage);
    const currentIndex = STAGES.indexOf(generationStatus);
    if (currentIndex > stageIndex) return 'completed';
    if (currentIndex === stageIndex) return 'running';
    return 'pending';
  };

  const getCitationKey = (ref: any) => {
    const firstAuthor = ref.authors.split(',')[0].split(' ').pop() || '';
    return `${firstAuthor.replace(/[^a-zA-Z]/g, '')}${ref.year}`;
  };

  const handleToggleCitation = (refKey: string) => {
    if (!selectedCitation || !activeWorkId) return;
    
    const newKeys = selectedCitation.keys.includes(refKey)
      ? selectedCitation.keys.filter(k => k !== refKey)
      : [...selectedCitation.keys, refKey];
      
    // Preserve the original command and optional arguments, e.g., \citep[p. 10]{...}
    const prefixMatch = selectedCitation.originalText.match(/^(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{)/);
    const prefix = prefixMatch ? prefixMatch[1] : '\\cite{';
    
    const newCiteText = newKeys.length > 0 ? `${prefix}${newKeys.join(', ')}}` : '';
    
    const before = generatedContent.substring(0, selectedCitation.start);
    const after = generatedContent.substring(selectedCitation.end);
    const newContent = before + newCiteText + after;
    
    updateGeneratedFile(activeWorkId, activeFile, newContent);
    
    if (newKeys.length > 0) {
      setSelectedCitation({
        keys: newKeys,
        start: selectedCitation.start,
        end: selectedCitation.start + newCiteText.length,
        originalText: newCiteText
      });
    } else {
      setSelectedCitation(null);
    }
  };

  const renderSourceCode = (content: string) => {
    const regex = /(\\(?:cite|citep|citet)(?:\[[^\]]*\])?\{[^}]+\})/g;
    const parts = content.split(regex);
    let currentOffset = 0;
    
    return parts.map((part, i) => {
      const start = currentOffset;
      currentOffset += part.length;
      const end = currentOffset;

      if (part.startsWith('\\cite') && part.endsWith('}')) {
        // Extract keys from \cite{key1,key2} or \cite[p. 10]{key1,key2}
        const match = part.match(/\{([^}]+)\}/);
        const keys = match ? match[1].split(',').map(k => k.trim()) : [];
        const isSelected = selectedCitation?.start === start;
        return (
          <span 
            key={`${i}-${start}`} 
            className={`cursor-pointer rounded px-1 transition-colors ${isSelected ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}
            onClick={() => {
              setSelectedCitation({ keys, start, end, originalText: part });
              setActiveSidebarTab('references');
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={`${i}-${start}`}>{part}</span>;
    });
  };

  const generatedContent = activeWork?.generatedFiles?.[activeFile] || '';
  
  // Prepare LaTeX for compilation
  let latexToCompile = generatedContent;
  
  if (activeFile === 'main.tex' && activeWork?.generatedFiles) {
    // Inline \input commands for main.tex
    latexToCompile = latexToCompile.replace(/\\input\{([^}]+)\}/g, (match, filename) => {
      const fileContent = activeWork.generatedFiles?.[`${filename}.tex`] || activeWork.generatedFiles?.[filename];
      if (fileContent) {
        // Strip any document structure from snippets to prevent nested document errors
        let strippedContent = fileContent
          .replace(/\\documentclass(\[[^\]]*\])?\{[^}]+\}/g, '')
          .replace(/\\begin\{document\}/g, '')
          .replace(/\\end\{document\}/g, '')
          .replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}/g, '');
        return `\n% --- Inlined ${filename} ---\n${strippedContent}\n`;
      }
      return `\n% --- Missing ${filename} ---\n`;
    });
  }

  // Apply document settings (class, size, margins) and standard packages to prevent compilation errors
  const preamblePackages = `\\usepackage[margin=${margin}]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage[utf8]{inputenc}`;
  
  if (latexToCompile && latexToCompile.includes('\\documentclass')) {
    // Replace existing documentclass and inject geometry and packages
    latexToCompile = latexToCompile.replace(
      /\\documentclass(\[[^\]]*\])?\{[^}]+\}/, 
      `\\documentclass[${pageSize}]{${docClass}}\n${preamblePackages}`
    );
    
    // Ensure \author exists if \maketitle is used, as it causes fatal errors in some classes
    if (latexToCompile.includes('\\maketitle') && !latexToCompile.includes('\\author{')) {
      latexToCompile = latexToCompile.replace('\\begin{document}', '\\author{AI Researcher}\n\\begin{document}');
    }
  } else if (latexToCompile) {
    // Strip any existing document structure just in case
    let strippedContent = latexToCompile
      .replace(/\\begin\{document\}/g, '')
      .replace(/\\end\{document\}/g, '');
    // Wrap snippets in a basic document structure with settings
    latexToCompile = `\\documentclass[${pageSize}]{${docClass}}\n${preamblePackages}\n\\begin{document}\n${strippedContent}\n\\end{document}`;
  }

  // We now use a manual "Compile PDF" button instead of automatic submission
  // to give the user more control and prevent unnecessary API calls.

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
      {/* Sidebar Tasks / References */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <div className="flex border-b border-slate-200">
          <button 
            onClick={() => setActiveSidebarTab('tasks')} 
            className={`flex-1 py-3 text-sm font-medium ${activeSidebarTab === 'tasks' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Tasks
          </button>
          <button 
            onClick={() => setActiveSidebarTab('references')} 
            className={`flex-1 py-3 text-sm font-medium ${activeSidebarTab === 'references' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            References
          </button>
        </div>

        {activeSidebarTab === 'tasks' ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <TaskItem title="Planning" subtitle="Creating paper plan" status={getStatus('planning')} active={generationStatus === 'planning'} />
            <TaskItem title="Reference Discovery" subtitle="Discovering references via semantic search" status={getStatus('discovering')} count={getStatus('discovering') === 'completed' ? 12 : undefined} active={generationStatus === 'discovering'} />
            <TaskItem title="Reference Assignment" subtitle="Assigning references to sections" status={getStatus('assigning')} count={getStatus('assigning') === 'completed' ? 8 : undefined} active={generationStatus === 'assigning'} />
            <TaskItem title="Introduction" subtitle="Generating introduction" status={getStatus('intro')} count={getStatus('intro') === 'completed' ? 1 : undefined} active={generationStatus === 'intro'} />
            <TaskItem title="Body Sections" subtitle="Generating body sections" status={getStatus('body')} count={getStatus('body') === 'completed' ? 2 : undefined} active={generationStatus === 'body'} />
            <TaskItem title="Synthesis" subtitle="Generating synthesis sections" status={getStatus('synthesis')} count={getStatus('synthesis') === 'completed' ? 1 : undefined} active={generationStatus === 'synthesis'} />
            <TaskItem title="Review Loop" subtitle="Review loop (user-controlled)" status={getStatus('review')} active={generationStatus === 'review'} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {selectedCitation ? (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-2 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-indigo-900">Editing Citation</h3>
                  <button onClick={() => setSelectedCitation(null)} className="text-indigo-400 hover:text-indigo-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                <p className="text-xs text-indigo-700 mb-3">Select references to include in this citation.</p>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {references.map(ref => {
                    const key = getCitationKey(ref);
                    const isChecked = selectedCitation.keys.includes(key);
                    return (
                      <label key={ref.id} className="flex items-start gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={() => handleToggleCitation(key)}
                          className="mt-1 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="flex-1">
                          <div className={`text-xs font-medium ${isChecked ? 'text-indigo-900' : 'text-slate-700 group-hover:text-slate-900'}`}>{ref.title}</div>
                          <div className="text-[10px] text-slate-500">{ref.authors} ({ref.year})</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500 mb-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                Click a <span className="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">\cite{'{...}'}</span> command in the source code to edit it, or view all references below.
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">All References</h3>
                <button 
                  onClick={() => setShowAddReference(true)}
                  className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search references..." 
                  value={referenceSearch}
                  onChange={(e) => setReferenceSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div className="space-y-3 mt-3">
                {references
                  .filter(ref => 
                    ref.title.toLowerCase().includes(referenceSearch.toLowerCase()) || 
                    ref.authors.toLowerCase().includes(referenceSearch.toLowerCase()) ||
                    getCitationKey(ref).toLowerCase().includes(referenceSearch.toLowerCase())
                  )
                  .map(ref => (
                  <div key={ref.id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-indigo-300 transition-colors cursor-pointer" onClick={() => {
                    // Reverse lookup: find the citation in the source code
                    const key = getCitationKey(ref);
                    const regex = new RegExp(`\\\\(?:cite|citep|citet)(?:\\[[^\\]]*\\])?\\{[^}]*${key}[^}]*\\}`, 'g');
                    const match = regex.exec(generatedContent);
                    if (match) {
                      setViewMode('source');
                      // In a real app, we would scroll to the match. For now, we just select it.
                      setSelectedCitation({
                        keys: match[0].match(/\{([^}]+)\}/)?.[1].split(',').map(k => k.trim()) || [key],
                        start: match.index,
                        end: match.index + match[0].length,
                        originalText: match[0]
                      });
                    }
                  }}>
                    <div className="text-xs font-mono text-indigo-500 mb-1">{getCitationKey(ref)}</div>
                    <div className="text-sm font-medium text-slate-800 mb-1 leading-snug">{ref.title}</div>
                    <div className="text-xs text-slate-500">{ref.authors}</div>
                    <div className="text-xs text-slate-400 mt-1">{ref.year} {ref.doi && `• ${ref.doi}`}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content - Explorer & PDF */}
      <div className="flex-1 flex bg-slate-50">
        {/* Explorer */}
        <div className="w-64 border-r border-slate-200 bg-white flex flex-col">
           <div className="p-2 border-b border-slate-200 font-medium text-sm flex items-center gap-2 text-slate-800">
             <FileText className="w-4 h-4" /> Explorer
           </div>
           <div className="p-2 text-sm space-y-1">
             <div className="flex items-center gap-1 text-slate-700 hover:bg-slate-100 p-1 rounded cursor-pointer">
               <ChevronRight className="w-3 h-3" /> sections
             </div>
             <div className="pl-4 space-y-1">
                <div onClick={() => setActiveFile('Abstract.tex')} className={`flex items-center gap-2 p-1 rounded cursor-pointer ${activeFile === 'Abstract.tex' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-100'}`}>
                  <FileText className="w-3 h-3" /> Abstract.tex
                </div>
                <div onClick={() => setActiveFile('Introduction.tex')} className={`flex items-center gap-2 p-1 rounded cursor-pointer ${activeFile === 'Introduction.tex' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-100'}`}>
                  <FileText className="w-3 h-3" /> Introduction.tex
                </div>
                <div onClick={() => setActiveFile('Methods.tex')} className={`flex items-center gap-2 p-1 rounded cursor-pointer ${activeFile === 'Methods.tex' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-100'}`}>
                  <FileText className="w-3 h-3" /> Methods.tex
                </div>
             </div>
             <div onClick={() => setActiveFile('main.tex')} className={`flex items-center gap-2 p-1 rounded cursor-pointer mt-2 ${activeFile === 'main.tex' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-100'}`}>
               <FileText className="w-3 h-3" /> main.tex
             </div>
             <div onClick={() => setActiveFile('references.bib')} className={`flex items-center gap-2 p-1 rounded cursor-pointer ${activeFile === 'references.bib' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700 hover:bg-slate-100'}`}>
               <FileText className="w-3 h-3" /> references.bib
             </div>
           </div>
        </div>

        {/* Editor / PDF View */}
        <div className="flex-1 flex flex-col bg-white overflow-hidden">
          <div className="h-12 border-b border-slate-200 flex items-center justify-between px-4 bg-slate-50 shrink-0">
            <div className="flex items-center gap-4 text-sm">
              <button 
                onClick={() => setViewMode('source')}
                className={`font-medium h-12 px-2 ${viewMode === 'source' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Source
              </button>
              <button 
                onClick={() => setViewMode('pdf')}
                className={`font-medium h-12 px-2 ${viewMode === 'pdf' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900'}`}
              >
                PDF Preview
              </button>
              <button 
                onClick={() => setViewMode('split')}
                className={`font-medium h-12 px-2 flex items-center gap-1 ${viewMode === 'split' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-900'}`}
              >
                <Columns className="w-4 h-4" /> Split
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-md shadow-sm transition-colors"
                >
                  <Settings className="w-4 h-4" /> PDF Settings
                </button>
                
                {showSettings && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl p-4 z-50">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">Document Settings</h3>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Document Class</label>
                        <select value={docClass} onChange={e => setDocClass(e.target.value)} className="w-full text-sm border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-indigo-500 outline-none">
                          <option value="article">Article</option>
                          <option value="report">Report</option>
                          <option value="book">Book</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Page Size</label>
                        <select value={pageSize} onChange={e => setPageSize(e.target.value)} className="w-full text-sm border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-indigo-500 outline-none">
                          <option value="a4paper">A4</option>
                          <option value="letterpaper">US Letter</option>
                          <option value="legalpaper">Legal</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Margins</label>
                        <select value={margin} onChange={e => setMargin(e.target.value)} className="w-full text-sm border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-indigo-500 outline-none">
                          <option value="1in">1 inch (Normal)</option>
                          <option value="1.5in">1.5 inch (Wide)</option>
                          <option value="0.5in">0.5 inch (Narrow)</option>
                          <option value="2cm">2 cm</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button 
                onClick={() => {
                  if (viewMode === 'source') {
                    setViewMode('split');
                  }
                  setTimeout(() => {
                    if (formRef.current) {
                      formRef.current.submit();
                    }
                  }, 50);
                }}
                className="flex items-center gap-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-md transition-colors shadow-sm"
              >
                <Play className="w-4 h-4" /> Compile PDF
              </button>
              <div className="relative">
                <button 
                  onClick={() => setShowDownload(!showDownload)}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-md shadow-sm transition-colors"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
                
                {showDownload && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-xl p-2 z-50">
                    <button 
                      onClick={() => {
                        setShowDownload(false);
                        const blob = new Blob([latexToCompile], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = activeFile;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                    >
                      Download LaTeX Source
                    </button>
                    <button 
                      onClick={() => {
                        setShowDownload(false);
                        const form = document.createElement('form');
                        form.method = 'POST';
                        form.action = 'https://texlive.net/cgi-bin/latexcgi';
                        form.target = '_blank';
                        
                        const fileInput = document.createElement('input');
                        fileInput.type = 'hidden';
                        fileInput.name = 'filecontents[]';
                        fileInput.value = latexToCompile;
                        
                        const filenameInput = document.createElement('input');
                        filenameInput.type = 'hidden';
                        filenameInput.name = 'filename[]';
                        filenameInput.value = 'document.tex';

                        const engineInput = document.createElement('input');
                        engineInput.type = 'hidden';
                        engineInput.name = 'engine';
                        engineInput.value = 'pdflatex';

                        const returnInput = document.createElement('input');
                        returnInput.type = 'hidden';
                        returnInput.name = 'return';
                        returnInput.value = 'pdf';

                        form.appendChild(fileInput);
                        form.appendChild(filenameInput);
                        form.appendChild(engineInput);
                        form.appendChild(returnInput);
                        document.body.appendChild(form);
                        form.submit();
                        document.body.removeChild(form);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                    >
                      Download PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex-1 flex overflow-hidden">
            {/* Source Code Pane */}
            {(viewMode === 'source' || viewMode === 'split') && (
              <div className={`flex flex-col flex-1 overflow-hidden ${viewMode === 'split' ? 'border-r border-slate-200' : ''}`}>
                <div className="flex-1 p-6 overflow-y-auto font-mono text-sm text-slate-800 leading-relaxed">
                  <p className="text-slate-400 mb-4">% {activeFile}</p>
                  
                  {generatedContent ? (
                    <pre className="whitespace-pre-wrap font-mono text-sm">{renderSourceCode(generatedContent)}</pre>
                  ) : (
                    <p className="text-slate-500 italic">% Content for {activeFile} is being generated or not available...</p>
                  )}
                </div>
                
                {/* Logs overlay */}
                {generationStatus !== 'completed' && (
                  <div className="h-64 shrink-0 p-4 bg-slate-900 text-emerald-400 text-xs font-mono overflow-y-auto border-t border-slate-800">
                    <div className="mb-3 text-slate-400 font-semibold border-b border-slate-700 pb-2 flex items-center justify-between">
                      <span>Agent Execution Logs</span>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        Running
                      </span>
                    </div>
                    <div className="space-y-2">
                      {agentLogs.map((log, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="text-slate-500 shrink-0">[{log.time}]</span>
                          <span className="text-indigo-400 shrink-0 w-24">[{log.agent}]</span>
                          <span className="text-emerald-300">{log.message}</span>
                        </div>
                      ))}
                      {generationStatus !== 'completed' && (
                        <div className="flex gap-3 animate-pulse">
                          <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span>
                          <span className="text-indigo-400 w-24">[System]</span>
                          <span className="text-emerald-300">_</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PDF Preview Pane */}
            {(viewMode === 'pdf' || viewMode === 'split') && (
              <div className="flex-1 bg-slate-200 overflow-hidden flex flex-col relative">
                {generatedContent ? (
                  <>
                    <form ref={formRef} action="https://texlive.net/cgi-bin/latexcgi" method="POST" target="pdf-iframe" className="hidden">
                      <input type="hidden" name="filecontents[]" value={latexToCompile} />
                      <input type="hidden" name="filename[]" value="document.tex" />
                      <input type="hidden" name="engine" value="pdflatex" />
                      <input type="hidden" name="return" value="pdfjs" />
                    </form>
                    <iframe 
                      name="pdf-iframe"
                      className="w-full h-full border-none bg-white"
                      title="PDF Preview"
                    />
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
              <button 
                onClick={() => setShowAddReference(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Title</label>
                <input 
                  type="text" 
                  value={newReference.title}
                  onChange={e => setNewReference({...newReference, title: e.target.value})}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Paper title"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Authors</label>
                <input 
                  type="text" 
                  value={newReference.authors}
                  onChange={e => setNewReference({...newReference, authors: e.target.value})}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Smith J., Doe J."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Year</label>
                  <input 
                    type="text" 
                    value={newReference.year}
                    onChange={e => setNewReference({...newReference, year: e.target.value})}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">DOI (Optional)</label>
                  <input 
                    type="text" 
                    value={newReference.doi}
                    onChange={e => setNewReference({...newReference, doi: e.target.value})}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="10.xxxx/..."
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Journal/Venue</label>
                <input 
                  type="text" 
                  value={newReference.journal}
                  onChange={e => setNewReference({...newReference, journal: e.target.value})}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Nature"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button 
                onClick={() => setShowAddReference(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (newReference.title && newReference.authors) {
                    addReference({
                      title: newReference.title,
                      authors: newReference.authors,
                      year: parseInt(newReference.year, 10) || new Date().getFullYear(),
                      doi: newReference.doi,
                      linked: 0
                    });
                    setShowAddReference(false);
                    setNewReference({
                      title: '',
                      authors: '',
                      year: new Date().getFullYear().toString(),
                      journal: '',
                      doi: ''
                    });
                  }
                }}
                disabled={!newReference.title || !newReference.authors}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Reference
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
