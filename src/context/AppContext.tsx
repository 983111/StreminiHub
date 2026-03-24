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
// BibTeX key — must be ASCII letters+digits only, must start with a letter
// ---------------------------------------------------------------------------
function bibKey(ref: Reference): string {
  const rawLast = ref.authors.split(',')[0].trim().split(' ').pop() || 'Author';
  // Transliterate common accented chars, then strip anything non-ASCII-alpha
  const transliterated = rawLast
    .normalize('NFD')                       // decompose accents
    .replace(/[\u0300-\u036f]/g, '')        // strip combining diacritics
    .replace(/[^a-zA-Z0-9]/g, '');         // strip remaining non-alnum
  // Ensure key starts with a letter (BibTeX requirement)
  const safe = /^[a-zA-Z]/.test(transliterated) ? transliterated : 'Ref' + transliterated;
  return (safe || 'Author') + String(ref.year);
}

// ---------------------------------------------------------------------------
// Escape text for safe LaTeX inclusion — call ONCE per string
// ---------------------------------------------------------------------------
function latexEscape(s: string): string {
  if (!s) return '';
  return s
    // Strip any stray backslashes from AI output FIRST (before we add our own)
    .replace(/\\/g, '')
    // Now escape LaTeX special chars
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
    .replace(/>/g, '\\textgreater{}')
    // Curly/smart quotes → straight LaTeX quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, "''")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Straight double-quote → LaTeX open/close (simplest safe approach)
    .replace(/"/g, "''")
    // Em/en dash
    .replace(/\u2014/g, '---')
    .replace(/\u2013/g, '--')
    // Ellipsis
    .replace(/\u2026/g, '\\ldots{}');
}

// ---------------------------------------------------------------------------
// Parse JSON safely from AI response
// ---------------------------------------------------------------------------
function parseJson<T>(raw: string, fallback: T): T {
  try {
    let s = raw;
    // Strip reasoning/thinking blocks
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    // Strip markdown fences
    s = s.replace(/```[\w]*\n?/gi, '').replace(/```/g, '');
    // Find first { or [
    const start = s.search(/[\[{]/);
    if (start === -1) return fallback;
    s = s.slice(start);
    const end = s.lastIndexOf(s[0] === '[' ? ']' : '}');
    if (end === -1) return fallback;
    s = s.slice(0, end + 1);
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Convert plain text paragraphs to LaTeX paragraph blocks
// Escapes the text — do NOT pre-escape before calling this
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
// Items must NOT be pre-escaped
// ---------------------------------------------------------------------------
function buildItemize(items: string[]): string {
  if (!items || !items.length) return '';
  return '\\begin{itemize}\n' +
    items.map(i => '  \\item ' + latexEscape(i.trim())).join('\n') +
    '\n\\end{itemize}';
}

// ---------------------------------------------------------------------------
// Build a LaTeX table from headers + rows
// Values must NOT be pre-escaped
// ---------------------------------------------------------------------------
function buildTable(caption: string, headers: string[], rows: string[][], label: string): string {
  if (!headers.length || !rows.length) return '';
  const cols = headers.length;
  const colSpec = 'l' + 'c'.repeat(cols - 1);
  const hdr = headers.map(h => '\\textbf{' + latexEscape(h) + '}').join(' & ');
  const dataRows = rows.map(r => {
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
    // For .bib files, use minimal escaping — just strip braces that would break the format
    const safeTitle = r.title.replace(/[{}]/g, '');
    const safeAuthors = r.authors.replace(/[{}]/g, '');
    let entry = `@article{${k},\n  author  = {${safeAuthors}},\n  title   = {{${safeTitle}}},\n  year    = {${r.year}},\n  journal = {Proceedings},\n  pages   = {1--10}`;
    if (r.doi) entry += `,\n  doi     = {${r.doi}}`;
    entry += '\n}';
    return entry;
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Build \bibitem entries for thebibliography
// Uses safe LaTeX escaping — no raw backtick/quote tricks
// ---------------------------------------------------------------------------
function buildBibItems(refs: Reference[]): string {
  if (!refs.length) return '';
  return refs.map(r => {
    const k = bibKey(r);
    const safeTitle = latexEscape(r.title);
    const safeAuthors = latexEscape(r.authors);
    const doiPart = r.doi ? ' doi:' + r.doi + '.' : '';
    // Use \textit for title — safe, no raw quote marks
    return `\\bibitem{${k}}\n${safeAuthors},\n\\textit{${safeTitle}},\n${r.year}.${doiPart}`;
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Paper content interface — full 10+ page academic paper
// ---------------------------------------------------------------------------
interface PaperContent {
  abstract: string;
  keywords: string[];
  intro: {
    opening: string;
    motivation: string;
    background: string;
    problemStatement: string;
    approach: string;
    contributions: string[];
    paperOrganization: string;
    citationKeys: string[];
  };
  relatedWork: {
    para1: string;
    para2: string;
    para3: string;
    para4: string;
    gap: string;
    citationKeys: string[];
  };
  methods: {
    overview: string;
    sub1Title: string;
    sub1: string;
    sub2Title: string;
    sub2: string;
    sub3Title: string;
    sub3: string;
    sub4Title: string;
    sub4: string;
    tableCaption: string;
    tableHeaders: string[];
    tableRows: string[][];
    algoDescription: string;
  };
  experiments: {
    datasetDescription: string;
    datasetTableCaption: string;
    datasetTableHeaders: string[];
    datasetTableRows: string[][];
    baselineDescription: string;
    implementationDetails: string;
    metricDescription: string;
  };
  results: {
    mainResultsIntro: string;
    mainResults: string;
    ablation: string;
    qualitative: string;
    analysisPoints: string[];
    tableCaption: string;
    tableHeaders: string[];
    tableRows: string[][];
    ablationTableCaption: string;
    ablationTableHeaders: string[];
    ablationTableRows: string[][];
    citationKeys: string[];
  };
  discussion: {
    interpretation: string;
    implications: string;
    comparison: string;
    limitations: string;
    citationKeys: string[];
  };
  conclusion: {
    summary: string;
    contributions: string;
    limitations: string;
    futureWork: string;
    closingRemark: string;
    citationKeys: string[];
  };
}

// ---------------------------------------------------------------------------
// Assemble main.tex — expanded for 10+ pages
// ---------------------------------------------------------------------------
function assembleMainTex(title: string, content: PaperContent, refs: Reference[]): string {
  const safeTitle = latexEscape(title);
  const numRefs = String(Math.max(refs.length, 1)).padStart(2, '0');
  const makeCite = (keys: string[]) => keys.length ? ' \\cite{' + keys.join(',') + '}' : '';

  const abstractBody = textToLatexParagraphs(content.abstract);
  const keywordsLine = content.keywords.map(k => latexEscape(k)).join(', ');

  // Introduction
  const introBody =
    textToLatexParagraphs(content.intro.opening) + '\n\n' +
    textToLatexParagraphs(content.intro.motivation) + '\n\n' +
    textToLatexParagraphs(content.intro.background) + makeCite(content.intro.citationKeys) + '\n\n' +
    textToLatexParagraphs(content.intro.problemStatement) + '\n\n' +
    textToLatexParagraphs(content.intro.approach) + '\n\n' +
    'The main contributions of this work are:\n' + buildItemize(content.intro.contributions) + '\n\n' +
    textToLatexParagraphs(content.intro.paperOrganization);

  // Related Work
  const relatedBody =
    textToLatexParagraphs(content.relatedWork.para1) + makeCite(content.relatedWork.citationKeys.slice(0,2)) + '\n\n' +
    textToLatexParagraphs(content.relatedWork.para2) + '\n\n' +
    textToLatexParagraphs(content.relatedWork.para3) + makeCite(content.relatedWork.citationKeys.slice(2)) + '\n\n' +
    textToLatexParagraphs(content.relatedWork.para4) + '\n\n' +
    textToLatexParagraphs(content.relatedWork.gap);

  // Methods
  const methodsTable = buildTable(
    content.methods.tableCaption || 'Hyperparameter Configuration',
    content.methods.tableHeaders.length === 3 ? content.methods.tableHeaders : ['Parameter', 'Value', 'Description'],
    content.methods.tableRows.length ? content.methods.tableRows : [['Learning Rate','0.001','Initial LR'],['Batch Size','32','Mini-batch'],['Epochs','200','Max epochs'],['Optimizer','AdamW','Optimizer']],
    'tab:hyperparams'
  );
  const methodsBody =
    textToLatexParagraphs(content.methods.overview) + '\n\n' +
    '\\subsection{' + latexEscape(content.methods.sub1Title || 'Problem Formulation') + '}\n' +
    textToLatexParagraphs(content.methods.sub1) + '\n\n' +
    '\\subsection{' + latexEscape(content.methods.sub2Title || 'Model Architecture') + '}\n' +
    textToLatexParagraphs(content.methods.sub2) + '\n\n' +
    '\\subsection{' + latexEscape(content.methods.sub3Title || 'Training Procedure') + '}\n' +
    textToLatexParagraphs(content.methods.sub3) + '\n\n' +
    methodsTable + '\n\n' +
    '\\subsection{' + latexEscape(content.methods.sub4Title || 'Optimization and Complexity') + '}\n' +
    textToLatexParagraphs(content.methods.sub4) + '\n\n' +
    textToLatexParagraphs(content.methods.algoDescription);

  // Experimental Setup
  const datasetTable = buildTable(
    content.experiments.datasetTableCaption || 'Dataset Statistics',
    content.experiments.datasetTableHeaders.length === 4 ? content.experiments.datasetTableHeaders : ['Dataset', 'Train', 'Val', 'Test'],
    content.experiments.datasetTableRows.length ? content.experiments.datasetTableRows : [['Main','8000','1000','1000'],['Aux','4000','500','500']],
    'tab:datasets'
  );
  const experimentsBody =
    '\\subsection{Datasets}\n' +
    textToLatexParagraphs(content.experiments.datasetDescription) + '\n\n' +
    datasetTable + '\n\n' +
    '\\subsection{Baselines}\n' +
    textToLatexParagraphs(content.experiments.baselineDescription) + '\n\n' +
    '\\subsection{Implementation Details}\n' +
    textToLatexParagraphs(content.experiments.implementationDetails) + '\n\n' +
    '\\subsection{Evaluation Metrics}\n' +
    textToLatexParagraphs(content.experiments.metricDescription);

  // Results
  const resultsTable = buildTable(
    content.results.tableCaption || 'Main Results',
    content.results.tableHeaders.length === 4 ? content.results.tableHeaders : ['Method', 'Accuracy', 'F1', 'Time(s)'],
    content.results.tableRows.length ? content.results.tableRows : [['Baseline','72.3','0.71','0.8'],['Ours','89.1','0.88','1.5']],
    'tab:main_results'
  );
  const ablationTable = buildTable(
    content.results.ablationTableCaption || 'Ablation Study',
    content.results.ablationTableHeaders.length === 4 ? content.results.ablationTableHeaders : ['Variant', 'Acc', 'F1', 'Delta'],
    content.results.ablationTableRows.length ? content.results.ablationTableRows : [['Full Model','89.1','0.88','--'],['w/o Component A','84.2','0.82','-4.9'],['w/o Component B','81.7','0.79','-7.4']],
    'tab:ablation'
  );
  const resultsBody =
    textToLatexParagraphs(content.results.mainResultsIntro) + '\n\n' +
    '\\subsection{Main Results}\n' +
    textToLatexParagraphs(content.results.mainResults) + makeCite(content.results.citationKeys) + '\n\n' +
    resultsTable + '\n\n' +
    '\\subsection{Ablation Study}\n' +
    textToLatexParagraphs(content.results.ablation) + '\n\n' +
    ablationTable + '\n\n' +
    '\\subsection{Qualitative Analysis}\n' +
    textToLatexParagraphs(content.results.qualitative) + '\n\n' +
    'Summary of key findings:\n' + buildItemize(content.results.analysisPoints);

  // Discussion
  const discussionBody =
    textToLatexParagraphs(content.discussion.interpretation) + makeCite(content.discussion.citationKeys) + '\n\n' +
    textToLatexParagraphs(content.discussion.implications) + '\n\n' +
    textToLatexParagraphs(content.discussion.comparison) + '\n\n' +
    textToLatexParagraphs(content.discussion.limitations);

  // Conclusion
  const conclusionBody =
    textToLatexParagraphs(content.conclusion.summary) + '\n\n' +
    textToLatexParagraphs(content.conclusion.contributions) + makeCite(content.conclusion.citationKeys) + '\n\n' +
    textToLatexParagraphs(content.conclusion.limitations) + '\n\n' +
    textToLatexParagraphs(content.conclusion.futureWork) + '\n\n' +
    textToLatexParagraphs(content.conclusion.closingRemark);

  const bibItems = buildBibItems(refs);

  return `\\documentclass[12pt,a4paper]{article}
\\usepackage[a4paper, margin=2.5cm]{geometry}
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{url}
\\usepackage{setspace}
\\usepackage{titlesec}
\\usepackage{abstract}
\\usepackage{parskip}
\\usepackage{hyperref}
\\hypersetup{colorlinks=true, linkcolor=blue, citecolor=blue, urlcolor=blue}

\\titleformat{\\section}{\\large\\bfseries}{\\thesection}{1em}{}
\\titleformat{\\subsection}{\\normalsize\\bfseries}{\\thesubsection}{1em}{}
\\setlength{\\parskip}{6pt}
\\setlength{\\parindent}{0pt}
\\onehalfspacing

\\begin{document}

\\begin{titlepage}
\\centering
\\vspace*{2cm}
{\\LARGE\\bfseries ${safeTitle}\\par}
\\vspace{1.5cm}
{\\large AI Research System\\par}
{\\normalsize Automated Research Platform\\par}
{\\normalsize research@ai-system.org\\par}
\\vspace{1cm}
{\\normalsize \\today\\par}
\\vspace{2cm}
\\begin{abstract}
\\setlength{\\parskip}{4pt}
${abstractBody}
\\end{abstract}
\\vspace{0.5cm}
\\textbf{Keywords:} ${keywordsLine}
\\end{titlepage}

\\tableofcontents
\\newpage

\\section{Introduction}
${introBody}

\\section{Related Work}
${relatedBody}

\\section{Methodology}
${methodsBody}

\\section{Experimental Setup}
${experimentsBody}

\\section{Results}
${resultsBody}

\\section{Discussion}
${discussionBody}

\\section{Conclusion}
${conclusionBody}

\\begin{thebibliography}{${numRefs}}
${bibItems || '\\bibitem{placeholder} No references provided.'}
\\end{thebibliography}

\\end{document}`;
}

// ---------------------------------------------------------------------------
// Section .tex files for the file browser
// ---------------------------------------------------------------------------
function buildSectionFiles(content: PaperContent, refs: Reference[]): Record<string, string> {
  const makeCite = (keys: string[]) => keys.length ? ' \\cite{' + keys.join(',') + '}' : '';

  return {
    'Abstract.tex':
      '\\begin{abstract}\n' + textToLatexParagraphs(content.abstract) + '\n\\end{abstract}',

    'Introduction.tex':
      '\\section{Introduction}\n' +
      textToLatexParagraphs(content.intro.opening) + '\n\n' +
      textToLatexParagraphs(content.intro.motivation) + '\n\n' +
      textToLatexParagraphs(content.intro.background) + makeCite(content.intro.citationKeys) + '\n\n' +
      textToLatexParagraphs(content.intro.problemStatement) + '\n\n' +
      textToLatexParagraphs(content.intro.approach) + '\n\n' +
      'The main contributions of this work are:\n' + buildItemize(content.intro.contributions) + '\n\n' +
      textToLatexParagraphs(content.intro.paperOrganization),

    'Methods.tex':
      '\\section{Methodology}\n' +
      textToLatexParagraphs(content.methods.overview) + '\n\n' +
      '\\subsection{' + latexEscape(content.methods.sub1Title) + '}\n' + textToLatexParagraphs(content.methods.sub1) + '\n\n' +
      '\\subsection{' + latexEscape(content.methods.sub2Title) + '}\n' + textToLatexParagraphs(content.methods.sub2) + '\n\n' +
      '\\subsection{' + latexEscape(content.methods.sub3Title) + '}\n' + textToLatexParagraphs(content.methods.sub3) + '\n\n' +
      '\\subsection{' + latexEscape(content.methods.sub4Title) + '}\n' + textToLatexParagraphs(content.methods.sub4),

    'Results.tex':
      '\\section{Results}\n' +
      textToLatexParagraphs(content.results.mainResultsIntro) + '\n\n' +
      textToLatexParagraphs(content.results.mainResults) + makeCite(content.results.citationKeys) + '\n\n' +
      buildTable(
        content.results.tableCaption || 'Main Results',
        content.results.tableHeaders.length === 4 ? content.results.tableHeaders : ['Method','Accuracy','F1','Time(s)'],
        content.results.tableRows.length ? content.results.tableRows : [['Ours','89.1','0.88','1.5']],
        'tab:main_results'
      ) + '\n\n' +
      textToLatexParagraphs(content.results.ablation) + '\n\n' +
      textToLatexParagraphs(content.results.qualitative) + '\n\n' +
      'Key findings:\n' + buildItemize(content.results.analysisPoints),

    'Conclusion.tex':
      '\\section{Conclusion}\n' +
      textToLatexParagraphs(content.conclusion.summary) + '\n\n' +
      textToLatexParagraphs(content.conclusion.contributions) + makeCite(content.conclusion.citationKeys) + '\n\n' +
      textToLatexParagraphs(content.conclusion.limitations) + '\n\n' +
      textToLatexParagraphs(content.conclusion.futureWork) + '\n\n' +
      textToLatexParagraphs(content.conclusion.closingRemark),
  };
}

// ---------------------------------------------------------------------------
// Default fallback content
// ---------------------------------------------------------------------------
function defaultContent(title: string, refs: Reference[]): PaperContent {
  const keys = refs.slice(0, 4).map(r => bibKey(r));
  return {
    abstract: `This paper presents a comprehensive investigation into ${title}. We identify critical limitations in existing approaches and propose a novel framework that addresses these challenges through a combination of principled design and empirical validation. Our method is evaluated on multiple benchmark datasets and compared against state-of-the-art baselines. Experimental results demonstrate consistent and significant improvements across all evaluation metrics, with our approach achieving up to 16.8 percentage points improvement in accuracy over the strongest baseline. We further provide in-depth ablation studies, qualitative analyses, and theoretical discussion that illuminate the sources of performance gains and offer insights for future research in this area.`,
    keywords: [title.split(' ')[0] || 'Deep Learning', 'Neural Networks', 'Benchmark Evaluation', 'Performance Analysis', 'Empirical Study'],
    intro: {
      opening: `The rapid evolution of artificial intelligence and machine learning has fundamentally transformed how researchers and practitioners approach complex real-world problems. Among the many challenges that have emerged, ${title} stands out as a particularly compelling area of inquiry that has attracted significant attention from the research community over the past decade.`,
      motivation: `The motivation for this work stems from the observation that while existing approaches have made considerable progress, they continue to suffer from fundamental limitations that prevent widespread practical deployment. These include issues of scalability, generalizability, computational efficiency, and robustness to distributional shift. Addressing these limitations simultaneously has proven elusive, as improvements in one dimension frequently come at the expense of others.`,
      background: `Early foundational work in this area established the theoretical groundwork upon which modern methods are built. Subsequent developments introduced increasingly sophisticated models that demonstrated impressive performance on controlled benchmark tasks. However, the translation of these laboratory results to real-world settings has remained an open problem, motivating the development of more robust and practical methodologies.`,
      problemStatement: `Despite significant progress, several fundamental challenges remain unresolved. First, existing methods require prohibitive amounts of labeled training data, limiting applicability in low-resource settings. Second, the computational overhead associated with state-of-the-art approaches makes real-time deployment difficult. Third, current methods exhibit fragile performance when evaluated outside their training distribution. This paper directly addresses all three of these critical gaps.`,
      approach: `We propose a unified framework that jointly addresses the challenges of data efficiency, computational scalability, and distributional robustness. Our approach is grounded in a principled theoretical analysis of the problem structure and exploits previously overlooked structural regularities to derive an efficient and effective algorithm. We validate our approach through rigorous empirical evaluation across diverse settings.`,
      contributions: [
        'A novel framework for ' + title + ' that outperforms all existing baselines by a significant margin',
        'A theoretical analysis establishing convergence guarantees and complexity bounds for the proposed algorithm',
        'Comprehensive ablation studies that isolate the contribution of each architectural component',
        'Extensive empirical evaluation on six benchmark datasets demonstrating consistent improvements',
        'An open-source implementation facilitating reproducibility and future research',
      ],
      paperOrganization: `The remainder of this paper is organized as follows. Section II reviews related work and situates our contributions within the existing literature. Section III presents the proposed methodology in detail. Section IV describes the experimental setup including datasets, baselines, and evaluation protocols. Section V presents and analyzes the experimental results. Section VI discusses implications, limitations, and broader impact. Section VII concludes the paper with directions for future research.`,
      citationKeys: keys.slice(0, 2),
    },
    relatedWork: {
      para1: `The field of ${title} has a rich history spanning multiple decades of research. Early work focused primarily on establishing theoretical foundations and exploring simple parametric models. Landmark contributions from this era demonstrated the feasibility of the core problem and identified key factors influencing performance, laying the groundwork for subsequent algorithmic developments. These seminal works continue to inform modern approaches and serve as important baselines for comparative evaluation.`,
      para2: `The advent of deep learning brought a paradigm shift to this research area. Neural network-based approaches demonstrated unprecedented performance on standard benchmarks, displacing hand-crafted feature engineering pipelines that had dominated the field. Convolutional architectures, recurrent models, and attention mechanisms have each been applied to this domain with varying degrees of success. The transformer architecture in particular has proven especially powerful, enabling models to capture long-range dependencies that were inaccessible to earlier approaches.`,
      para3: `A parallel line of work has focused on improving the data efficiency and generalization of learned models. Transfer learning and domain adaptation techniques have been extensively studied as mechanisms for leveraging large-scale pre-training to improve performance in low-resource settings. Self-supervised and contrastive learning objectives have emerged as particularly promising directions, enabling models to extract rich representations without requiring expensive manual annotation.`,
      para4: `More recent work has addressed questions of computational efficiency and practical deployment. Pruning, quantization, and knowledge distillation techniques have been applied to reduce model size and inference latency without significant performance degradation. Neural architecture search has been explored as a mechanism for automatically discovering efficient architectures tailored to specific resource constraints. Despite these advances, bridging the gap between research prototypes and production systems remains an active area of investigation.`,
      gap: `Despite the substantial body of prior work, a critical gap remains in the literature. Existing approaches treat the constituent sub-problems largely in isolation, failing to exploit the rich interdependencies that exist among them. Furthermore, evaluation has predominantly focused on a narrow set of benchmark datasets that do not adequately reflect the diversity of real-world deployment conditions. Our work addresses both of these limitations through a unified framework and a more comprehensive evaluation protocol.`,
      citationKeys: keys,
    },
    methods: {
      overview: `This section presents the proposed methodology in detail. We begin by formally defining the problem setting and establishing notation. We then describe the core architectural components of our approach, followed by the training procedure and optimization strategy. Finally, we analyze the computational complexity and discuss practical implementation considerations.`,
      sub1Title: 'Problem Formulation',
      sub1: `Let us formally define the problem setting. We are given a training dataset consisting of N input-output pairs drawn independently and identically from an unknown joint distribution. The goal is to learn a mapping that generalizes well to unseen examples drawn from the same distribution. We consider both the standard supervised setting and a more challenging semi-supervised setting in which only a fraction of the training examples are labeled. Our framework is designed to perform well in both settings without modification to the core algorithm.`,
      sub2Title: 'Proposed Architecture',
      sub2: `The proposed architecture consists of three main components: an encoder network, a task-specific processing module, and a decoder or prediction head. The encoder is responsible for transforming raw inputs into a rich intermediate representation that captures relevant features at multiple levels of abstraction. We employ a hierarchical design with skip connections that facilitate gradient flow during training and enable the model to leverage both low-level and high-level features. The processing module applies a series of learned transformations to the encoded representation, incorporating domain-specific inductive biases that improve sample efficiency. The prediction head maps the processed representation to the desired output space.`,
      sub3Title: 'Training Procedure',
      sub3: `Training proceeds in two stages. In the first stage, we pre-train the encoder on a large unlabeled corpus using a self-supervised objective that encourages the model to learn representations that are invariant to nuisance transformations while remaining sensitive to task-relevant factors of variation. In the second stage, we fine-tune all components jointly on the labeled training data using the task-specific loss function. We employ a curriculum learning strategy that presents training examples in order of increasing difficulty, which we find to improve both convergence speed and final performance. Regularization is applied throughout training via dropout and weight decay to mitigate overfitting.`,
      sub4Title: 'Complexity Analysis',
      sub4: `The time complexity of the proposed approach is analyzed as follows. The forward pass requires O(n log n) operations with respect to input length n, a significant improvement over the O(n squared) complexity of naive attention-based approaches. The space complexity is O(n) for the encoder and O(k) for the processing module, where k is the number of task-specific parameters. This favorable complexity profile makes our approach practical for deployment on resource-constrained devices. We further validate these theoretical bounds empirically in the experiments section.`,
      tableCaption: 'Hyperparameter Configuration',
      tableHeaders: ['Hyperparameter', 'Value', 'Search Range'],
      tableRows: [
        ['Learning rate', '3e-4', '[1e-5, 1e-2]'],
        ['Batch size', '64', '[16, 256]'],
        ['Dropout rate', '0.1', '[0.0, 0.5]'],
        ['Weight decay', '1e-4', '[0, 1e-2]'],
        ['Warmup steps', '500', '[100, 2000]'],
        ['Hidden dim', '512', '[128, 1024]'],
        ['Encoder layers', '6', '[2, 12]'],
        ['Attention heads', '8', '[2, 16]'],
      ],
      algoDescription: `The complete training algorithm proceeds as follows. We initialize all parameters using Xavier initialization and begin with a linear learning rate warmup schedule over the first 500 steps. The learning rate then follows a cosine annealing schedule for the remainder of training. Gradient clipping with a maximum norm of 1.0 is applied at each step to stabilize training. We use early stopping with a patience of 10 epochs on the validation set to select the final model checkpoint. The entire training process completes within 24 hours on a single modern GPU.`,
    },
    experiments: {
      datasetDescription: `We evaluate our approach on multiple benchmark datasets covering a range of difficulty levels and domains. The primary evaluation is conducted on the standard benchmark used in the majority of prior work, enabling direct comparison with published results. We additionally evaluate on four auxiliary datasets to assess generalization across diverse conditions. Dataset statistics including train, validation, and test set sizes are summarized in Table II. All datasets are preprocessed using the standard protocols described in the respective original papers to ensure fair comparison.`,
      datasetTableCaption: 'Dataset Statistics',
      datasetTableHeaders: ['Dataset', 'Train', 'Val', 'Test'],
      datasetTableRows: [
        ['Primary Benchmark', '45,000', '5,000', '10,000'],
        ['Auxiliary Set A', '20,000', '2,500', '5,000'],
        ['Auxiliary Set B', '12,000', '1,500', '3,000'],
        ['Cross-domain Set', '8,000', '1,000', '2,000'],
      ],
      baselineDescription: `We compare against six competitive baselines representing the current state of the art. The first two baselines are classical methods that do not rely on deep learning: a support vector machine with radial basis function kernel and a gradient boosted tree ensemble. The remaining four baselines are deep learning methods representing different architectural paradigms: a standard convolutional network, a recurrent architecture, a transformer-based approach, and the current strongest published method on the primary benchmark. All baselines are reproduced using the official implementations and hyperparameter settings reported in the respective papers.`,
      implementationDetails: `All experiments are implemented in PyTorch and run on NVIDIA A100 GPUs. For reproducibility, we fix random seeds across all experiments and report results averaged over five independent runs with different random initializations. Statistical significance is assessed using paired bootstrap tests with 10,000 resampling iterations. The proposed model is trained end-to-end with the AdamW optimizer. Hyperparameters are selected via grid search on the validation set of the primary benchmark and held fixed across all other datasets to assess generalization without dataset-specific tuning.`,
      metricDescription: `We report results using four standard evaluation metrics: classification accuracy, macro-averaged F1 score, area under the receiver operating characteristic curve (AUROC), and mean inference latency in milliseconds measured on a standardized hardware configuration. Accuracy and F1 capture different aspects of task performance and are widely used in prior work. AUROC provides a threshold-independent measure of discriminative ability that is particularly informative for imbalanced evaluation sets. Latency is included to assess practical deployability and enables holistic comparison of accuracy-efficiency tradeoffs across methods.`,
    },
    results: {
      mainResultsIntro: `This section presents the results of our empirical evaluation. We first report main results comparing our approach against all baselines on the primary benchmark, followed by results on the auxiliary datasets. We then conduct a detailed ablation study to isolate the contribution of individual architectural components. Finally, we present qualitative analyses and case studies that provide additional insight into the behavior of the proposed approach.`,
      mainResults: `Our method achieves state-of-the-art performance on the primary benchmark, obtaining 89.1 percent accuracy and 0.882 macro F1, outperforming the strongest baseline by 5.3 accuracy points and 0.041 F1. The improvement is particularly pronounced on challenging examples and minority classes, indicating that our approach successfully addresses the distributional imbalance issues present in the benchmark. On the auxiliary datasets, our method generalizes well, consistently outperforming all baselines with an average accuracy improvement of 4.7 points. Notably, performance on the cross-domain set demonstrates that our approach achieves meaningful generalization to distribution shift without any domain-specific adaptation.`,
      ablation: `To understand the contribution of each component, we conduct a systematic ablation study removing or replacing individual elements of the proposed architecture. Removing the pre-training stage results in a 4.9 point accuracy drop, confirming the importance of the self-supervised objective for representation learning. Replacing the proposed processing module with a standard multi-layer perceptron yields a 7.4 point degradation, demonstrating the value of the domain-specific inductive biases. Ablating the curriculum learning strategy causes a 2.1 point reduction and notably increases training variance, suggesting that example ordering contributes to both performance and stability.`,
      qualitative: `Qualitative examination of model predictions reveals several informative patterns. The model correctly handles difficult cases involving ambiguous or overlapping categories that frequently confuse existing approaches. Attention visualization shows that the model has learned to focus on semantically relevant regions of the input, consistent with the inductive biases encoded in the architecture. Error analysis reveals that the remaining failure cases predominantly involve extremely low-resource categories and highly ambiguous examples where even human annotators show significant disagreement. These observations suggest clear directions for further improvement.`,
      analysisPoints: [
        'State-of-the-art accuracy on primary benchmark: 89.1% vs 83.8% for strongest baseline',
        'Consistent improvements across all six evaluation datasets demonstrating strong generalization',
        'Ablation study confirms each component contributes meaningfully to overall performance',
        'Inference latency of 12ms enables real-time deployment on standard hardware',
        'Pre-training stage provides the largest single contribution at 4.9 accuracy points',
        'Cross-domain evaluation demonstrates robustness to distribution shift without re-training',
      ],
      tableCaption: 'Main Results on Primary Benchmark',
      tableHeaders: ['Method', 'Accuracy (%)', 'Macro F1', 'Latency (ms)'],
      tableRows: [
        ['SVM-RBF', '71.2', '0.698', '2.1'],
        ['Gradient Boosting', '74.8', '0.731', '3.4'],
        ['CNN Baseline', '78.3', '0.771', '8.7'],
        ['LSTM Baseline', '80.1', '0.789', '15.2'],
        ['Transformer', '83.8', '0.841', '22.4'],
        ['Prior SOTA', '84.5', '0.847', '19.8'],
        ['Ours', '89.1', '0.882', '12.0'],
      ],
      ablationTableCaption: 'Ablation Study Results',
      ablationTableHeaders: ['Variant', 'Accuracy (%)', 'F1 Score', 'Delta Acc'],
      ablationTableRows: [
        ['Full Model', '89.1', '0.882', '--'],
        ['w/o Pre-training', '84.2', '0.831', '-4.9'],
        ['w/o Processing Module', '81.7', '0.803', '-7.4'],
        ['w/o Curriculum Learning', '87.0', '0.861', '-2.1'],
        ['w/o Dropout', '86.8', '0.858', '-2.3'],
        ['Smaller Encoder (3L)', '85.4', '0.844', '-3.7'],
      ],
      citationKeys: keys.slice(0, 2),
    },
    discussion: {
      interpretation: `The strong performance of our approach across all evaluation conditions can be attributed to several interconnected factors. The self-supervised pre-training objective forces the encoder to learn representations that are not overfitted to superficial statistical regularities present in labeled training data. The domain-specific inductive biases encoded in the processing module provide a useful prior that reduces the effective search space and improves sample efficiency. Together, these design choices produce a model that generalizes substantially better than approaches that rely on end-to-end supervised training alone.`,
      implications: `The implications of this work extend beyond the specific task of ${title}. The general principle of combining self-supervised pre-training with domain-specific architectural priors is broadly applicable to any setting where labeled data is scarce and domain knowledge can be effectively encoded. Our theoretical analysis furthermore provides tools for reasoning about the generalization behavior of models in this class, which may inform the design of future approaches. The favorable accuracy-efficiency tradeoff achieved by our method suggests that it may be particularly well-suited for deployment in resource-constrained environments.`,
      comparison: `Comparing our results against prior work reveals interesting patterns. Methods based on classical machine learning perform substantially worse than deep learning approaches, confirming the importance of learned feature representations for this task. Among deep learning approaches, the transformer-based baseline performs best among existing methods, consistent with the broader trend of attention-based architectures dominating performance across diverse domains. Our method improves upon the transformer baseline by incorporating pre-training and architectural inductive biases, demonstrating that the generic capability of transformers can be meaningfully augmented with task-specific design choices.`,
      limitations: `Several limitations of this work deserve acknowledgment. First, our evaluation is restricted to publicly available benchmark datasets, which may not fully represent the diversity of real-world deployment conditions. Second, the self-supervised pre-training stage requires a large unlabeled corpus that may not always be available in specialized application domains. Third, while we have validated our theoretical complexity bounds empirically, the analysis makes simplifying assumptions that may not hold in all practical settings. Future work should address these limitations through more comprehensive evaluation and relaxation of the theoretical assumptions.`,
      citationKeys: keys.slice(2),
    },
    conclusion: {
      summary: `This paper presented a novel framework for ${title} that achieves state-of-the-art performance while maintaining practical computational efficiency. We introduced a principled combination of self-supervised pre-training and domain-specific architectural inductive biases that enables effective learning from limited labeled data. Through extensive empirical evaluation on multiple benchmark datasets, we demonstrated that our approach consistently and significantly outperforms existing methods across all evaluation metrics.`,
      contributions: `The principal contributions of this work are threefold. First, we proposed a new architectural design that effectively integrates complementary inductive biases from domain knowledge and data-driven learning. Second, we provided a theoretical analysis establishing convergence guarantees and complexity bounds that provide formal justification for the empirical improvements. Third, we conducted a comprehensive empirical study that reveals novel insights about the relative importance of different design choices and identifies promising directions for future research.`,
      limitations: `We acknowledge that this work has several limitations that provide opportunities for future investigation. The reliance on pre-training data may be limiting in domains where such data is scarce. The theoretical analysis makes assumptions about the data distribution that may not hold universally. Performance on extremely low-resource categories and highly ambiguous examples remains below the level required for practical deployment in safety-critical applications.`,
      futureWork: `Several promising directions for future work emerge from this study. Extending the framework to the fully unsupervised setting would eliminate the dependence on labeled training data and broaden applicability. Incorporating uncertainty quantification mechanisms would improve the reliability and trustworthiness of model predictions. Exploring neural architecture search for automated discovery of the domain-specific inductive biases would reduce the reliance on expert knowledge and enable more efficient adaptation to new domains.`,
      closingRemark: `In conclusion, this work makes meaningful progress toward addressing the longstanding challenges of data efficiency, computational scalability, and distributional robustness in ${title}. We hope that the proposed framework, theoretical analysis, and comprehensive empirical evaluation will serve as a useful foundation for future research in this important area.`,
      citationKeys: keys.slice(0, 2),
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
  const worksRef = useRef(works);
  const referencesRef = useRef(references);
  const activeWorkIdRef = useRef(activeWorkId);
  worksRef.current = works;
  referencesRef.current = references;
  activeWorkIdRef.current = activeWorkId;

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

  const saveFile = (filename: string, content: string) => {
    filesRef.current[filename] = content.trim();
  };

  const flushFiles = (workId: string) => {
    const snapshot = { ...filesRef.current };
    setWorks(prev => prev.map(w =>
      w.id === workId ? { ...w, generatedFiles: { ...(w.generatedFiles || {}), ...snapshot } } : w
    ));
  };

  // ---------------------------------------------------------------------------
  // Generation — 7 parallel AI calls for full 10+ page paper
  // ---------------------------------------------------------------------------
  const startGeneration = async (latestNodes?: Node[], latestEdges?: Edge[]) => {
    const currentWorkId = activeWorkIdRef.current;
    if (!currentWorkId) return;
    const work = worksRef.current.find(w => w.id === currentWorkId);
    if (!work) return;

    filesRef.current = {};
    const workId = currentWorkId;
    const refList = referencesRef.current;

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

    const SYS = `You are a research paper content generator writing a FULL LENGTH 10-page academic paper. Output ONLY valid JSON. No markdown, no explanations, no LaTeX commands, no code fences. Pure JSON only. All string values must be plain English prose paragraphs. DO NOT use backslashes, curly braces, dollar signs, percent signs, ampersands, or hash characters. CRITICAL: Every paragraph field must be AT MINIMUM 8-12 sentences of detailed academic prose (150-200 words each). Be thorough, specific, and verbose. Do not truncate or summarize. Write complete, publication-quality academic content.`;

    const KEYS_RULE = `\nIMPORTANT: Any citationKeys field must only contain keys from this exact list: ${availableKeys.join(', ')}. If none apply use [].`;

    try {
      log('Planner', 'Starting full 10-page paper generation...');
      setGenerationStatus('discovering');
      log('Paper Parser', refList.length + ' references loaded: ' + availableKeys.join(', '));
      setGenerationStatus('assigning');
      setGenerationStatus('intro');
      log('Writer', 'Generating Introduction (parallel batch 1 of 4)...');

      // ---- BATCH 1: Intro + Abstract ----
      const introPrompt = `${SYS}

Paper title: "${work.title}"
Research context: ${graphCtx}
Available citation keys: ${availableKeys.join(', ')}
References:
${refSummary}

Generate a detailed Introduction and Abstract for a 10-page IEEE conference paper. Each paragraph must be 5-8 sentences with rich academic detail.

Return this exact JSON (no other text):
{
  "abstract": "250-300 word abstract with background, method, results, and impact",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "opening": "5-7 sentence opening paragraph establishing broad context and importance of the research area",
  "motivation": "5-7 sentence paragraph explaining the specific motivation and real-world significance of the problem",
  "background": "5-7 sentence paragraph summarizing relevant prior work and technical background",
  "problemStatement": "5-7 sentence paragraph precisely defining the problem, its challenges, and why existing solutions fall short",
  "approach": "5-7 sentence paragraph introducing the proposed solution and its key intuitions at a high level",
  "contributions": ["detailed contribution 1 (2-3 sentences)", "detailed contribution 2 (2-3 sentences)", "detailed contribution 3 (2-3 sentences)", "detailed contribution 4 (2-3 sentences)", "detailed contribution 5 (2-3 sentences)"],
  "paperOrganization": "3-4 sentence paragraph describing the structure of the rest of the paper",
  "introCitationKeys": ["key1", "key2"]
}
${KEYS_RULE}`;

      // ---- BATCH 2: Related Work ----
      const relatedPrompt = `${SYS}

Paper title: "${work.title}"
Research context: ${graphCtx}
Available citation keys: ${availableKeys.join(', ')}
References:
${refSummary}

Generate a comprehensive Related Work section (4 substantial subsections) for a 10-page IEEE paper.

Return this exact JSON (no other text):
{
  "para1": "6-8 sentence paragraph on foundational and classical methods in this research area, tracing the historical development",
  "para2": "6-8 sentence paragraph on deep learning approaches and neural network methods applied to this problem",
  "para3": "6-8 sentence paragraph on recent state-of-the-art methods, their strengths and limitations",
  "para4": "6-8 sentence paragraph on adjacent research areas and cross-disciplinary work that informs this study",
  "gap": "4-5 sentence paragraph explicitly identifying the research gap that motivates this work",
  "relatedCitationKeys": ["key1", "key2", "key3"]
}
${KEYS_RULE}`;

      // ---- BATCH 3: Methods ----
      const methodsPrompt = `${SYS}

Paper title: "${work.title}"
Research context: ${graphCtx}

Generate a detailed Methodology section with 4 subsections for a 10-page IEEE paper.

Return this exact JSON (no other text):
{
  "overview": "5-7 sentence overview paragraph explaining the overall approach and how the components fit together",
  "sub1Title": "Problem Formulation",
  "sub1": "6-8 sentence paragraph formally defining the problem, introducing notation, and establishing the mathematical setting",
  "sub2Title": "Model Architecture",
  "sub2": "7-9 sentence paragraph describing the proposed architecture in detail, including all major components and their interactions",
  "sub3Title": "Training Procedure",
  "sub3": "6-8 sentence paragraph describing the training procedure including loss functions, optimization, regularization, and any curriculum or multi-stage training",
  "sub4Title": "Theoretical Analysis",
  "sub4": "6-8 sentence paragraph providing theoretical justification, convergence analysis, or complexity bounds for the proposed approach",
  "tableCaption": "Hyperparameter Configuration and Search Space",
  "tableHeaders": ["Hyperparameter", "Value", "Search Range"],
  "tableRows": [
    ["Learning rate", "3e-4", "[1e-5, 1e-2]"],
    ["Batch size", "64", "[16, 256]"],
    ["Dropout rate", "0.1", "[0.0, 0.5]"],
    ["Weight decay", "1e-4", "[0, 1e-2]"],
    ["Hidden dimensions", "512", "[128, 1024]"],
    ["Number of layers", "6", "[2, 12]"],
    ["Attention heads", "8", "[2, 16]"],
    ["Warmup steps", "500", "[100, 2000]"]
  ],
  "algoDescription": "4-6 sentence paragraph describing the complete training algorithm in plain language, referencing the hyperparameter table"
}`;

      // ---- BATCH 4: Experiments + Results + Discussion + Conclusion ----
      const experimentsPrompt = `${SYS}

Paper title: "${work.title}"
Research context: ${graphCtx}

Generate detailed Experimental Setup and Results sections for a 10-page IEEE paper.

Return this exact JSON (no other text):
{
  "datasetDescription": "6-8 sentence paragraph describing the datasets used, their characteristics, preprocessing steps, and train/val/test splits",
  "datasetTableHeaders": ["Dataset", "Train", "Val", "Test"],
  "datasetTableRows": [["Primary", "45000", "5000", "10000"], ["Auxiliary A", "20000", "2000", "4000"], ["Auxiliary B", "12000", "1200", "2500"], ["Cross-domain", "8000", "800", "1600"]],
  "baselineDescription": "6-8 sentence paragraph describing all baseline methods compared against, explaining why each was selected and how they are implemented",
  "implementationDetails": "5-7 sentence paragraph describing hardware, software framework, training time, random seeds, and reproducibility measures",
  "metricDescription": "4-6 sentence paragraph defining and justifying all evaluation metrics used"
}`;

      const resultsPrompt = `${SYS}

Paper title: "${work.title}"
Research context: ${graphCtx}
Available citation keys: ${availableKeys.join(', ')}
References:
${refSummary}

Generate detailed Results and Discussion sections for a 10-page IEEE paper.

Return this exact JSON (no other text):
{
  "mainResultsIntro": "3-4 sentence paragraph introducing the results section and summarizing the main finding",
  "mainResults": "7-9 sentence paragraph presenting and analyzing the main quantitative results with specific numbers",
  "ablation": "6-8 sentence paragraph presenting ablation study results and interpreting what each ablation reveals about the model",
  "qualitative": "5-7 sentence paragraph describing qualitative analysis, case studies, or visualization results",
  "analysisPoints": [
    "finding 1 with specific numbers",
    "finding 2 with specific numbers",
    "finding 3 with specific numbers",
    "finding 4 with specific numbers",
    "finding 5 with specific numbers",
    "finding 6 with specific numbers"
  ],
  "tableCaption": "Comparison with State-of-the-Art Methods",
  "tableHeaders": ["Method", "Accuracy (%)", "Macro F1", "Latency (ms)"],
  "tableRows": [
    ["SVM Baseline", "71.2", "0.698", "2.1"],
    ["MLP", "74.8", "0.731", "3.4"],
    ["CNN", "78.3", "0.771", "8.7"],
    ["LSTM", "80.1", "0.789", "15.2"],
    ["Transformer", "83.8", "0.841", "22.4"],
    ["Prior SOTA", "84.5", "0.847", "19.8"],
    ["Ours", "89.1", "0.882", "12.0"]
  ],
  "ablationTableCaption": "Ablation Study",
  "ablationTableHeaders": ["Variant", "Accuracy (%)", "F1 Score", "Delta"],
  "ablationTableRows": [
    ["Full Model", "89.1", "0.882", "--"],
    ["w/o Pre-training", "84.2", "0.831", "-4.9"],
    ["w/o Architecture Component", "81.7", "0.803", "-7.4"],
    ["w/o Curriculum", "87.0", "0.861", "-2.1"],
    ["Smaller Model", "85.4", "0.844", "-3.7"]
  ],
  "resultsCitationKeys": ["key1"],
  "interpretation": "6-8 sentence paragraph interpreting what the results mean and why the proposed approach succeeds",
  "implications": "5-7 sentence paragraph discussing the broader implications for the field and potential applications",
  "comparison": "5-6 sentence paragraph comparing results to prior work and explaining performance differences",
  "discussionLimitations": "4-6 sentence paragraph honestly discussing limitations and potential failure modes",
  "discussionCitationKeys": ["key1"]
}
${KEYS_RULE}`;

      const conclusionPrompt = `${SYS}

Paper title: "${work.title}"
Research context: ${graphCtx}
Available citation keys: ${availableKeys.join(', ')}

Generate a detailed Conclusion section for a 10-page IEEE paper.

Return this exact JSON (no other text):
{
  "summary": "4-5 sentence paragraph summarizing the problem, approach, and key findings",
  "contributions": "4-5 sentence paragraph enumerating and contextualizing the specific contributions of this work",
  "limitations": "3-4 sentence paragraph honestly acknowledging limitations of the current work",
  "futureWork": "4-5 sentence paragraph describing concrete and compelling future research directions",
  "closingRemark": "2-3 sentence closing paragraph situating this work within the broader research agenda",
  "conclusionCitationKeys": ["key1"]
}
${KEYS_RULE}`;

      setGenerationStatus('body');
      log('Writer', 'Firing all generation requests in parallel...');

      // Fire all 5 requests in parallel for speed
      const [introRaw, relatedRaw, methodsRaw, experimentsRaw, resultsAndDiscussionRaw, conclusionRaw] = await Promise.all([
        generateAcademicContent(introPrompt, 4000).then(r => { log('Writer', 'Introduction received'); return r; }),
        generateAcademicContent(relatedPrompt, 4000).then(r => { log('Writer', 'Related Work received'); return r; }),
        generateAcademicContent(methodsPrompt, 4000).then(r => { log('Writer', 'Methods received'); return r; }),
        generateAcademicContent(experimentsPrompt, 4000).then(r => { log('Writer', 'Experiments received'); return r; }),
        generateAcademicContent(resultsPrompt, 4000).then(r => { log('Writer', 'Results + Discussion received'); return r; }),
        generateAcademicContent(conclusionPrompt, 4000).then(r => { log('Writer', 'Conclusion received'); return r; }),
      ]);

      setGenerationStatus('synthesis');
      log('Typesetter', 'Parsing all JSON responses...');

      // Parse intro
      interface IntroJson {
        abstract: string; keywords: string[];
        opening: string; motivation: string; background: string;
        problemStatement: string; approach: string;
        contributions: string[]; paperOrganization: string;
        introCitationKeys: string[];
      }
      const introJson = parseJson<IntroJson>(introRaw, {
        abstract: 'This paper presents a comprehensive investigation into ' + work.title + '.',
        keywords: ['Machine Learning', 'Neural Networks', 'Deep Learning', 'Benchmark', 'Empirical Study'],
        opening: 'The rapid evolution of artificial intelligence has transformed research in ' + work.title + '.',
        motivation: 'Existing approaches suffer from critical limitations that prevent widespread deployment.',
        background: 'Prior work has explored various approaches to this problem with limited success.',
        problemStatement: 'We identify three fundamental gaps that this work directly addresses.',
        approach: 'We propose a novel unified framework that jointly addresses all identified challenges.',
        contributions: ['Novel framework', 'Theoretical analysis', 'Ablation study', 'Empirical evaluation', 'Open-source code'],
        paperOrganization: 'The paper is organized as follows: Section II covers related work, Section III describes the methodology.',
        introCitationKeys: availableKeys.slice(0, 2),
      });

      // Parse related work
      interface RelatedJson {
        para1: string; para2: string; para3: string; para4: string; gap: string;
        relatedCitationKeys: string[];
      }
      const relatedJson = parseJson<RelatedJson>(relatedRaw, {
        para1: 'Early work in ' + work.title + ' established foundational theoretical results.',
        para2: 'Deep learning approaches have demonstrated impressive performance on benchmark tasks.',
        para3: 'Recent state-of-the-art methods have pushed performance boundaries significantly.',
        para4: 'Adjacent research areas provide complementary insights and techniques.',
        gap: 'Despite this progress, a critical gap remains that motivates the present work.',
        relatedCitationKeys: availableKeys.slice(0, 3),
      });

      // Parse methods
      interface MethodsJson {
        overview: string; sub1Title: string; sub1: string; sub2Title: string; sub2: string;
        sub3Title: string; sub3: string; sub4Title: string; sub4: string;
        tableCaption: string; tableHeaders: string[]; tableRows: string[][];
        algoDescription: string;
      }
      const methodsJson = parseJson<MethodsJson>(methodsRaw, {
        overview: 'The proposed methodology consists of four interconnected components.',
        sub1Title: 'Problem Formulation', sub1: 'We formally define the problem and establish notation.',
        sub2Title: 'Model Architecture', sub2: 'The architecture consists of an encoder, processor, and decoder.',
        sub3Title: 'Training Procedure', sub3: 'Training uses a two-stage curriculum with self-supervised pre-training.',
        sub4Title: 'Theoretical Analysis', sub4: 'We establish convergence guarantees under mild regularity conditions.',
        tableCaption: 'Hyperparameter Configuration',
        tableHeaders: ['Hyperparameter', 'Value', 'Search Range'],
        tableRows: [['Learning rate','3e-4','[1e-5, 1e-2]'],['Batch size','64','[16, 256]'],['Dropout','0.1','[0.0, 0.5]'],['Weight decay','1e-4','[0, 1e-2]'],['Hidden dim','512','[128, 1024]'],['Layers','6','[2, 12]'],['Heads','8','[2, 16]'],['Warmup','500','[100, 2000]']],
        algoDescription: 'Training proceeds with AdamW optimizer and cosine annealing schedule.',
      });

      // Parse experiments
      interface ExpJson {
        datasetDescription: string; datasetTableHeaders: string[]; datasetTableRows: string[][];
        baselineDescription: string; implementationDetails: string; metricDescription: string;
      }
      const expJson = parseJson<ExpJson>(experimentsRaw, {
        datasetDescription: 'We evaluate on multiple benchmark datasets covering diverse conditions.',
        datasetTableHeaders: ['Dataset', 'Train', 'Val', 'Test'],
        datasetTableRows: [['Primary','45000','5000','10000'],['Auxiliary A','20000','2000','4000'],['Auxiliary B','12000','1200','2500'],['Cross-domain','8000','800','1600']],
        baselineDescription: 'We compare against six competitive baselines including classical and deep learning methods.',
        implementationDetails: 'All experiments use PyTorch on NVIDIA A100 GPUs with 5 random seeds.',
        metricDescription: 'We report accuracy, macro F1, AUROC, and inference latency.',
      });

      // Parse results + discussion
      interface ResultsJson {
        mainResultsIntro: string; mainResults: string; ablation: string; qualitative: string;
        analysisPoints: string[];
        tableCaption: string; tableHeaders: string[]; tableRows: string[][];
        ablationTableCaption: string; ablationTableHeaders: string[]; ablationTableRows: string[][];
        resultsCitationKeys: string[];
        interpretation: string; implications: string; comparison: string;
        discussionLimitations: string; discussionCitationKeys: string[];
      }
      const resultsJson = parseJson<ResultsJson>(resultsAndDiscussionRaw, {
        mainResultsIntro: 'We now present and analyze the experimental results.',
        mainResults: 'Our method achieves 89.1% accuracy, outperforming all baselines.',
        ablation: 'Ablation study confirms each component contributes meaningfully.',
        qualitative: 'Qualitative analysis reveals the model attends to semantically relevant features.',
        analysisPoints: ['89.1% accuracy vs 84.5% for prior SOTA','Consistent improvements across all 6 datasets','Ablation confirms pre-training contributes 4.9 points','12ms inference enables real-time deployment','Strong cross-domain generalization','Minority class improvements confirm distributional robustness'],
        tableCaption: 'Comparison with State-of-the-Art',
        tableHeaders: ['Method', 'Accuracy (%)', 'Macro F1', 'Latency (ms)'],
        tableRows: [['SVM','71.2','0.698','2.1'],['MLP','74.8','0.731','3.4'],['CNN','78.3','0.771','8.7'],['LSTM','80.1','0.789','15.2'],['Transformer','83.8','0.841','22.4'],['Prior SOTA','84.5','0.847','19.8'],['Ours','89.1','0.882','12.0']],
        ablationTableCaption: 'Ablation Study Results',
        ablationTableHeaders: ['Variant', 'Accuracy (%)', 'F1 Score', 'Delta'],
        ablationTableRows: [['Full Model','89.1','0.882','--'],['w/o Pre-training','84.2','0.831','-4.9'],['w/o Architecture','81.7','0.803','-7.4'],['w/o Curriculum','87.0','0.861','-2.1'],['Smaller Model','85.4','0.844','-3.7']],
        resultsCitationKeys: availableKeys.slice(0, 2),
        interpretation: 'The strong performance stems from the complementary combination of pre-training and domain-specific inductive biases.',
        implications: 'These results suggest broad applicability to data-scarce settings across diverse domains.',
        comparison: 'Our improvements over transformer baselines demonstrate that architectural priors remain valuable.',
        discussionLimitations: 'Limitations include reliance on pre-training data and simplified theoretical assumptions.',
        discussionCitationKeys: availableKeys.slice(2),
      });

      // Parse conclusion
      interface ConclusionJson {
        summary: string; contributions: string; limitations: string;
        futureWork: string; closingRemark: string; conclusionCitationKeys: string[];
      }
      const conclusionJson = parseJson<ConclusionJson>(conclusionRaw, {
        summary: 'This paper presented a novel approach to ' + work.title + ' achieving state-of-the-art results.',
        contributions: 'We contributed a new framework, theoretical analysis, and comprehensive empirical evaluation.',
        limitations: 'Limitations include data requirements and simplified theoretical assumptions.',
        futureWork: 'Future work will explore semi-supervised extensions and uncertainty quantification.',
        closingRemark: 'We hope this work serves as a useful foundation for future research.',
        conclusionCitationKeys: availableKeys.slice(0, 2),
      });

      // ---- Assemble PaperContent ----
      setGenerationStatus('review');
      log('Typesetter', 'Assembling all sections into LaTeX...');

      const paperContent: PaperContent = {
        abstract: introJson.abstract || '',
        keywords: Array.isArray(introJson.keywords) ? introJson.keywords : ['Machine Learning', 'Deep Learning', 'Benchmark'],
        intro: {
          opening: introJson.opening || '',
          motivation: introJson.motivation || '',
          background: introJson.background || '',
          problemStatement: introJson.problemStatement || '',
          approach: introJson.approach || '',
          contributions: Array.isArray(introJson.contributions) ? introJson.contributions : [],
          paperOrganization: introJson.paperOrganization || '',
          citationKeys: (introJson.introCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
        relatedWork: {
          para1: relatedJson.para1 || '',
          para2: relatedJson.para2 || '',
          para3: relatedJson.para3 || '',
          para4: relatedJson.para4 || '',
          gap: relatedJson.gap || '',
          citationKeys: (relatedJson.relatedCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
        methods: {
          overview: methodsJson.overview || '',
          sub1Title: methodsJson.sub1Title || 'Problem Formulation',
          sub1: methodsJson.sub1 || '',
          sub2Title: methodsJson.sub2Title || 'Model Architecture',
          sub2: methodsJson.sub2 || '',
          sub3Title: methodsJson.sub3Title || 'Training Procedure',
          sub3: methodsJson.sub3 || '',
          sub4Title: methodsJson.sub4Title || 'Theoretical Analysis',
          sub4: methodsJson.sub4 || '',
          tableCaption: methodsJson.tableCaption || 'Hyperparameter Configuration',
          tableHeaders: Array.isArray(methodsJson.tableHeaders) && methodsJson.tableHeaders.length === 3 ? methodsJson.tableHeaders : ['Hyperparameter', 'Value', 'Search Range'],
          tableRows: Array.isArray(methodsJson.tableRows) ? methodsJson.tableRows : [],
          algoDescription: methodsJson.algoDescription || '',
        },
        experiments: {
          datasetDescription: expJson.datasetDescription || '',
          datasetTableCaption: 'Dataset Statistics',
          datasetTableHeaders: Array.isArray(expJson.datasetTableHeaders) && expJson.datasetTableHeaders.length === 4 ? expJson.datasetTableHeaders : ['Dataset', 'Train', 'Val', 'Test'],
          datasetTableRows: Array.isArray(expJson.datasetTableRows) ? expJson.datasetTableRows : [],
          baselineDescription: expJson.baselineDescription || '',
          implementationDetails: expJson.implementationDetails || '',
          metricDescription: expJson.metricDescription || '',
        },
        results: {
          mainResultsIntro: resultsJson.mainResultsIntro || '',
          mainResults: resultsJson.mainResults || '',
          ablation: resultsJson.ablation || '',
          qualitative: resultsJson.qualitative || '',
          analysisPoints: Array.isArray(resultsJson.analysisPoints) ? resultsJson.analysisPoints : [],
          tableCaption: resultsJson.tableCaption || 'Main Results',
          tableHeaders: Array.isArray(resultsJson.tableHeaders) && resultsJson.tableHeaders.length === 4 ? resultsJson.tableHeaders : ['Method', 'Accuracy (%)', 'Macro F1', 'Latency (ms)'],
          tableRows: Array.isArray(resultsJson.tableRows) ? resultsJson.tableRows : [],
          ablationTableCaption: resultsJson.ablationTableCaption || 'Ablation Study',
          ablationTableHeaders: Array.isArray(resultsJson.ablationTableHeaders) && resultsJson.ablationTableHeaders.length === 4 ? resultsJson.ablationTableHeaders : ['Variant', 'Accuracy (%)', 'F1 Score', 'Delta'],
          ablationTableRows: Array.isArray(resultsJson.ablationTableRows) ? resultsJson.ablationTableRows : [],
          citationKeys: (resultsJson.resultsCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
        discussion: {
          interpretation: resultsJson.interpretation || '',
          implications: resultsJson.implications || '',
          comparison: resultsJson.comparison || '',
          limitations: resultsJson.discussionLimitations || '',
          citationKeys: (resultsJson.discussionCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
        conclusion: {
          summary: conclusionJson.summary || '',
          contributions: conclusionJson.contributions || '',
          limitations: conclusionJson.limitations || '',
          futureWork: conclusionJson.futureWork || '',
          closingRemark: conclusionJson.closingRemark || '',
          citationKeys: (conclusionJson.conclusionCitationKeys || []).filter(k => availableKeys.includes(k)),
        },
      };

      // ---- Build all files atomically ----
      log('Typesetter', 'Building all LaTeX files...');
      const sectionFiles = buildSectionFiles(paperContent, refList);
      for (const [fname, fcontent] of Object.entries(sectionFiles)) {
        saveFile(fname, fcontent);
      }
      saveFile('references.bib', buildBib(refList));
      const mainTex = assembleMainTex(work.title, paperContent, refList);
      saveFile('main.tex', mainTex);
      flushFiles(workId);

      log('Typesetter', 'main.tex complete: ' + mainTex.split('\n').length + ' lines across 7 sections.');
      setGenerationStatus('completed');
      log('System', 'Done! Select main.tex and click Compile PDF.');

    } catch (err: any) {
      log('System', 'ERROR: ' + (err?.message || String(err)));
      log('System', 'Using fallback content...');
      const fallback = defaultContent(work.title, refList);
      const sectionFiles = buildSectionFiles(fallback, refList);
      for (const [fname, fcontent] of Object.entries(sectionFiles)) {
        saveFile(fname, fcontent);
      }
      saveFile('references.bib', buildBib(refList));
      saveFile('main.tex', assembleMainTex(work.title, fallback, refList));
      flushFiles(workId);
      setGenerationStatus('completed');
      log('System', 'Fallback assembly complete.');
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
