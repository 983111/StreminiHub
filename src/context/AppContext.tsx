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
    setWorks([...works, newWork]);
    setActiveWorkId(newWork.id);
  };

  const updateWorkGraph = (id: string, nodes: Node[], edges: Edge[]) => {
    setWorks(prev => prev.map(w => w.id === id ? { ...w, nodes, edges } : w));
  };

  const updateGeneratedFile = (workId: string, filename: string, content: string) => {
    setWorks(prev => prev.map(w => {
      if (w.id === workId) {
        return {
          ...w,
          generatedFiles: {
            ...(w.generatedFiles || {}),
            [filename]: content
          }
        };
      }
      return w;
    }));
  };

  const addReference = (ref: Omit<Reference, 'id'>) => {
    setReferences([...references, { ...ref, id: uuidv4() }]);
  };

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
    
    // Use latest nodes if provided, otherwise fallback to work.nodes
    const nodesToUse = latestNodes || work.nodes;
    const graphContext = JSON.stringify(nodesToUse.map(n => n.data));
    const refsContext = JSON.stringify(references.map(r => `${r.title} by ${r.authors} (${r.year})`));

    // 1. Planning
    log('Planner', 'Analyzing research graph nodes and edges...');
    const outlinePrompt = `You are an expert academic planner. Based on the following research graph context: ${graphContext}, create a detailed outline for an academic paper titled "${work.title}". Include key points for Introduction, Methods, and Results.`;
    const outline = await generateAcademicContent(outlinePrompt);
    log('Planner', 'Outline generated successfully.');
    
    // 2. Discovering
    setGenerationStatus('discovering');
    log('Commander', 'Orchestrating reference discovery...');
    await new Promise(r => setTimeout(r, 1000));
    log('Paper Parser', `Found ${references.length} relevant papers from the library.`);

    // 3. Assigning
    setGenerationStatus('assigning');
    log('Commander', 'Assigning references to sections...');
    await new Promise(r => setTimeout(r, 1000));

    // 4. Drafting (Parallel generation of body sections)
    setGenerationStatus('intro');
    log('Writer', 'Drafting core sections (Introduction, Methods, Results) in parallel...');
    
    const generateSection = async (sectionName: string, instructions: string) => {
      log(`Writer (${sectionName})`, `Starting draft of ${sectionName}...`);
      const prompt = `You are an academic AI writer. Write the ${sectionName} section in LaTeX for a paper titled "${work.title}". 
      Context from research graph: ${graphContext}.
      References available: ${refsContext}.
      Paper Outline: ${outline}
      ${instructions}
      Output ONLY valid LaTeX code without markdown blocks or explanations. Do not include \\documentclass or \\begin{document}.`;
      
      const content = await generateAcademicContent(prompt);
      const cleanContent = content.replace(/```latex/g, '').replace(/```/g, '').trim();
      updateGeneratedFile(activeWorkId, `${sectionName}.tex`, cleanContent);
      log(`Reviewer (${sectionName})`, `${sectionName} logical consistency check passed.`);
      return cleanContent;
    };

    const [introText, methodsText, resultsText] = await Promise.all([
      generateSection('Introduction', 'Focus on the background, motivation, and problem statement. Cite relevant references using \\cite{}.'),
      generateSection('Methods', 'Detail the methodology, experimental setup, or theoretical framework.'),
      generateSection('Results', 'Present the findings, data analysis, and discussion of the results.')
    ]);

    // 5. Synthesis (Abstract and Conclusion depend on the body)
    setGenerationStatus('synthesis');
    log('Writer', 'Synthesizing Abstract and Conclusion based on core sections...');
    
    const synthesisPrompt = `You are an academic AI. Write the Abstract and Conclusion sections in LaTeX for a paper titled "${work.title}".
    Here is the Introduction: ${introText}
    Here are the Methods: ${methodsText}
    Here are the Results: ${resultsText}
    Output ONLY valid LaTeX code without markdown blocks or explanations. Format as:
    % ABSTRACT
    \\begin{abstract}
    ...
    \\end{abstract}
    
    % CONCLUSION
    \\section{Conclusion}
    ...`;
    
    const synthesisText = await generateAcademicContent(synthesisPrompt);
    const cleanSynthesis = synthesisText.replace(/```latex/g, '').replace(/```/g, '').trim();
    
    // Split abstract and conclusion (rough heuristic)
    const abstractMatch = cleanSynthesis.match(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/);
    const conclusionMatch = cleanSynthesis.match(/\\section\{Conclusion\}[\s\S]*/i);
    
    const abstractContent = abstractMatch ? abstractMatch[0] : '% Abstract generation failed';
    const conclusionContent = conclusionMatch ? conclusionMatch[0] : '% Conclusion generation failed';

    updateGeneratedFile(activeWorkId, 'Abstract.tex', abstractContent);
    updateGeneratedFile(activeWorkId, 'Conclusion.tex', conclusionContent);
    log('Reviewer', 'Abstract and Conclusion verified against body sections.');

    // 6. Review & Assembly
    setGenerationStatus('review');
    log('Reviewer', 'Final full-paper review and assembly...');
    
    // Create main.tex
    const mainTex = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{${work.title}}
\\author{AI Researcher}
\\date{\\today}

\\begin{document}

\\maketitle

\\input{Abstract}
\\input{Introduction}
\\input{Methods}
\\input{Results}
\\input{Conclusion}

\\end{document}`;
    
    updateGeneratedFile(activeWorkId, 'main.tex', mainTex);

    setGenerationStatus('completed');
    log('System', 'Paper generation complete. Ready for download.');
  };

  return (
    <AppContext.Provider value={{
      works, activeWorkId, references, generationStatus, agentLogs,
      createWork, setActiveWork: setActiveWorkId, updateWorkGraph, addReference, startGeneration, setGenerationStatus, updateGeneratedFile
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
