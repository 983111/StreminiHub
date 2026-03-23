import React, { createContext, useContext, useState, ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Node, Edge } from '@xyflow/react';
import { generateAcademicContent } from '../lib/gemini';

export interface Work {
  id: string;
  title: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  generatedFiles?: Record<string, string>;
}

export interface Reference {
  id: string;
  title: string;
  authors: string;
  year: number;
  doi?: string;
  linked: number;
}

export interface AgentLog {
  agent: string;
  message: string;
  time: string;
}

interface AppContextType {
  works: Work[];
  activeWorkId: string | null;
  references: Reference[];
  generationStatus: string;
  agentLogs: AgentLog[];
  createWork: (title: string, description: string) => void;
  setActiveWork: (id: string) => void;
  updateWorkGraph: (id: string, nodes: Node[], edges: Edge[]) => void;
  addReference: (ref: Omit<Reference, 'id'>) => void;
  startGeneration: (nodes?: Node[], edges?: Edge[]) => void;
  setGenerationStatus: (status: string) => void;
  updateGeneratedFile: (workId: string, filename: string, content: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Strict system prompt — prepended to every AI call
// ---------------------------------------------------------------------------
const SYS = `You are an expert LaTeX academic writer for IEEE conference papers.
STRICT RULES — violating any rule makes the output unusable:
1. Output ONLY raw LaTeX. No prose, no explanations, no markdown.
2. NEVER emit <think>, <reasoning>, or any XML/HTML tags.
3. NEVER wrap output in backtick fences (\`\`\`latex, \`\`\`, etc.).
4. NEVER include \\documentclass, \\usepackage, \\begin{document}, \\end{document}.
5. Start your output directly with the first LaTeX command (e.g. \\section{...}).
6. Use \\cite{key} for citations — keys are provided.
7. You MAY use: tikzpicture, tabular, table, figure, color, xcolor commands — all packages are pre-loaded.
8. For diagrams use TikZ. For data use tabular with \\rowcolor. Keep it valid pdflatex.`;

// ---------------------------------------------------------------------------
// Strip any reasoning / markdown the model leaks
// ---------------------------------------------------------------------------
function clean(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```[\w]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/\\documentclass[\s\S]*?\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Derive a stable BibTeX key from a Reference
// ---------------------------------------------------------------------------
function bibKey(ref: Reference): string {
  const last = ref.authors.split(',')[0].trim().split(' ').pop() || 'Author';
  return last.replace(/[^a-zA-Z]/g, '') + ref.year;
}

// ---------------------------------------------------------------------------
// Build the final IEEE main.tex (no \input — everything inlined by caller)
// ---------------------------------------------------------------------------
function buildMainTex(
  title: string,
  files: Record<string, string>,
  refs: Reference[]
): string {
  // Inline section files in order — done HERE so buildCompilableLatex never
  // recurses and the regex only runs once on deterministic strings.
  const order = ['Abstract', 'Introduction', 'Methods', 'Results', 'Conclusion'];
  const body = order
    .map(s => {
      const content = files[s + '.tex'] || '';
      return content ? '% === ' + s + ' ===\n' + content : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const bibliography = refs
    .map(r => '\\bibitem{' + bibKey(r) + '} ' + r.authors + ', ``' + r.title + ",'' " + r.year + '.')
    .join('\n');

  const safeTitle = title
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\$/g, '\\$');

  return `\\documentclass[conference]{IEEEtran}
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage{colortbl}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{tikz}
\\usetikzlibrary{shapes.geometric,arrows.meta,positioning,fit,backgrounds,calc}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.17}
\\usepackage{hyperref}
\\hypersetup{hidelinks,colorlinks=false}

\\definecolor{ieeeblue}{RGB}{0,84,166}
\\definecolor{ieeegray}{RGB}{220,220,220}
\\definecolor{ieeegreen}{RGB}{0,128,64}
\\definecolor{ieeeorange}{RGB}{220,100,0}

\\title{${safeTitle}}
\\author{%
  \\IEEEauthorblockN{AI Research System}
  \\IEEEauthorblockA{\\textit{Automated Research Platform}\\\\
  research@ai-system.org}
}

\\begin{document}
\\maketitle

${body}

\\begin{thebibliography}{00}
${bibliography}
\\end{thebibliography}

\\end{document}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [works, setWorks] = useState<Work[]>([
    {
      id: '1',
      title: 'AI tools expand impact but contract focus',
      description: 'Template canvas based on Nature AI-Science study.',
      nodes: [
        { id: 'start-1', type: 'startNode', position: { x: 100, y: 100 }, data: { title: 'AI tools expand impact but contract focus', venue: 'Nature' } },
        { id: 'idea-1', type: 'ideaNode', position: { x: 500, y: 150 }, data: { body: 'Artificial intelligence tools have a dual effect on scientific research...' } },
        { id: 'lit-1', type: 'literatureNode', position: { x: 500, y: 350 }, data: { title: 'Large-scale Bibliometric Analysis', file: 'dataset.csv' } },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'idea-1', type: 'smoothstep' },
        { id: 'e2', source: 'start-1', target: 'lit-1', type: 'smoothstep' },
      ],
      generatedFiles: {},
    },
  ]);
  const [activeWorkId, setActiveWorkId] = useState<string | null>('1');
  const [references, setReferences] = useState<Reference[]>([
    { id: 'r1', title: 'Inter-symbolic AI: Interlinking Symbolic AI and Subsymbolic AI', authors: 'Andre Platzer', year: 2024, doi: '10.1007/978-3-031-75387-8_11', linked: 5 },
    { id: 'r2', title: 'Ranking scientists', authors: 'S. N. Dorogovtsev, J. F. F. Mendes', year: 2015, linked: 0 },
    { id: 'r3', title: 'Human-AI Coevolution', authors: 'Dino Pedreschi, Luca Pappalardo et al.', year: 2023, linked: 2 },
    { id: 'r4', title: 'A Survey of Multi-Agent Deep Reinforcement Learning with Communication', authors: 'Changxi Zhu, Mehdi Dastani et al.', year: 2022, linked: 0 },
  ]);
  const [generationStatus, setGenerationStatus] = useState<string>('idle');
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);

  const createWork = (title: string, description: string) => {
    const w: Work = {
      id: uuidv4(), title, description,
      nodes: [{ id: 'start-' + uuidv4(), type: 'startNode', position: { x: 100, y: 100 }, data: { title, venue: '' } }],
      edges: [], generatedFiles: {},
    };
    setWorks(prev => [...prev, w]);
    setActiveWorkId(w.id);
  };

  const updateWorkGraph = (id: string, nodes: Node[], edges: Edge[]) =>
    setWorks(prev => prev.map(w => w.id === id ? { ...w, nodes, edges } : w));

  // Public updateGeneratedFile — safe for use outside generation pipeline
  const updateGeneratedFile = (workId: string, filename: string, content: string) =>
    setWorks(prev => prev.map(w =>
      w.id === workId
        ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), [filename]: content } }
        : w
    ));

  const addReference = (ref: Omit<Reference, 'id'>) =>
    setReferences(prev => [...prev, { ...ref, id: uuidv4() }]);

  // ---------------------------------------------------------------------------
  // Generation pipeline
  // Uses a LOCAL files accumulator to avoid React stale-closure bugs where
  // each async call would overwrite previous results via the state setter.
  // At the end, one atomic setWorks() call commits everything at once.
  // ---------------------------------------------------------------------------
  const startGeneration = async (latestNodes?: Node[], latestEdges?: Edge[]) => {
    if (!activeWorkId) return;
    const work = works.find(w => w.id === activeWorkId);
    if (!work) return;

    // ---- Reset ----
    setGenerationStatus('planning');
    setAgentLogs([]);

    // Local accumulator — avoids stale React state reads mid-async
    const files: Record<string, string> = {};

    const log = (agent: string, message: string) =>
      setAgentLogs(prev => [...prev, { agent, message, time: new Date().toLocaleTimeString() }]);

    // Flush accumulated files to React state (call after every section so the
    // source pane updates in real time)
    const flush = () =>
      setWorks(prev => prev.map(w =>
        w.id === activeWorkId
          ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), ...files } }
          : w
      ));

    log('System', 'Initialising generation sequence...');

    const nodes = latestNodes || work.nodes;
    const graphCtx = nodes.map(n => JSON.stringify(n.data)).join('\n');
    const refCtx = references.map(r => bibKey(r) + ': "' + r.title + '" by ' + r.authors + ' (' + r.year + ')').join('\n');

    // ---- 1. Plan ----
    log('Planner', 'Analysing research graph...');
    const outlineRaw = await generateAcademicContent(
      'Create a concise plain-text paragraph-level outline for an IEEE paper titled "' + work.title + '".\n' +
      'Research context:\n' + graphCtx + '\n' +
      'Return plain text only — no LaTeX, no markdown.'
    );
    const outline = outlineRaw.replace(/```[\s\S]*?```/g, '').trim();
    log('Planner', 'Outline ready.');

    // ---- 2. Discover ----
    setGenerationStatus('discovering');
    log('Paper Parser', references.length + ' references loaded from library.');
    await new Promise(r => setTimeout(r, 400));

    // ---- 3. Assign ----
    setGenerationStatus('assigning');
    log('Commander', 'Assigning references to sections...');
    await new Promise(r => setTimeout(r, 300));
    log('Commander', 'Assignment complete.');

    // ---- 4. Body sections (sequential to avoid rate limits) ----
    setGenerationStatus('intro');

    const genSection = async (name: string, extra: string): Promise<string> => {
      log('Writer (' + name + ')', 'Drafting ' + name + '...');
      const prompt =
        SYS + '\n\n' +
        'Write \\section{' + name + '} for IEEE paper: "' + work.title + '".\n' +
        'Outline:\n' + outline + '\n' +
        'Citations available (use \\cite{key}):\n' + refCtx + '\n' +
        'Research context:\n' + graphCtx + '\n\n' +
        extra + '\n\n' +
        'IMPORTANT: Start with \\section{' + name + '} and output raw LaTeX only.';
      const raw = await generateAcademicContent(prompt);
      const result = clean(raw);
      files[name + '.tex'] = result;
      flush();
      log('Reviewer (' + name + ')', name + ' verified.');
      return result;
    };

    const introText = await genSection('Introduction',
      'Include: background, motivation, related work with \\cite{}, contributions list.\n' +
      'Add a TikZ diagram showing the research overview/pipeline using \\begin{tikzpicture}. Use \\definecolor or xcolor named colors (ieeeblue, ieeegreen etc.).'
    );

    setGenerationStatus('body');
    const methodsText = await genSection('Methods',
      'Describe methodology, algorithms, experimental setup.\n' +
      'Include a TikZ flowchart or architecture diagram. Include one \\begin{table} with \\rowcolor{ieeegray} for header row and \\toprule/\\midrule/\\bottomrule.'
    );

    const resultsText = await genSection('Results',
      'Present findings. Include one pgfplots bar chart or line chart using \\begin{tikzpicture}\\begin{axis}. ' +
      'Include one \\begin{table} comparing methods with colored rows using \\rowcolor.'
    );

    // ---- 5. Synthesis ----
    setGenerationStatus('synthesis');
    log('Writer (Abstract)', 'Drafting Abstract...');

    const abstractRaw = await generateAcademicContent(
      SYS + '\n\n' +
      'Write ONLY an IEEE \\begin{abstract}...\\end{abstract} for paper: "' + work.title + '".\n' +
      'Based on Introduction: ' + introText.slice(0, 500) + '\n' +
      'Methods: ' + methodsText.slice(0, 300) + '\n' +
      'Results: ' + resultsText.slice(0, 300) + '\n\n' +
      'Output exactly \\begin{abstract} ... \\end{abstract} and nothing else.'
    );
    const abstractCleaned = clean(abstractRaw);
    const abstractContent = abstractCleaned.includes('\\begin{abstract}')
      ? (abstractCleaned.match(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/) || [''])[0]
      : '\\begin{abstract}\n' + abstractCleaned + '\n\\end{abstract}';
    files['Abstract.tex'] = abstractContent;
    flush();
    log('Writer (Abstract)', 'Abstract complete.');

    const conclusionRaw = await generateAcademicContent(
      SYS + '\n\n' +
      'Write \\section{Conclusion} for IEEE paper: "' + work.title + '".\n' +
      'Summarise contributions, limitations, future work.\n' +
      'Introduction snippet: ' + introText.slice(0, 300) + '\n' +
      'Results snippet: ' + resultsText.slice(0, 300) + '\n\n' +
      'Start with \\section{Conclusion} and output raw LaTeX only.'
    );
    files['Conclusion.tex'] = clean(conclusionRaw);
    flush();
    log('Writer (Conclusion)', 'Conclusion complete.');

    // ---- 6. Assemble ----
    setGenerationStatus('review');
    log('Typesetter', 'Assembling final main.tex...');

    // Build references.bib
    files['references.bib'] = references.map(r => {
      const k = bibKey(r);
      return '@article{' + k + ',\n  author = {' + r.authors + '},\n  title  = {{' + r.title + '}},\n  year   = {' + r.year + '}' + (r.doi ? ',\n  doi    = {' + r.doi + '}' : '') + '\n}';
    }).join('\n\n');

    // Build main.tex — uses local `files` accumulator, NO \input commands,
    // everything is inlined directly so there is nothing to recursively expand
    files['main.tex'] = buildMainTex(work.title, files, references);

    // One final atomic flush of everything
    flush();

    setGenerationStatus('completed');
    log('System', 'Generation complete. Click "Compile PDF" to render.');
  };

  return (
    <AppContext.Provider value={{
      works, activeWorkId, references, generationStatus, agentLogs,
      createWork, setActiveWork: setActiveWorkId, updateWorkGraph,
      addReference, startGeneration, setGenerationStatus, updateGeneratedFile,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
};
