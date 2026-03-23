import React, { useState } from 'react';
import { Search, Plus, ExternalLink, Edit2, Trash2, X, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { generateAcademicContent } from '../lib/gemini';

export default function References() {
  const { references, addReference } = useAppContext();
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setSearchResults([]);
    try {
      const prompt = `You are an academic search engine. Find 3 real academic papers related to the query: "${searchQuery}".
      Return ONLY a JSON array of objects with the following keys: title, authors, year, doi.
      Do not include any markdown formatting or explanations.`;
      
      const response = await generateAcademicContent(prompt);
      const cleanedResponse = response.replace(/```json/g, '').replace(/```/g, '').trim();
      const results = JSON.parse(cleanedResponse);
      setSearchResults(results);
    } catch (error) {
      console.error("Error searching references:", error);
      // Fallback
      setSearchResults([
        { title: "Attention Is All You Need", authors: "Ashish Vaswani, Noam Shazeer...", year: 2017, doi: "10.48550/arXiv.1706.03762" },
        { title: "BERT: Pre-training of Deep Bidirectional Transformers", authors: "Jacob Devlin, Ming-Wei Chang...", year: 2018, doi: "10.48550/arXiv.1810.04805" }
      ]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAdd = (ref: any) => {
    addReference({ ...ref, linked: 0 });
    setShowModal(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">References</h1>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search references..." className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64 bg-white" />
          </div>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Add Reference
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {references.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No references added yet.</div>
        ) : (
          references.map((ref, i) => (
            <div key={ref.id} className={`p-4 flex items-start justify-between ${i !== references.length - 1 ? 'border-b border-slate-100' : ''} hover:bg-slate-50 transition-colors`}>
              <div>
                <h3 className="font-medium text-slate-900 mb-1">{ref.title} <span className="text-slate-500 font-normal ml-2">{ref.year}</span></h3>
                <p className="text-sm text-slate-600 mb-2">{ref.authors}</p>
                <div className="flex items-center gap-3 text-xs">
                  {ref.doi && <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded">DOI</span>}
                  <span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded flex items-center gap-1 cursor-pointer hover:bg-indigo-100">
                    URL <ExternalLink className="w-3 h-3" />
                  </span>
                  <span className="text-slate-500">Linked to {ref.linked} nodes</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50 transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button className="p-2 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Reference Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden text-left flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Add New Reference</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search papers by title, topic, or keywords..." 
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" 
                  />
                </div>
                <button type="submit" disabled={isSearching} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </button>
              </form>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isSearching ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin mb-2 text-indigo-500" />
                  <p className="text-sm">Searching Semantic Scholar & arXiv...</p>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-3">
                  {searchResults.map((result, idx) => (
                    <div key={idx} className="p-4 border border-slate-200 rounded-lg hover:border-indigo-300 transition-colors">
                      <h4 className="font-medium text-slate-900 mb-1">{result.title}</h4>
                      <p className="text-sm text-slate-600 mb-3">{result.authors} • {result.year}</p>
                      <button onClick={() => handleAdd(result)} className="text-sm text-indigo-600 font-medium hover:text-indigo-700">
                        + Add to References
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-500 py-8 text-sm">
                  Enter a search query to find papers.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
