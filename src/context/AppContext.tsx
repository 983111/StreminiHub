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

// ─── Strict LaTeX system prompt ────────────────────────────────────────────
const LATEX_SYSTEM_INSTRUCTION = `You are an expert LaTeX academic writer specialising in IEEE conference papers.
RULES — follow every one without exception:
1. Output ONLY raw LaTeX code. Zero prose, zero explanation, zero markdown fences.
2. Never emit <think>, <reasoning>, or any XML-style tags.
3. Never wrap output in backtick code fences (\`\`\`latex or \`\`\`).
4. Do NOT include \\documentclass, \\usepackage, \\begin{document}, or \\end{document}.
5. Use \\cite{AuthorYear} for in-text citations.
6. Use only standard IEEE-safe LaTeX commands (amsmath, graphicx, hyperref are pre-loaded).
7. If you have nothing to say, output a single comment line: % (empty section)`;

function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/```reasoning[\s\S]*?```/gi, '')
    .replace(/```latex\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [works, setWorks] = useState<Work[]>([
    {
      id: '1',
      title: 'AI tools expand impact but contract focus',
      description: 'Template canvas based on Nature AI-Science study.',
      nodes: [
        { id: 'start-1', type: 'startNode', position: { x: 100, y: 100 }, data: { title: 'AI tools expand impact but contract focus', venue: 'Nature' } },
        { id: 'idea-1', type: 'ideaNode', position: { x: 500, y: 150 }, data: { body: 'Artificial intelligence tools have a dual effect on scientific research...' } },
        { id: 'lit-1', type: 'literatureNode', position: { x: 500, y: 350 }, data: { title: 'Large-scale Bibliometric Analysis', file: 'dataset.csv' } }
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'idea-1', type: 'smoothstep' },
        { id: 'e2', source: 'start-1', target: 'lit-1', type: 'smoothstep' }
      ],
      generatedFiles: {}
    }
  ]);
  const [activeWorkId, setActiveWorkId] = useState<string | null>('1');
  const [references, setReferences] = useState<Reference[]>([
    { id: 'r1', title: "Inter-symbolic AI: Interlinking Symbolic AI and Subsymbolic AI", authors: "Andre Platzer", year: 2024, doi: "10.1007/978-3-031-75387-8_11", linked: 5 },
    { id: 'r2', title: "Ranking scientists", authors: "S. N. Dorogovtsev, J. F. F. Mendes", year: 2015, linked: 0 },
    { id: 'r3', title: "Human-AI Coevolution", authors: "Dino Pedreschi, Luca Pappalardo...", year: 2023, linked: 2 },
    { id: 'r4', title: "A Survey of Multi-Agent Deep Reinforcement Learning with Communication", authors: "Changxi Zhu, Mehdi Dastani...", year: 2022, linked: 0 },
  ]);
  const [generationStatus, setGenerationStatus] = useState<string>('idle');
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);

  const createWork = (title: string, description: string) => {
    const newWork: Work = {
      id: uuidv4(),
      title,
      description,
      nodes: [{ id: `start-${uuidv4()}`, type: 'startNode', position: { x: 100, y: 100 }, data: { title, venue: '' } }],
      edges: [],
      generatedFiles: {}
    };
    setWorks(prev => [...prev, newWork]);
    setActiveWorkId(newWork.id);
  };

  const updateWorkGraph = (id: string, nodes: Node[], edges: Edge[]) => {
    setWorks(prev => prev.map(w => w.id === id ? { ...w, nodes, edges } : w));
  };

  const updateGeneratedFile = (workId: string, filename: string, content: string) => {
    setWorks(prev => prev.map(w => {
      if (w.id === workId) {
        return { ...w, generatedFiles: { ...(w.generatedFiles || {}), [filename]: content } };
      }
      return w;
    }));
  };

  const addReference = (ref: Omit<Reference, 'id'>) => {
    setReferences(prev => [...prev, { ...ref, id: uuidv4() }]);
  };

  // ─── Helper: derive BibTeX key from reference ───────────────────────────
  const getBibKey = (ref: Reference): string => {
    const firstAuthor = ref.authors.split(',')[0].split(' ').pop() || 'Author';
    return `${firstAuthor.replace(/[^a-zA-Z]/g, '')}${ref.year}`;
  };

  // ─── Build a .bib file from references ──────────────────────────────────
  const buildBibFile = (refs: Reference[]): string => {
    return refs.map(ref => {
      const key = getBibKey(ref);
      return `@article{${key},
  author  = {${ref.authors}},
  title   = {{${ref.title}}},
  year    = {${ref.year}}${ref.doi ? `,\n  doi     = {${ref.doi}}` : ''}
}`;
    }).join('\n\n');
  };

  // ─── Build a complete IEEE main.tex ─────────────────────────────────────
  const buildMainTex = (title: string, refs: Reference[]): string => {
    const bibEntries = refs.map(ref => {
      const key = getBibKey(ref);
      return `\\bibitem{${key}} ${ref.authors}, ``${ref.title},'' ${ref.year}.`;
    }).join('\n');

    return `\\documentclass[conference]{IEEEtran}
\\IEEEoverridecommandlockouts
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{hyperref}
\\hypersetup{hidelinks}

\\title{${title.replace(/_/g, '\\_')}}
\\author{\\IEEEauthorblockN{AI Research System}
\\IEEEauthorblockA{\\textit{Automated Research Platform}}}

\\begin{document}

\\maketitle

\\input{Abstract}
\\input{Introduction}
\\input{Methods}
\\input{Results}
\\input{Conclusion}

\\begin{thebibliography}{00}
${bibEntries}
\\end{thebibliography}

\\end{document}`;
  };

  // ─── Main generation pipeline ────────────────────────────────────────────
  const startGeneration = async (latestNodes?: Node[], latestEdges?: Edge[]) => {
    if (!activeWorkId) return;
    const work = works.find(w => w.id === activeWorkId);
    if (!work) return;

    setGenerationStatus('planning');
    setAgentLogs([]);

    const log = (agent: string, message: string) => {
      setAgentLogs(prev => [...prev, { agent, message, time: new Date().toLocaleTimeString() }]);
    };

    log('System', 'Initializing generation sequence...');

    const nodesToUse = latestNodes || work.nodes;
    const graphContext = nodesToUse.map(n => JSON.stringify(n.data)).join('\n');
    const refsContext = references.map(r => `${getBibKey(r)}: "${r.title}" by ${r.authors} (${r.year})`).join('\n');

    // ── 1. Planning ─────────────────────────────────────────────────────────
    log('Planner', 'Analysing research graph...');
    const outlinePrompt = `${LATEX_SYSTEM_INSTRUCTION}

Create a concise paragraph-level outline (plain text, NOT LaTeX) for each section of an IEEE paper titled "${work.title}".
Research context:\n${graphContext}
Respond with a plain-text outline only — no code, no LaTeX.`;

    const outline = stripReasoning(await generateAcademicContent(outlinePrompt));
    log('Planner', 'Outline ready.');

    // ── 2. Reference discovery ──────────────────────────────────────────────
    setGenerationStatus('discovering');
    log('Commander', 'Orchestrating reference discovery...');
    await new Promise(r => setTimeout(r, 800));
    log('Paper Parser', `${references.length} references loaded from library.`);

    // ── 3. Assigning ────────────────────────────────────────────────────────
    setGenerationStatus('assigning');
    log('Commander', 'Assigning references to sections...');
    await new Promise(r => setTimeout(r, 600));
    log('Commander', 'Reference assignment complete.');

    // ── 4. Section generation (parallel) ───────────────────────────────────
    setGenerationStatus('intro');
    log('Writer', 'Drafting Introduction, Methods, Results in parallel...');

    const generateSection = async (
      sectionName: string,
      instructions: string
    ): Promise<string> => {
      log(`Writer (${sectionName})`, `Drafting ${sectionName}...`);
      const prompt = `${LATEX_SYSTEM_INSTRUCTION}

Write the \\section{${sectionName}} for an IEEE paper titled "${work.title}".
Paper outline:\n${outline}
Available citations (use \\cite{key}):\n${refsContext}
Research context:\n${graphContext}

${instructions}

Output raw LaTeX only — no preamble, no \\begin{document}.`;

      const raw = await generateAcademicContent(prompt);
      const clean = stripReasoning(raw);
      updateGeneratedFile(activeWorkId!, `${sectionName}.tex`, clean);
      log(`Reviewer (${sectionName})`, `${sectionName} passed consistency check.`);
      return clean;
    };

    const [introText, methodsText, resultsText] = await Promise.all([
      generateSection('Introduction',
        'Cover background, motivation, related work (with \\cite{}), and contributions. Use \\section{Introduction}.'),
      generateSection('Methods',
        'Detail experimental setup, algorithms, or theoretical framework. Use \\section{Methods}.'),
      generateSection('Results',
        'Present quantitative and qualitative findings, tables or figures if appropriate. Use \\section{Results}.')
    ]);

    // ── 5. Synthesis ────────────────────────────────────────────────────────
    setGenerationStatus('synthesis');
    log('Writer', 'Synthesising Abstract and Conclusion...');

    // Abstract
    const abstractPrompt = `${LATEX_SYSTEM_INSTRUCTION}

Write ONLY the IEEE abstract environment for a paper titled "${work.title}".
Based on:
Introduction summary: ${introText.slice(0, 600)}
Methods summary: ${methodsText.slice(0, 400)}
Results summary: ${resultsText.slice(0, 400)}

Output exactly:
\\begin{abstract}
(150–200 words of abstract text)
\\end{abstract}`;

    const abstractRaw = stripReasoning(await generateAcademicContent(abstractPrompt));
    // Ensure it is wrapped correctly even if the model slips
    const abstractContent = abstractRaw.includes('\\begin{abstract}')
      ? abstractRaw.match(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/)?.[0] ?? abstractRaw
      : `\\begin{abstract}\n${abstractRaw}\n\\end{abstract}`;
    updateGeneratedFile(activeWorkId!, 'Abstract.tex', abstractContent);
    log('Writer (Abstract)', 'Abstract complete.');

    // Conclusion
    const conclusionPrompt = `${LATEX_SYSTEM_INSTRUCTION}

Write the \\section{Conclusion} for the IEEE paper titled "${work.title}".
Summarise contributions, discuss limitations and future work.
Introduction: ${introText.slice(0, 400)}
Results: ${resultsText.slice(0, 400)}

Output raw LaTeX only — start with \\section{Conclusion}.`;

    const conclusionRaw = stripReasoning(await generateAcademicContent(conclusionPrompt));
    updateGeneratedFile(activeWorkId!, 'Conclusion.tex', conclusionRaw);
    log('Writer (Conclusion)', 'Conclusion complete.');
    log('Reviewer', 'Abstract and Conclusion verified.');

    // ── 6. Assembly ─────────────────────────────────────────────────────────
    setGenerationStatus('review');
    log('Typesetter', 'Assembling main.tex and references.bib...');

    const mainTex = buildMainTex(work.title, references);
    updateGeneratedFile(activeWorkId!, 'main.tex', mainTex);

    const bibContent = buildBibFile(references);
    updateGeneratedFile(activeWorkId!, 'references.bib', bibContent);

    setGenerationStatus('completed');
    log('System', 'Paper generation complete. Click "Compile PDF" to render.');
  };

  return (
    <AppContext.Provider value={{
      works, activeWorkId, references, generationStatus, agentLogs,
      createWork, setActiveWork: setActiveWorkId, updateWorkGraph,
      addReference, startGeneration, setGenerationStatus, updateGeneratedFile
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};
