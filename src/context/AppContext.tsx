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
// BibTeX key: LastName + Year
// ---------------------------------------------------------------------------
function bibKey(ref: Reference): string {
  const last = ref.authors.split(',')[0].trim().split(' ').pop() || 'Author';
  return last.replace(/[^a-zA-Z]/g, '') + ref.year;
}

// ---------------------------------------------------------------------------
// Aggressive clean: strip preamble, markdown, reasoning, package commands
// ---------------------------------------------------------------------------
function clean(raw: string): string {
  let s = raw;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  s = s.replace(/```[\w]*\n?/gi, '');
  s = s.replace(/```/g, '');
  s = s.replace(/\\documentclass[\s\S]*?\\begin\{document\}/g, '');
  s = s.replace(/\\end\{document\}/g, '');
  s = s.replace(/^\\usepackage(\[[^\]]*\])?\{[^}]+\}[ \t]*\n?/gm, '');
  s = s.replace(/^\\usetikzlibrary[^\n]*\n?/gm, '');
  s = s.replace(/^\\pgfplotsset[^\n]*\n?/gm, '');
  s = s.replace(/^\\definecolor[^\n]*\n?/gm, '');
  s = s.replace(/^\\setlength[^\n]*\n?/gm, '');
  s = s.replace(/^\\geometry[^\n]*\n?/gm, '');
  s = s.replace(/^\\maketitle[ \t]*\n?/gm, '');
  s = s.replace(/^\\title\{[^}]*\}[ \t]*\n?/gm, '');
  s = s.replace(/^\\author[\s\S]*?\}[ \t]*\n?/gm, '');
  s = s.replace(/^\\date\{[^}]*\}[ \t]*\n?/gm, '');
  // Remove any tikzpicture or axis environments that slipped through
  s = s.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, '% [diagram removed for compatibility]');
  s = s.replace(/\\begin\{axis\}[\s\S]*?\\end\{axis\}/g, '% [chart removed for compatibility]');
  return s.trim();
}

// ---------------------------------------------------------------------------
// Build references.bib
// ---------------------------------------------------------------------------
function buildBib(refs: Reference[]): string {
  if (!refs.length) return '% No references added.';
  return refs.map(r => {
    const k = bibKey(r);
    const lines = [
      '@article{' + k + ',',
      '  author  = {' + r.authors + '},',
      '  title   = {{' + r.title + '}},',
      '  year    = {' + r.year + '},',
      '  journal = {Proceedings},',
      '  pages   = {1--10}',
    ];
    if (r.doi) lines.splice(lines.length - 1, 0, '  doi     = {' + r.doi + '},');
    lines.push('}');
    return lines.join('\n');
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Build complete IEEE main.tex — all sections inlined, no \input commands
// ---------------------------------------------------------------------------
function buildMainTex(title: string, files: Record<string, string>, refs: Reference[]): string {
  const safeTitle = title
    .replace(/\\/g, '')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\$/g, '\\$')
    .replace(/\^/g, '\\^{}')
    .replace(/#/g, '\\#')
    .replace(/~/g, '\\~{}');

  const order = ['Abstract', 'Introduction', 'Methods', 'Results', 'Conclusion'];
  const bodyParts: string[] = [];
  for (const sec of order) {
    const content = (files[sec + '.tex'] || '').trim();
    if (content) {
      bodyParts.push('%% ======== ' + sec.toUpperCase() + ' ========');
      bodyParts.push(content);
    }
  }

  const bibItems = refs.map(r => {
    const k = bibKey(r);
    const safeTitleRef = r.title.replace(/[{}\\]/g, '');
    const doiLine = r.doi ? ' \\url{' + r.doi + '}.' : '';
    return '\\bibitem{' + k + '}\n' +
      r.authors + ', ``' + safeTitleRef + ",''\n" +
      r.year + '.' + doiLine;
  }).join('\n\n');

  const numPad = String(Math.max(refs.length, 1)).padStart(2, '0');

  return `\\documentclass[conference]{IEEEtran}
\\IEEEoverridecommandlockouts
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{algorithmic}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{multirow}
\\usepackage{url}
\\def\\BibTeX{{\\rm B\\kern-.05em{\\sc i\\kern-.025em b}\\kern-.08em
    T\\kern-.1667em\\lower.7ex\\hbox{E}\\kern-.125em{X}}}

\\begin{document}

\\title{${safeTitle}}

\\author{\\IEEEauthorblockN{AI Research System}
\\IEEEauthorblockA{\\textit{Automated Research Platform} \\\\
research@ai-system.org}}

\\maketitle

${bodyParts.join('\n\n')}

\\begin{thebibliography}{${numPad}}
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
        { id: 'idea-1', type: 'ideaNode', position: { x: 500, y: 150 }, data: { body: 'AI tools have a dual effect on scientific research: they expand citation reach but narrow topical focus toward established areas.' } },
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

  // Ref-based accumulator — avoids React stale closure issues across async calls
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
      w.id === workId ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), [filename]: content } } : w
    ));

  const addReference = (ref: Omit<Reference, 'id'>) =>
    setReferences(prev => [...prev, { ...ref, id: uuidv4() }]);

  // Write to ref accumulator AND React state atomically
  const saveFile = (workId: string, filename: string, content: string) => {
    const trimmed = content.trim();
    filesRef.current[filename] = trimmed;
    setWorks(prev => prev.map(w =>
      w.id === workId
        ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), [filename]: trimmed } }
        : w
    ));
  };

  // ---------------------------------------------------------------------------
  // Generation pipeline — SAFE LaTeX (no TikZ, no pgfplots)
  // ---------------------------------------------------------------------------
  const startGeneration = async (latestNodes?: Node[], latestEdges?: Edge[]) => {
    if (!activeWorkId) return;
    const work = works.find(w => w.id === activeWorkId);
    if (!work) return;

    filesRef.current = {};
    const workId = activeWorkId;

    setGenerationStatus('planning');
    setAgentLogs([]);

    const log = (agent: string, message: string) =>
      setAgentLogs(prev => [...prev, { agent, message, time: new Date().toLocaleTimeString() }]);

    // -----------------------------------------------------------------------
    // SYSTEM PROMPT — absolutely no TikZ/pgfplots
    // -----------------------------------------------------------------------
    const SYS = `You are an expert IEEE LaTeX academic paper writer.

STRICTLY FORBIDDEN — never include these (they cause compile errors):
- Backtick fences: \`\`\`latex, \`\`\`, \`\`\`tex
- \\documentclass, \\usepackage, \\begin{document}, \\end{document}
- \\definecolor, \\usetikzlibrary, \\pgfplotsset
- \\maketitle, \\title{}, \\author{}, \\date{}
- tikzpicture environment or any TikZ commands
- pgfplots / \\begin{axis} environments
- <think>, <reasoning>, <thinking> tags or any XML/HTML
- Any explanatory text outside LaTeX commands

ALLOWED LaTeX commands:
- \\section{}, \\subsection{}, paragraph text
- \\begin{itemize}, \\begin{enumerate}, \\item
- \\begin{equation}, inline $math$, \\begin{align}
- \\begin{table}[h], \\begin{tabular}, \\hline, \\toprule, \\midrule, \\bottomrule
- \\textbf{}, \\textit{}, \\emph{}, \\cite{key}
- \\begin{abstract}...\\end{abstract}
- \\label{}, \\ref{}

OUTPUT: Start DIRECTLY with the first LaTeX command. Nothing before it.`;

    try {
      const nodes = latestNodes || work.nodes;
      const graphCtx = nodes.map(n => {
        const d = n.data as any;
        return [d.title, d.body, d.venue, d.file].filter(Boolean).join(' ');
      }).filter(Boolean).join('. ');

      const refList = references;
      const refCtx = refList.map(r =>
        '  Key: \\cite{' + bibKey(r) + '} → "' + r.title + '" by ' + r.authors + ' (' + r.year + ')'
      ).join('\n');

      // ---- 1. Outline (plain text) --------------------------------------
      log('Planner', 'Generating paper outline...');
      const outlineRaw = await generateAcademicContent(
        'Write a plain-text bullet-point outline for an IEEE paper titled:\n' +
        '"' + work.title + '"\n\n' +
        'Research context: ' + graphCtx + '\n\n' +
        'Format: 5 sections with 3-5 bullets each: Introduction, Methods, Results, Discussion, Conclusion.\n' +
        'Plain text only. No LaTeX. No markdown formatting.'
      );
      const outline = outlineRaw.replace(/<[^>]+>/g, '').replace(/`/g, '').trim();
      log('Planner', 'Outline complete.');

      setGenerationStatus('discovering');
      log('Paper Parser', refList.length + ' references loaded.');
      await new Promise(r => setTimeout(r, 200));

      setGenerationStatus('assigning');
      log('Commander', 'Citation keys: ' + refList.map(r => bibKey(r)).join(', '));
      await new Promise(r => setTimeout(r, 150));

      // ---- 2. Section generator ----------------------------------------
      const genSection = async (secName: string, task: string): Promise<string> => {
        log('Writer', 'Writing ' + secName + '...');
        const prompt =
          SYS + '\n\n' +
          'PAPER TITLE: "' + work.title + '"\n\n' +
          'OUTLINE:\n' + outline + '\n\n' +
          'CITATION KEYS AVAILABLE:\n' + refCtx + '\n\n' +
          'CONTEXT: ' + graphCtx + '\n\n' +
          'TASK: ' + task + '\n\n' +
          'REMINDER: No tikzpicture. No pgfplots. No \\usepackage. No markdown fences.\n' +
          'Start output immediately with \\section{' + secName + '}.';

        const raw = await generateAcademicContent(prompt);
        let result = clean(raw);

        // Ensure section header exists
        if (!result.startsWith('\\section')) {
          result = '\\section{' + secName + '}\n' + result;
        }

        saveFile(workId, secName + '.tex', result);
        log('Reviewer', secName + ' verified (' + result.split('\n').length + ' lines).');
        return result;
      };

      // ---- 3. Generate all sections ------------------------------------
      setGenerationStatus('intro');
      const introText = await genSection('Introduction',
        'Write a comprehensive introduction with:\n' +
        '1. Background and motivation paragraph (3-4 sentences)\n' +
        '2. Related work paragraph with \\cite{} citations for at least 2 of the available keys\n' +
        '3. Problem statement paragraph\n' +
        '4. Contributions as \\begin{itemize}\\item ...\\end{itemize}\n' +
        'Use \\cite{key} inline for citations. Tables are ok. NO tikzpicture.'
      );

      setGenerationStatus('body');
      const methodsText = await genSection('Methods',
        'Write a detailed methodology section with:\n' +
        '1. Overview paragraph of the proposed approach\n' +
        '2. Detailed methodology paragraphs (2-3)\n' +
        '3. One table showing system parameters or components:\n' +
        '   \\begin{table}[h]\\centering\\caption{...}\\begin{tabular}{|l|l|l|}\\hline...\\hline\\end{tabular}\\end{table}\n' +
        'Use \\cite{} where appropriate. NO tikzpicture. NO pgfplots.'
      );

      const resultsText = await genSection('Results',
        'Write a results section with:\n' +
        '1. Experimental setup paragraph\n' +
        '2. Main results paragraph with numerical data\n' +
        '3. One comparison table:\n' +
        '   \\begin{table}[h]\\centering\\caption{Comparison of methods}\\begin{tabular}{lccc}\\toprule\n' +
        '   Method & Accuracy & Precision & Recall \\\\\\midrule\n' +
        '   [fill with realistic numbers]\\\\\\bottomrule\\end{tabular}\\end{table}\n' +
        '4. Analysis paragraph citing \\cite{} keys\n' +
        'NO tikzpicture. NO pgfplots. Tables only for visuals.'
      );

      // ---- 4. Abstract -------------------------------------------------
      setGenerationStatus('synthesis');
      log('Writer', 'Writing Abstract...');
      const absRaw = await generateAcademicContent(
        SYS + '\n\n' +
        'Write an IEEE abstract for: "' + work.title + '"\n\n' +
        'Based on these snippets:\n' +
        'Intro: ' + introText.slice(0, 400) + '\n' +
        'Methods: ' + methodsText.slice(0, 300) + '\n' +
        'Results: ' + resultsText.slice(0, 300) + '\n\n' +
        'Output ONLY \\begin{abstract}\\n...content...\\n\\end{abstract}\n' +
        '150-200 words. No \\section heading. No tikzpicture.'
      );
      let absCleaned = clean(absRaw);
      const absMatch = absCleaned.match(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/);
      const abstractContent = absMatch
        ? absMatch[0]
        : '\\begin{abstract}\n' + absCleaned.replace(/^\\section\{[^}]*\}\s*/i, '') + '\n\\end{abstract}';
      saveFile(workId, 'Abstract.tex', abstractContent);
      log('Writer', 'Abstract done.');

      // ---- 5. Conclusion -----------------------------------------------
      log('Writer', 'Writing Conclusion...');
      const conclRaw = await generateAcademicContent(
        SYS + '\n\n' +
        'Write \\section{Conclusion} for: "' + work.title + '"\n\n' +
        'Citation keys:\n' + refCtx + '\n\n' +
        '2-3 paragraphs: summary of contributions, limitations, future directions.\n' +
        'Use \\cite{} at least once. NO tikzpicture. NO pgfplots.\n' +
        'Start with \\section{Conclusion}.'
      );
      saveFile(workId, 'Conclusion.tex', clean(conclRaw));
      log('Writer', 'Conclusion done.');

      // ---- 6. Assemble -------------------------------------------------
      setGenerationStatus('review');
      log('Typesetter', 'Building references.bib...');
      saveFile(workId, 'references.bib', buildBib(refList));
      log('Typesetter', refList.length + ' entries written to references.bib.');

      log('Typesetter', 'Assembling main.tex...');
      const mainTex = buildMainTex(work.title, filesRef.current, refList);
      saveFile(workId, 'main.tex', mainTex);
      log('Typesetter', 'main.tex ready — ' + mainTex.split('\n').length + ' lines.');

      setGenerationStatus('completed');
      log('System', 'Generation complete! Select main.tex and click "Compile PDF".');

    } catch (err: any) {
      log('System', 'ERROR: ' + (err?.message || String(err)));
      // Emergency assembly with whatever content was generated
      saveFile(workId, 'references.bib', buildBib(references));
      const emergencyMain = buildMainTex(work.title, filesRef.current, references);
      saveFile(workId, 'main.tex', emergencyMain);
      setGenerationStatus('completed');
      log('System', 'Emergency assembly complete — some sections may be missing.');
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
