import React, { useState, useCallback, useMemo } from 'react';
import { File, Lightbulb, BookOpen, X, Settings2, Play, Save, CalendarDays } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  Connection,
  Edge,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { v4 as uuidv4 } from 'uuid';

const CustomHandle = ({ type, position, id, className }: any) => (
  <Handle
    type={type}
    position={position}
    id={id}
    className={`w-3 h-3 bg-white border-2 border-slate-400 shadow-sm ${className}`}
  />
);

const StartNode = ({ id, data }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="w-[300px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2 font-semibold text-slate-700 text-sm">
          <div className="w-6 h-6 rounded bg-indigo-100 flex items-center justify-center text-indigo-600">
            <File className="w-3.5 h-3.5" />
          </div>
          Paper Start
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Start</span>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
            <span>Paper Title</span>
            <span className="text-[10px] text-slate-400 font-normal">string</span>
          </label>
          <input 
            type="text" 
            placeholder="Enter paper title..." 
            className="w-full text-sm border border-slate-200 rounded-md p-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none" 
            value={data.title || ''} 
            onChange={(e) => updateNodeData(id, { title: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
            <span>Target Venue</span>
            <span className="text-[10px] text-slate-400 font-normal">string</span>
          </label>
          <input 
            type="text" 
            placeholder="e.g., ICML, Nature..." 
            className="w-full text-sm border border-slate-200 rounded-md p-2 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none" 
            value={data.venue || ''} 
            onChange={(e) => updateNodeData(id, { venue: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
            <span>Deadline</span>
            <span className="text-[10px] text-slate-400 font-normal">date</span>
          </label>
          <div className="relative">
            <input
              type="date"
              className="w-full text-sm border border-slate-200 rounded-md p-2 pr-8 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              value={data.deadline || ''}
              onChange={(e) => updateNodeData(id, { deadline: e.target.value })}
            />
            <CalendarDays className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>
      <CustomHandle type="source" position={Position.Right} className="!bg-indigo-500 !border-white" />
    </div>
  );
};

const IdeaNode = ({ id, data }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="w-[300px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <CustomHandle type="target" position={Position.Left} className="!bg-slate-400 !border-white" />
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2 font-semibold text-slate-700 text-sm">
          <div className="w-6 h-6 rounded bg-amber-100 flex items-center justify-center text-amber-600">
            <Lightbulb className="w-3.5 h-3.5" />
          </div>
          Idea
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mr-1">Idea</span>
          <button className="text-slate-400 hover:text-slate-600 transition-colors">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
            <span>Body <span className="text-red-500">*</span></span>
            <span className="text-[10px] text-slate-400 font-normal">string</span>
          </label>
          <textarea 
            placeholder="Please input String" 
            className="w-full text-sm border border-slate-200 rounded-md p-2 h-20 focus:ring-1 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none" 
            value={data.body || ''}
            onChange={(e) => updateNodeData(id, { body: e.target.value })}
          />
        </div>
      </div>
      <CustomHandle type="source" position={Position.Right} className="!bg-amber-500 !border-white" />
    </div>
  );
};

const LiteratureNode = ({ id, data }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="w-[300px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <CustomHandle type="target" position={Position.Left} className="!bg-slate-400 !border-white" />
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2 font-semibold text-slate-700 text-sm">
          <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600">
            <BookOpen className="w-3.5 h-3.5" />
          </div>
          Literature
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mr-1">Lit</span>
          <button className="text-slate-400 hover:text-slate-600 transition-colors">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
            <span>Title</span>
            <span className="text-[10px] text-slate-400 font-normal">string</span>
          </label>
          <input 
            type="text" 
            className="w-full text-sm border border-slate-200 rounded-md p-2 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
            value={data.title || ''}
            onChange={(e) => updateNodeData(id, { title: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
            <span>File</span>
            <span className="text-[10px] text-slate-400 font-normal">file</span>
          </label>
          <label className="w-full text-sm border border-slate-200 border-dashed rounded-md p-2 bg-slate-50 text-slate-500 truncate text-center cursor-pointer hover:bg-slate-100 transition-colors block">
            {data.file || 'Upload file...'}
            <input 
              type="file" 
              className="hidden" 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  updateNodeData(id, { file: e.target.files[0].name });
                }
              }}
            />
          </label>
        </div>
      </div>
      <CustomHandle type="source" position={Position.Right} className="!bg-emerald-500 !border-white" />
    </div>
  );
};

function ResearchGraphContent({ setView }: { setView: (v: string) => void }) {
  const { works, activeWorkId, updateWorkGraph, startGeneration } = useAppContext();
  const activeWork = works.find(w => w.id === activeWorkId);
  const { getNodes, getEdges } = useReactFlow();
  
  const [nodes, setNodes, onNodesChange] = useNodesState(activeWork?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(activeWork?.edges || []);
  const [showGenModal, setShowGenModal] = useState(false);

  const nodeTypes = useMemo(() => ({ startNode: StartNode, ideaNode: IdeaNode, literatureNode: LiteratureNode }), []);

  const onConnect = useCallback((params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep', animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } } as any, eds)), [setEdges]);

  const handleSave = () => {
    if (activeWorkId) {
      // Get latest nodes from ReactFlow instance to ensure we have the updated data
      updateWorkGraph(activeWorkId, getNodes(), getEdges());
    }
  };

  const addNode = (type: string) => {
    const newNode = {
      id: `${type}-${uuidv4()}`,
      type: `${type}Node`,
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: type === 'idea' ? { body: '' } : { title: '', file: '' }
    };
    setNodes((nds) => nds.concat(newNode));
  };

  const handleGenerate = () => {
    handleSave();
    startGeneration(getNodes(), getEdges());
    setShowGenModal(false);
    setView('generation');
  };

  if (!activeWork) {
    return <div className="flex items-center justify-center h-[calc(100vh-4rem)]">Please select or create a work from Home.</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="h-20 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-serif font-semibold text-slate-900">{activeWork.title || 'Test Work'}</h1>
          <p className="text-slate-500 mt-1 text-sm">My research Work</p>
        </div>
        <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium shadow-sm hover:bg-indigo-700 transition-colors flex items-center gap-2">
          <Save className="w-4 h-4" /> Save
        </button>
      </div>
      <div className="flex flex-1">
      {/* Sidebar */}
      <div className="w-72 border-r border-slate-200 bg-white flex flex-col z-10">
        <div className="flex border-b border-slate-200 text-sm">
          <button className="flex-1 py-2.5 border-b-2 border-indigo-600 text-indigo-600 font-medium">Nodes</button>
          <button className="flex-1 py-2.5 text-slate-500 hover:text-slate-900 font-medium">References</button>
          <button className="flex-1 py-2.5 text-slate-500 hover:text-slate-900 font-medium">Work Info</button>
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="space-y-1.5">
             {nodes.map(node => (
               <div key={node.id} className="flex items-center gap-2.5 text-sm text-slate-700 p-2 hover:bg-slate-50 rounded-md cursor-pointer border border-transparent hover:border-slate-200 transition-colors">
                 {node.type === 'startNode' && <File className="w-4 h-4 text-indigo-500" />}
                 {node.type === 'ideaNode' && <Lightbulb className="w-4 h-4 text-amber-500" />}
                 {node.type === 'literatureNode' && <BookOpen className="w-4 h-4 text-emerald-500" />}
                 <span className="truncate">{node.id}</span>
               </div>
             ))}
          </div>
          <div className="mt-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Add Node</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => addNode('idea')} className="flex items-center justify-center gap-1.5 text-xs py-2 bg-white text-slate-700 rounded-md border border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition-colors shadow-sm">
                <Lightbulb className="w-3.5 h-3.5 text-amber-500"/> Idea
              </button>
              <button onClick={() => addNode('literature')} className="flex items-center justify-center gap-1.5 text-xs py-2 bg-white text-slate-700 rounded-md border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition-colors shadow-sm">
                <BookOpen className="w-3.5 h-3.5 text-emerald-500"/> Lit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative bg-slate-50">
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
           <button onClick={() => setShowGenModal(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium shadow-sm hover:bg-indigo-700 transition-colors flex items-center gap-2">
             <Play className="w-4 h-4" /> Generate Paper
           </button>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-slate-50"
        >
          <Background variant={BackgroundVariant.Dots} color="#94a3b8" gap={20} size={1.5} />
          <Controls className="bg-white border-slate-200 shadow-sm rounded-md overflow-hidden" />
          <MiniMap className="bg-white border-slate-200 shadow-sm rounded-md" maskColor="rgba(248, 250, 252, 0.8)" />
        </ReactFlow>
      </div>
      </div>

      {/* Generate Modal */}
      {showGenModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden text-left">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Generate Paper from Canvas</h2>
              <button onClick={() => setShowGenModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Style Guide</label>
                <select className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm">
                  <option>Nature</option>
                  <option>IEEE</option>
                  <option>Science</option>
                </select>
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300" />
                  <span className="text-sm text-slate-700">Enable Planning</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300" />
                  <span className="text-sm text-slate-700">Enable Review Loop</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setShowGenModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-md font-medium text-sm transition-colors">
                  Cancel
                </button>
                <button onClick={handleGenerate} className="px-4 py-2 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 text-sm transition-colors flex items-center gap-2">
                  <Play className="w-4 h-4" /> Start Generation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResearchGraph({ setView }: { setView: (v: string) => void }) {
  return (
    <ReactFlowProvider>
      <ResearchGraphContent setView={setView} />
    </ReactFlowProvider>
  );
}
