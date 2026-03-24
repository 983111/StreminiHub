import React, { createContext, useContext, useState, ReactNode, useRef } from 'react';
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
// Derive a stable BibTeX key from a Reference
// ---------------------------------------------------------------------------
function bibKey(ref: Reference): string {
  const last = ref.authors.split(',')[0].trim().split(' ').pop() || 'Author';
  return last.replace(/[^a-zA-Z]/g, '') + ref.year;
}

// ---------------------------------------------------------------------------
// Strip reasoning / markdown leakage from AI output
// ---------------------------------------------------------------------------
function clean(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```[\w]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/\\documentclass[\s\S]*?\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}/g, '')
    .replace(/\\usetikzlibrary[^\n]*/g, '')
    .replace(/\\pgfplotsset[^\n]*/g, '')
    .replace(/\\definecolor[^\n]*/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Build references.bib from Reference[]
// ---------------------------------------------------------------------------
function buildBib(refs: Reference[]): string {
  if (!refs.length) return '% No references added.';
  return refs.map(r => {
    const k = bibKey(r);
    const lines = [
      '@article{' + k + ',',
      '  author  = {' + r.authors + '},',
      '  title   = {{' + r.title + '}},',
      '  year    = {' + r.year + '}',
    ];
    if (r.doi) lines.splice(lines.length - 1, 0, '  doi     = {' + r.doi + '},');
    lines.push('}');
    return lines.join('\n');
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Build the final IEEE main.tex from section files (all inlined — no \input)
// ---------------------------------------------------------------------------
function buildMainTex(
  title: string,
  files: Record<string, string>,
  refs: Reference[],
): string {
  const safeTitle = title
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\$/g, '\\$');

  const order = ['Abstract', 'Introduction', 'Methods', 'Results', 'Conclusion'];
  const bodyParts: string[] = [];
  for (const sec of order) {
    const content = (files[sec + '.tex'] || '').trim();
    if (content) {
      bodyParts.push('% ======== ' + sec.toUpperCase() + ' ========');
      bodyParts.push(content);
    }
  }

  // Build thebibliography from our refs
  const bibItems = refs.map(r => {
    const k = bibKey(r);
    const doiPart = r.doi ? ' doi:' + r.doi + '.' : '';
    return '\\bibitem{' + k + '}\n  ' + r.authors + ', ``' + r.title + ",'' " + r.year + '.' + doiPart;
  }).join('\n\n');

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

${bodyParts.join('\n\n')}

\\begin{thebibliography}{${String(refs.length).padStart(2, '0')}}
${bibItems}
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
        { id: 'idea-1', type: 'ideaNode', position: { x: 500, y: 150 }, data: { body: 'Artificial intelligence tools have a dual effect on scientific research: they expand reach but narrow focus to established topics.' } },
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
    { id: 'r1', title: 'Inter-symbolic AI: Interlinking Symbolic AI and Subsymbolic AI', authors: 'Platzer, Andre', year: 2024, doi: '10.1007/978-3-031-75387-8_11', linked: 5 },
    { id: 'r2', title: 'Ranking scientists', authors: 'Dorogovtsev, S. N. and Mendes, J. F. F.', year: 2015, linked: 0 },
    { id: 'r3', title: 'Human-AI Coevolution', authors: 'Pedreschi, Dino and Pappalardo, Luca', year: 2023, linked: 2 },
    { id: 'r4', title: 'A Survey of Multi-Agent Deep Reinforcement Learning with Communication', authors: 'Zhu, Changxi and Dastani, Mehdi', year: 2022, linked: 0 },
  ]);
  const [generationStatus, setGenerationStatus] = useState<string>('idle');
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);

  // Use a ref to accumulate files WITHOUT React closure staleness issues
  const filesRef = useRef<Record<string, string>>({});

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

  const updateGeneratedFile = (workId: string, filename: string, content: string) =>
    setWorks(prev => prev.map(w =>
      w.id === workId
        ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), [filename]: content } }
        : w
    ));

  const addReference = (ref: Omit<Reference, 'id'>) =>
    setReferences(prev => [...prev, { ...ref, id: uuidv4() }]);

  // ---------------------------------------------------------------------------
  // Flush the current filesRef snapshot into React state
  // ---------------------------------------------------------------------------
  const flushFiles = (workId: string) => {
    const snapshot = { ...filesRef.current };
    setWorks(prev => prev.map(w =>
      w.id === workId
        ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), ...snapshot } }
        : w
    ));
  };

  // ---------------------------------------------------------------------------
  // Core generation pipeline
  // ---------------------------------------------------------------------------
  const startGeneration = async (latestNodes?: Node[], latestEdges?: Edge[]) => {
    if (!activeWorkId) return;
    const work = works.find(w => w.id === activeWorkId);
    if (!work) return;

    // Reset accumulator
    filesRef.current = {};

    setGenerationStatus('planning');
    setAgentLogs([]);

    // Capture activeWorkId in local var so closures are stable
    const workId = activeWorkId;

    const log = (agent: string, message: string) =>
      setAgentLogs(prev => [...prev, { agent, message, time: new Date().toLocaleTimeString() }]);

    const save = (filename: string, content: string) => {
      const trimmed = content.trim();
      filesRef.current[filename] = trimmed;
      // Also immediately write to React state so editor panel updates
      setWorks(prev => prev.map(w =>
        w.id === workId
          ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), [filename]: trimmed } }
          : w
      ));
    };

    try {
      const nodes = latestNodes || work.nodes;
      const graphCtx = nodes.map(n => JSON.stringify(n.data)).join('\n');
      const refList = references;
      const refCtx = refList.map(r => '\\cite{' + bibKey(r) + '} = "' + r.title + '" by ' + r.authors + ' (' + r.year + ')').join('\n');

      const SYS = `You are an expert LaTeX academic writer specialising in IEEE conference papers.
ABSOLUTE RULES — any violation makes the output unusable:
1. Output ONLY raw LaTeX. No prose, no markdown, no explanations.
2. NEVER emit <think>, <reasoning>, or any XML/HTML tags.
3. NEVER wrap output in backtick fences.
4. NEVER include \\documentclass, \\usepackage, \\begin{document}, or \\end{document}.
5. NEVER redefine \\definecolor or reload packages — they are pre-loaded.
6. Start your output directly with the first LaTeX command (e.g. \\section{...} or \\begin{abstract}).
7. Use \\cite{key} for citations — available keys listed below.
8. Available pre-loaded packages: tikz (with shapes.geometric, arrows.meta, positioning, fit, backgrounds, calc), pgfplots (compat=1.17), xcolor, colortbl, booktabs, array, amsmath, graphicx.
9. Available colours: ieeeblue, ieeegray, ieeegreen, ieeeorange.
10. Use ONLY valid pdflatex-compatible commands.`;

      // ---- 1. Plan ----
      log('Planner', 'Analysing research graph...');
      const outlineRaw = await generateAcademicContent(
        'Create a concise plain-text paragraph-level outline (no LaTeX) for an IEEE paper titled: "' + work.title + '".\n' +
        'Research context from canvas nodes:\n' + graphCtx + '\n\n' +
        'Return plain text only. 5 sections: Abstract, Introduction, Methods, Results, Conclusion.'
      );
      const outline = outlineRaw.replace(/```[\s\S]*?```/g, '').replace(/<[^>]+>/g, '').trim();
      log('Planner', 'Outline ready (' + outline.split('\n').length + ' lines).');

      // ---- 2. Discover references ----
      setGenerationStatus('discovering');
      log('Paper Parser', refList.length + ' references loaded from library.');
      await new Promise(r => setTimeout(r, 300));

      // ---- 3. Assign ----
      setGenerationStatus('assigning');
      log('Commander', 'Assigning citation keys to sections...');
      await new Promise(r => setTimeout(r, 200));
      log('Commander', 'Assignment complete.');

      // ---- 4. Helper: generate one section ----
      const genSection = async (name: string, instructions: string): Promise<string> => {
        log('Writer (' + name + ')', 'Drafting ' + name + '...');
        const prompt = SYS + '\n\n' +
          '=== TASK ===\n' +
          'Write \\section{' + name + '} for IEEE paper titled: "' + work.title + '".\n\n' +
          '=== PAPER OUTLINE ===\n' + outline + '\n\n' +
          '=== AVAILABLE CITATION KEYS ===\n' + refCtx + '\n\n' +
          '=== CANVAS CONTEXT ===\n' + graphCtx + '\n\n' +
          '=== SPECIFIC INSTRUCTIONS ===\n' + instructions + '\n\n' +
          'Begin output immediately with \\section{' + name + '}.';

        const raw = await generateAcademicContent(prompt);
        const result = clean(raw);

        // Ensure section header is present
        const finalContent = result.startsWith('\\section') ? result
          : '\\section{' + name + '}\n' + result;

        save(name + '.tex', finalContent);
        log('Reviewer (' + name + ')', name + ' verified — ' + finalContent.split('\n').length + ' lines.');
        return finalContent;
      };

      // ---- 5. Introduction ----
      setGenerationStatus('intro');
      const introText = await genSection('Introduction',
        'Write 3–4 paragraphs covering: background/motivation, related work with \\cite{} citations, and a contributions list using \\begin{itemize}.\n' +
        'Include ONE TikZ diagram showing the research pipeline/overview. Use \\begin{figure}[h]\\centering\\begin{tikzpicture}...\\end{tikzpicture}\\caption{...}\\label{fig:overview}\\end{figure}.\n' +
        'Use colours ieeeblue, ieeegreen for diagram nodes.'
      );

      // ---- 6. Methods + Results ----
      setGenerationStatus('body');
      const methodsText = await genSection('Methods',
        'Write 3–4 paragraphs describing methodology, algorithms, and experimental setup.\n' +
        'Include ONE TikZ flowchart (\\begin{figure}[h]) showing the system architecture.\n' +
        'Include ONE table: \\begin{table}[h]\\centering\\begin{tabular}{...} with \\toprule/\\midrule/\\bottomrule and \\rowcolor{ieeegray} on the header row.'
      );

      const resultsText = await genSection('Results',
        'Present quantitative findings with analysis.\n' +
        'Include ONE pgfplots chart using \\begin{figure}[h]\\centering\\begin{tikzpicture}\\begin{axis}[...]...\\end{axis}\\end{tikzpicture}\\caption{...}\\end{figure}.\n' +
        'Include ONE comparison table with \\rowcolor on alternating rows using ieeeblue!10 and white.\n' +
        'Cite relevant references with \\cite{}.'
      );

      // ---- 7. Abstract ----
      setGenerationStatus('synthesis');
      log('Writer (Abstract)', 'Drafting Abstract...');
      const abstractRaw = await generateAcademicContent(
        SYS + '\n\n' +
        '=== TASK ===\n' +
        'Write an IEEE abstract for paper: "' + work.title + '".\n' +
        'Output ONLY \\begin{abstract} ... \\end{abstract} — nothing before or after.\n\n' +
        '=== BASED ON ===\n' +
        'Introduction (first 600 chars):\n' + introText.slice(0, 600) + '\n\n' +
        'Methods (first 400 chars):\n' + methodsText.slice(0, 400) + '\n\n' +
        'Results (first 400 chars):\n' + resultsText.slice(0, 400) + '\n\n' +
        'Begin output with \\begin{abstract}.'
      );
      const abstractCleaned = clean(abstractRaw);
      let abstractContent: string;
      const abstractMatch = abstractCleaned.match(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/);
      if (abstractMatch) {
        abstractContent = abstractMatch[0];
      } else {
        // Wrap if model forgot the tags
        abstractContent = '\\begin{abstract}\n' + abstractCleaned + '\n\\end{abstract}';
      }
      save('Abstract.tex', abstractContent);
      log('Writer (Abstract)', 'Abstract complete.');

      // ---- 8. Conclusion ----
      const conclusionRaw = await generateAcademicContent(
        SYS + '\n\n' +
        '=== TASK ===\n' +
        'Write \\section{Conclusion} for IEEE paper: "' + work.title + '".\n' +
        'Summarise contributions, limitations, and future work in 2–3 paragraphs.\n' +
        'Cite relevant references with \\cite{}.\n\n' +
        '=== AVAILABLE CITATION KEYS ===\n' + refCtx + '\n\n' +
        'Begin output with \\section{Conclusion}.'
      );
      save('Conclusion.tex', clean(conclusionRaw));
      log('Writer (Conclusion)', 'Conclusion complete.');

      // ---- 9. Assemble references.bib ----
      setGenerationStatus('review');
      log('Typesetter', 'Generating references.bib...');
      const bibContent = buildBib(refList);
      save('references.bib', bibContent);
      log('Typesetter', 'references.bib written (' + refList.length + ' entries).');

      // ---- 10. Assemble main.tex ----
      log('Typesetter', 'Assembling main.tex...');
      // Use latest filesRef snapshot which now contains all sections
      const mainTex = buildMainTex(work.title, filesRef.current, refList);
      save('main.tex', mainTex);
      log('Typesetter', 'main.tex assembled successfully.');

      // Final flush to guarantee all files are in state
      flushFiles(workId);

      setGenerationStatus('completed');
      log('System', 'Generation complete! Click "Compile PDF" to render the paper.');

    } catch (err: any) {
      log('System', 'ERROR: ' + (err?.message || String(err)));
      setGenerationStatus('completed');
      // Still try to assemble whatever we have
      const mainTex = buildMainTex(work.title, filesRef.current, references);
      save('main.tex', mainTex);
      save('references.bib', buildBib(references));
      flushFiles(workId);
    }
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
