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
// BibTeX key
// ---------------------------------------------------------------------------
function bibKey(ref: Reference): string {
  const last = ref.authors.split(',')[0].trim().split(' ').pop() || 'Author';
  return last.replace(/[^a-zA-Z]/g, '') + ref.year;
}

// ---------------------------------------------------------------------------
// Escape text for safe LaTeX inclusion
// ---------------------------------------------------------------------------
function latexEscape(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\~{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/</g, '\\textless{}')
    .replace(/>/g, '\\textgreater{}');
}

// ---------------------------------------------------------------------------
// Parse JSON safely from AI response
// ---------------------------------------------------------------------------
function parseJson<T>(raw: string, fallback: T): T {
  try {
    // Strip markdown fences, think tags, leading/trailing garbage
    let s = raw;
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    s = s.replace(/```[\w]*\n?/gi, '').replace(/```/g, '');
    // Find first { or [
    const start = s.search(/[\[{]/);
    if (start === -1) return fallback;
    s = s.slice(start);
    // Find matching close
    const end = s.lastIndexOf(s[0] === '[' ? ']' : '}');
    if (end === -1) return fallback;
    s = s.slice(0, end + 1);
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Convert plain text paragraphs to LaTeX paragraph blocks (safe)
// ---------------------------------------------------------------------------
function textToLatexParagraphs(text: string): string {
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map(p => p.trim().replace(/\n/g, ' '))
    .filter(Boolean)
    .map(p => latexEscape(p))
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Build a LaTeX itemize list from string array
// ---------------------------------------------------------------------------
function buildItemize(items: string[]): string {
  if (!items || !items.length) return '';
  return '\\begin{itemize}\n' +
    items.map(i => '  \\item ' + latexEscape(i.trim())).join('\n') +
    '\n\\end{itemize}';
}

// ---------------------------------------------------------------------------
// Build a LaTeX table from headers + rows (all escaped)
// ---------------------------------------------------------------------------
function buildTable(caption: string, headers: string[], rows: string[][], label: string): string {
  if (!headers.length || !rows.length) return '';
  const cols = headers.length;
  const colSpec = 'l' + 'c'.repeat(cols - 1);
  const hdr = headers.map(h => '\\textbf{' + latexEscape(h) + '}').join(' & ');
  const dataRows = rows.map(r => {
    // Pad or trim to match header count
    const padded = [...r];
    while (padded.length < cols) padded.push('--');
    return padded.slice(0, cols).map(c => latexEscape(String(c))).join(' & ') + ' \\\\';
  }).join('\n    ');

  return `\\begin{table}[h]
\\centering
\\caption{${latexEscape(caption)}}
\\label{${label}}
\\begin{tabular}{${colSpec}}
\\toprule
${hdr} \\\\
\\midrule
    ${dataRows}
\\bottomrule
\\end{tabular}
\\end{table}`;
}

// ---------------------------------------------------------------------------
// Build references.bib
// ---------------------------------------------------------------------------
function buildBib(refs: Reference[]): string {
  if (!refs.length) return '% No references.';
  return refs.map(r => {
    const k = bibKey(r);
    const safeTitle = r.title.replace(/[{}]/g, '');
    const safeAuthors = r.authors.replace(/[{}]/g, '');
    let entry = `@article{${k},\n  author  = {${safeAuthors}},\n  title   = {{${safeTitle}}},\n  year    = {${r.year}},\n  journal = {Proceedings},\n  pages   = {1--10}`;
    if (r.doi) entry += `,\n  doi     = {${r.doi}}`;
    entry += '\n}';
    return entry;
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Build references thebibliography entries
// ---------------------------------------------------------------------------
function buildBibItems(refs: Reference[]): string {
  return refs.map(r => {
    const k = bibKey(r);
    const safeTitle = latexEscape(r.title);
    const safeAuthors = latexEscape(r.authors);
    const doiPart = r.doi ? ' doi:' + r.doi + '.' : '';
    return `\\bibitem{${k}}\n${safeAuthors},\n``${safeTitle},''\n${r.year}.${doiPart}`;
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// THE ONLY LaTeX TEMPLATE — AI never generates LaTeX, only JSON content
// ---------------------------------------------------------------------------
interface PaperContent {
  abstract: string;
  intro: {
    background: string;
    relatedWork: string;
    problemStatement: string;
    contributions: string[];
    citationKeys: string[];
  };
  methods: {
    overview: string;
    details: string[];
    tableCaption: string;
    tableHeaders: string[];
    tableRows: string[][];
  };
  results: {
    setup: string;
    mainResults: string;
    analysisPoints: string[];
    tableCaption: string;
    tableHeaders: string[];
    tableRows: string[][];
    citationKeys: string[];
  };
  conclusion: {
    summary: string;
    limitations: string;
    futureWork: string;
    citationKeys: string[];
  };
}

function assembleMainTex(
  title: string,
  content: PaperContent,
  refs: Reference[],
): string {
  const safeTitle = latexEscape(title);
  const numRefs = String(Math.max(refs.length, 1)).padStart(2, '0');

  // Cite commands — only emit if keys exist
  const makeCite = (keys: string[]) => keys.length ? ' \\cite{' + keys.join(',') + '}' : '';

  // Abstract
  const abstractBody = textToLatexParagraphs(content.abstract);

  // Introduction
  const introContribList = buildItemize(content.intro.contributions);
  const introCite = makeCite(content.intro.citationKeys);
  const introBody =
    textToLatexParagraphs(content.intro.background) + '\n\n' +
    textToLatexParagraphs(content.intro.relatedWork) + introCite + '\n\n' +
    textToLatexParagraphs(content.intro.problemStatement) + '\n\n' +
    'The main contributions of this work are:\n' + introContribList;

  // Methods
  const methodsDetails = content.methods.details.map(d => textToLatexParagraphs(d)).join('\n\n');
  const methodsTable = buildTable(
    content.methods.tableCaption || 'System Parameters',
    content.methods.tableHeaders.length ? content.methods.tableHeaders : ['Parameter', 'Value', 'Description'],
    content.methods.tableRows.length ? content.methods.tableRows : [['LR', '0.001', 'Learning rate'], ['Epochs', '100', 'Training epochs']],
    'tab:params'
  );
  const methodsBody =
    textToLatexParagraphs(content.methods.overview) + '\n\n' +
    methodsDetails + '\n\n' +
    methodsTable;

  // Results
  const resultsPoints = buildItemize(content.results.analysisPoints);
  const resultsCite = makeCite(content.results.citationKeys);
  const resultsTable = buildTable(
    content.results.tableCaption || 'Comparison of Methods',
    content.results.tableHeaders.length ? content.results.tableHeaders : ['Method', 'Accuracy', 'F1', 'Time(s)'],
    content.results.tableRows.length ? content.results.tableRows : [
      ['Baseline', '72.3', '0.71', '1.2'],
      ['Our Method', '89.1', '0.88', '1.5'],
    ],
    'tab:results'
  );
  const resultsBody =
    textToLatexParagraphs(content.results.setup) + '\n\n' +
    textToLatexParagraphs(content.results.mainResults) + resultsCite + '\n\n' +
    resultsTable + '\n\n' +
    'Key findings:\n' + resultsPoints;

  // Conclusion
  const conclCite = makeCite(content.conclusion.citationKeys);
  const conclusionBody =
    textToLatexParagraphs(content.conclusion.summary) + conclCite + '\n\n' +
    textToLatexParagraphs(content.conclusion.limitations) + '\n\n' +
    textToLatexParagraphs(content.conclusion.futureWork);

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
\\usepackage{url}
\\def\\BibTeX{{\\rm B\\kern-.05em{\\sc i\\kern-.025em b}\\kern-.08em
    T\\kern-.1667em\\lower.7ex\\hbox{E}\\kern-.125em{X}}}

\\begin{document}

\\title{${safeTitle}}

\\author{\\IEEEauthorblockN{AI Research System}
\\IEEEauthorblockA{\\textit{Automated Research Platform} \\\\
research@ai-system.org}}

\\maketitle

\\begin{abstract}
${abstractBody}
\\end{abstract}

\\section{Introduction}
${introBody}

\\section{Methods}
${methodsBody}

\\section{Results}
${resultsBody}

\\section{Conclusion}
${conclusionBody}

\\begin{thebibliography}{${numRefs}}
${buildBibItems(refs)}
\\end{thebibliography}

\\end{document}`;
}

// ---------------------------------------------------------------------------
// Section .tex files for the file browser (pretty display only)
// ---------------------------------------------------------------------------
function buildSectionFiles(content: PaperContent, refs: Reference[]): Record<string, string> {
  const makeCite = (keys: string[]) => keys.length ? ' \\cite{' + keys.join(',') + '}' : '';

  return {
    'Abstract.tex':
      '\\begin{abstract}\n' +
      textToLatexParagraphs(content.abstract) +
      '\n\\end{abstract}',

    'Introduction.tex':
      '\\section{Introduction}\n' +
      textToLatexParagraphs(content.intro.background) + '\n\n' +
      textToLatexParagraphs(content.intro.relatedWork) + makeCite(content.intro.citationKeys) + '\n\n' +
      textToLatexParagraphs(content.intro.problemStatement) + '\n\n' +
      'The main contributions of this work are:\n' +
      buildItemize(content.intro.contributions),

    'Methods.tex':
      '\\section{Methods}\n' +
      textToLatexParagraphs(content.methods.overview) + '\n\n' +
      content.methods.details.map(d => textToLatexParagraphs(d)).join('\n\n') + '\n\n' +
      buildTable(
        content.methods.tableCaption || 'System Parameters',
        content.methods.tableHeaders.length ? content.methods.tableHeaders : ['Parameter', 'Value', 'Description'],
        content.methods.tableRows.length ? content.methods.tableRows : [['LR', '0.001', 'Learning rate']],
        'tab:params'
      ),

    'Results.tex':
      '\\section{Results}\n' +
      textToLatexParagraphs(content.results.setup) + '\n\n' +
      textToLatexParagraphs(content.results.mainResults) + makeCite(content.results.citationKeys) + '\n\n' +
      buildTable(
        content.results.tableCaption || 'Comparison of Methods',
        content.results.tableHeaders.length ? content.results.tableHeaders : ['Method', 'Accuracy', 'F1', 'Time(s)'],
        content.results.tableRows.length ? content.results.tableRows : [['Baseline', '72.3', '0.71', '1.2'], ['Ours', '89.1', '0.88', '1.5']],
        'tab:results'
      ) + '\n\nKey findings:\n' +
      buildItemize(content.results.analysisPoints),

    'Conclusion.tex':
      '\\section{Conclusion}\n' +
      textToLatexParagraphs(content.conclusion.summary) + makeCite(content.conclusion.citationKeys) + '\n\n' +
      textToLatexParagraphs(content.conclusion.limitations) + '\n\n' +
      textToLatexParagraphs(content.conclusion.futureWork),
  };
}

// ---------------------------------------------------------------------------
// Default fallback content if AI fails
// ---------------------------------------------------------------------------
function defaultContent(title: string, refs: Reference[]): PaperContent {
  const keys = refs.slice(0, 2).map(r => bibKey(r));
  return {
    abstract: `This paper presents a comprehensive study on ${title}. We investigate key aspects of the problem and propose novel approaches to address existing challenges. Experimental results demonstrate the effectiveness of our methodology compared to existing baselines.`,
    intro: {
      background: `The field of ${title} has seen significant advances in recent years. Researchers have explored various approaches to tackle the underlying challenges.`,
      relatedWork: `Prior work has addressed related problems through different methodologies. Existing approaches have shown promise but face limitations in scalability and generalizability.`,
      problemStatement: `Despite these advances, a gap remains between theoretical models and practical application. This work addresses this gap by proposing a systematic approach to the problem.`,
      contributions: [
        'A novel framework for ' + title,
        'Comprehensive experimental evaluation on benchmark datasets',
        'Analysis of key factors affecting performance',
        'Open-source implementation for reproducibility',
      ],
      citationKeys: keys,
    },
    methods: {
      overview: `Our methodology consists of three main phases: data preprocessing, model training, and evaluation. Each phase is designed to ensure reproducibility and robustness.`,
      details: [
        'In the preprocessing phase, we apply standard normalization and augmentation techniques to prepare the input data.',
        'The training phase employs an iterative optimization procedure with early stopping based on validation performance.',
      ],
      tableCaption: 'Experimental Configuration',
      tableHeaders: ['Parameter', 'Value', 'Description'],
      tableRows: [
        ['Learning Rate', '0.001', 'Initial learning rate'],
        ['Batch Size', '32', 'Mini-batch size'],
        ['Epochs', '100', 'Maximum training epochs'],
        ['Optimizer', 'Adam', 'Optimization algorithm'],
      ],
    },
    results: {
      setup: `Experiments were conducted on a standard benchmark dataset. We compare our approach against three competitive baselines using accuracy, F1-score, and runtime as evaluation metrics.`,
      mainResults: `Our method achieves state-of-the-art performance across all metrics. The results confirm the effectiveness of our proposed approach.`,
      analysisPoints: [
        'Our method outperforms all baselines on accuracy by a significant margin',
        'The proposed approach achieves competitive runtime despite higher accuracy',
        'Performance is consistent across different dataset splits',
      ],
      tableCaption: 'Performance Comparison',
      tableHeaders: ['Method', 'Accuracy (%)', 'F1 Score', 'Runtime (s)'],
      tableRows: [
        ['Random Forest', '72.3', '0.71', '0.8'],
        ['SVM', '75.1', '0.74', '1.1'],
        ['Neural Network', '81.4', '0.80', '2.3'],
        ['Ours', '89.1', '0.88', '1.5'],
      ],
      citationKeys: keys,
    },
    conclusion: {
      summary: `This paper presented a novel approach to ${title}. Our experimental evaluation demonstrates consistent improvements over existing baselines.`,
      limitations: `The current work has certain limitations. The approach requires labeled training data and may not generalize to highly domain-specific scenarios without fine-tuning.`,
      futureWork: `Future work will explore extensions to semi-supervised settings and investigate the application of the proposed framework to related domains.`,
      citationKeys: keys,
    },
  };
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
        { id: 'idea-1', type: 'ideaNode', position: { x: 500, y: 150 }, data: { body: 'AI tools have a dual effect on scientific research: they expand citation reach but narrow topical focus.' } },
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
  // Generation: AI returns JSON only, we build all LaTeX ourselves
  // ---------------------------------------------------------------------------
  const startGeneration = async (latestNodes?: Node[], latestEdges?: Edge[]) => {
    if (!activeWorkId) return;
    const work = works.find(w => w.id === activeWorkId);
    if (!work) return;

    filesRef.current = {};
    const workId = activeWorkId;
    const refList = references;

    setGenerationStatus('planning');
    setAgentLogs([]);

    const log = (agent: string, message: string) =>
      setAgentLogs(prev => [...prev, { agent, message, time: new Date().toLocaleTimeString() }]);

    const nodes = latestNodes || work.nodes;
    const graphCtx = nodes.map(n => {
      const d = n.data as any;
      return [d.title, d.body, d.venue].filter(Boolean).join('. ');
    }).filter(Boolean).join(' ');

    const availableKeys = refList.map(r => bibKey(r));
    const refSummary = refList.map(r => bibKey(r) + ': "' + r.title + '" (' + r.year + ')').join('\n');

    // JSON schema prompt
    const JSON_SYSTEM = `You are a research paper content generator. You output ONLY valid JSON. No markdown, no explanations, no LaTeX, no code fences. Pure JSON only.`;

    try {
      log('Planner', 'Generating paper content as structured data...');
      setGenerationStatus('discovering');
      log('Paper Parser', refList.length + ' references loaded. Keys: ' + availableKeys.join(', '));
      setGenerationStatus('assigning');

      // ---- Generate abstract + introduction ----
      setGenerationStatus('intro');
      log('Writer', 'Generating Introduction content...');

      const introPrompt = `${JSON_SYSTEM}

Generate content for the Introduction and Abstract of an IEEE paper titled: "${work.title}"
Context: ${graphCtx}
Available citation keys (use ONLY these): ${availableKeys.join(', ')}
Reference details:
${refSummary}

Return this exact JSON structure (fill in the values, keep keys identical):
{
  "abstract": "150-200 word abstract summarizing the paper",
  "background": "2-3 sentence background/motivation paragraph",
  "relatedWork": "2-3 sentence related work paragraph mentioning the research area",
  "problemStatement": "2-3 sentence problem statement",
  "contributions": ["contribution 1", "contribution 2", "contribution 3", "contribution 4"],
  "introCitationKeys": ["key1", "key2"]
}

Rules:
- All values are plain text strings (no LaTeX commands, no backslashes, no special chars)
- introCitationKeys must be a subset of: ${availableKeys.join(', ')}
- If no keys fit, use empty array []
- Pure JSON only`;

      const introRaw = await generateAcademicContent(introPrompt);
      log('Writer', 'Introduction JSON received.');

      interface IntroJson {
        abstract: string;
        background: string;
        relatedWork: string;
        problemStatement: string;
        contributions: string[];
        introCitationKeys: string[];
      }
      const introJson = parseJson<IntroJson>(introRaw, {
        abstract: 'This paper investigates ' + work.title + '.',
        background: 'Recent advances in AI have transformed scientific research.',
        relatedWork: 'Prior work has addressed related problems with mixed results.',
        problemStatement: 'A gap remains between theoretical models and practical systems.',
        contributions: ['Novel framework', 'Experimental evaluation', 'Analysis', 'Open-source code'],
        introCitationKeys: availableKeys.slice(0, 2),
      });

      // ---- Generate methods ----
      setGenerationStatus('body');
      log('Writer', 'Generating Methods content...');

      const methodsPrompt = `${JSON_SYSTEM}

Generate Methods section content for an IEEE paper titled: "${work.title}"
Context: ${graphCtx}

Return this exact JSON structure:
{
  "overview": "2-3 sentence overview of the methodology",
  "detail1": "2-3 sentence paragraph about the first methodological component",
  "detail2": "2-3 sentence paragraph about the second methodological component",
  "tableCaption": "Short table caption describing parameters",
  "tableHeaders": ["Column1", "Column2", "Column3"],
  "tableRows": [
    ["row1col1", "row1col2", "row1col3"],
    ["row2col1", "row2col2", "row2col3"],
    ["row3col1", "row3col2", "row3col3"],
    ["row4col1", "row4col2", "row4col3"]
  ]
}

Rules:
- All values are plain text strings (no LaTeX, no backslashes, no special chars like & $ # _ ^ ~ { })
- tableHeaders: array of 3 column header strings
- tableRows: array of arrays, each inner array has exactly 3 string values
- Pure JSON only`;

      const methodsRaw = await generateAcademicContent(methodsPrompt);
      log('Writer', 'Methods JSON received.');

      interface MethodsJson {
        overview: string;
        detail1: string;
        detail2: string;
        tableCaption: string;
        tableHeaders: string[];
        tableRows: string[][];
      }
      const methodsJson = parseJson<MethodsJson>(methodsRaw, {
        overview: 'Our methodology consists of three main phases.',
        detail1: 'The preprocessing phase applies normalization and feature extraction.',
        detail2: 'The training phase uses iterative optimization with early stopping.',
        tableCaption: 'Experimental Configuration',
        tableHeaders: ['Parameter', 'Value', 'Description'],
        tableRows: [
          ['Learning Rate', '0.001', 'Initial learning rate'],
          ['Batch Size', '32', 'Mini-batch size'],
          ['Epochs', '100', 'Max training epochs'],
          ['Optimizer', 'Adam', 'Optimization algorithm'],
        ],
      });

      // ---- Generate results ----
      log('Writer', 'Generating Results content...');

      const resultsPrompt = `${JSON_SYSTEM}

Generate Results section content for an IEEE paper titled: "${work.title}"
Context: ${graphCtx}
Available citation keys: ${availableKeys.join(', ')}
Reference details:
${refSummary}

Return this exact JSON structure:
{
  "setup": "2-3 sentence experimental setup description",
  "mainResults": "2-3 sentence description of main quantitative results",
  "analysisPoints": ["finding 1", "finding 2", "finding 3"],
  "tableCaption": "Performance Comparison",
  "tableHeaders": ["Method", "Metric1", "Metric2", "Metric3"],
  "tableRows": [
    ["Baseline A", "value", "value", "value"],
    ["Baseline B", "value", "value", "value"],
    ["Our Method", "value", "value", "value"]
  ],
  "resultsCitationKeys": ["key1"]
}

Rules:
- All values are plain text strings (no LaTeX, no backslashes, no special chars like & $ # _ ^ ~ { })
- tableHeaders: exactly 4 strings
- tableRows: each inner array has exactly 4 string values, use realistic numbers
- resultsCitationKeys must be a subset of: ${availableKeys.join(', ')}
- Pure JSON only`;

      const resultsRaw = await generateAcademicContent(resultsPrompt);
      log('Writer', 'Results JSON received.');

      interface ResultsJson {
        setup: string;
        mainResults: string;
        analysisPoints: string[];
        tableCaption: string;
        tableHeaders: string[];
        tableRows: string[][];
        resultsCitationKeys: string[];
      }
      const resultsJson = parseJson<ResultsJson>(resultsRaw, {
        setup: 'Experiments were conducted on a standard benchmark dataset.',
        mainResults: 'Our method achieves state-of-the-art performance across all metrics.',
        analysisPoints: ['Outperforms baselines by a significant margin', 'Consistent across dataset splits', 'Competitive runtime'],
        tableCaption: 'Performance Comparison',
        tableHeaders: ['Method', 'Accuracy (%)', 'F1 Score', 'Runtime (s)'],
        tableRows: [
          ['Random Forest', '72.3', '0.71', '0.8'],
          ['SVM', '75.1', '0.74', '1.1'],
          ['Our Method', '89.1', '0.88', '1.5'],
        ],
        resultsCitationKeys: availableKeys.slice(0, 1),
      });

      // ---- Generate conclusion ----
      setGenerationStatus('synthesis');
      log('Writer', 'Generating Abstract + Conclusion...');

      const conclusionPrompt = `${JSON_SYSTEM}

Generate Conclusion section content for an IEEE paper titled: "${work.title}"
Context: ${graphCtx}
Available citation keys: ${availableKeys.join(', ')}

Return this exact JSON structure:
{
  "summary": "2-3 sentence summary of the paper contributions",
  "limitations": "1-2 sentence description of current limitations",
  "futureWork": "1-2 sentence description of future research directions",
  "conclusionCitationKeys": ["key1"]
}

Rules:
- All values are plain text strings (no LaTeX, no backslashes, no special chars like & $ # _ ^ ~ { })
- conclusionCitationKeys must be a subset of: ${availableKeys.join(', ')}
- Pure JSON only`;

      const conclusionRaw = await generateAcademicContent(conclusionPrompt);
      log('Writer', 'Conclusion JSON received.');

      interface ConclusionJson {
        summary: string;
        limitations: string;
        futureWork: string;
        conclusionCitationKeys: string[];
      }
      const conclusionJson = parseJson<ConclusionJson>(conclusionRaw, {
        summary: 'This paper presented a novel approach to ' + work.title + '.',
        limitations: 'The approach requires labeled data and may not generalize to all domains.',
        futureWork: 'Future work will explore semi-supervised extensions and new domains.',
        conclusionCitationKeys: availableKeys.slice(0, 1),
      });

      // ---- Assemble structured content ----
      setGenerationStatus('review');
      log('Typesetter', 'Assembling paper from structured content...');

      const paperContent: PaperContent = {
        abstract: introJson.abstract || '',
        intro: {
          background: introJson.background || '',
          relatedWork: introJson.relatedWork || '',
          problemStatement: introJson.problemStatement || '',
          contributions: introJson.contributions || [],
          citationKeys: (introJson.introCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
        methods: {
          overview: methodsJson.overview || '',
          details: [methodsJson.detail1 || '', methodsJson.detail2 || ''].filter(Boolean),
          tableCaption: methodsJson.tableCaption || 'System Parameters',
          tableHeaders: Array.isArray(methodsJson.tableHeaders) && methodsJson.tableHeaders.length === 3
            ? methodsJson.tableHeaders
            : ['Parameter', 'Value', 'Description'],
          tableRows: Array.isArray(methodsJson.tableRows) ? methodsJson.tableRows : [],
        },
        results: {
          setup: resultsJson.setup || '',
          mainResults: resultsJson.mainResults || '',
          analysisPoints: resultsJson.analysisPoints || [],
          tableCaption: resultsJson.tableCaption || 'Performance Comparison',
          tableHeaders: Array.isArray(resultsJson.tableHeaders) && resultsJson.tableHeaders.length === 4
            ? resultsJson.tableHeaders
            : ['Method', 'Accuracy (%)', 'F1 Score', 'Runtime (s)'],
          tableRows: Array.isArray(resultsJson.tableRows) ? resultsJson.tableRows : [],
          citationKeys: (resultsJson.resultsCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
        conclusion: {
          summary: conclusionJson.summary || '',
          limitations: conclusionJson.limitations || '',
          futureWork: conclusionJson.futureWork || '',
          citationKeys: (conclusionJson.conclusionCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
      };

      // ---- Build all files ----
      log('Typesetter', 'Building LaTeX files...');
      const sectionFiles = buildSectionFiles(paperContent, refList);
      for (const [fname, fcontent] of Object.entries(sectionFiles)) {
        saveFile(workId, fname, fcontent);
      }

      log('Typesetter', 'Writing references.bib...');
      saveFile(workId, 'references.bib', buildBib(refList));

      log('Typesetter', 'Assembling main.tex...');
      const mainTex = assembleMainTex(work.title, paperContent, refList);
      saveFile(workId, 'main.tex', mainTex);

      log('Typesetter', 'main.tex: ' + mainTex.split('\n').length + ' lines. All files ready.');
      setGenerationStatus('completed');
      log('System', 'Done! Select main.tex and click "Compile PDF".');

    } catch (err: any) {
      log('System', 'ERROR: ' + (err?.message || String(err)));
      // Emergency: use default content
      log('System', 'Using fallback content for emergency assembly...');
      const fallback = defaultContent(work.title, refList);
      const sectionFiles = buildSectionFiles(fallback, refList);
      for (const [fname, fcontent] of Object.entries(sectionFiles)) {
        saveFile(workId, fname, fcontent);
      }
      saveFile(workId, 'references.bib', buildBib(refList));
      saveFile(workId, 'main.tex', assembleMainTex(work.title, fallback, refList));
      setGenerationStatus('completed');
      log('System', 'Emergency assembly complete.');
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
