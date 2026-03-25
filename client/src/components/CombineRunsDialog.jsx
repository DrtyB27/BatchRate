import React, { useState, useRef } from 'react';
import { readJsonFile, validateRunFile, deserializeRun, combineRuns } from '../services/runPersistence.js';

export default function CombineRunsDialog({ currentResults, currentMeta, onCombine, onClose }) {
  const [loadedRuns, setLoadedRuns] = useState([]);
  const [strategy, setStrategy] = useState('keepAll');
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const currentRowCount = currentResults?.length || 0;
  const totalRows = currentRowCount + loadedRuns.reduce((s, r) => s + r.results.length, 0);

  const handleAddFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    setError(null);
    for (const file of files) {
      try {
        const json = await readJsonFile(file);
        const validation = validateRunFile(json);
        if (!validation.valid) throw new Error(validation.errors.join(', '));
        const run = deserializeRun(json);
        setLoadedRuns(prev => [...prev, run]);
      } catch (err) {
        setError(`Failed to load ${file.name}: ${err.message}`);
      }
    }
    e.target.value = '';
  };

  const handleRemoveRun = (index) => {
    setLoadedRuns(prev => prev.filter((_, i) => i !== index));
  };

  const handleCombine = () => {
    // Build current run object
    const currentRun = {
      batchId: currentMeta?.batchId || 'current',
      savedAt: currentMeta?.batchStartTime || new Date().toISOString(),
      metadata: currentMeta || {},
      results: currentResults || [],
    };

    const allRuns = [currentRun, ...loadedRuns];
    const combined = combineRuns(allRuns, strategy);
    onCombine(combined.results, combined.metadata);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="font-bold text-[#002144]">Combine Batch Runs</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current run */}
          <div className="text-xs">
            <span className="font-semibold text-gray-600">Current run:</span>{' '}
            <span className="font-mono">{(currentMeta?.batchId || 'live').slice(0, 8)}</span>{' '}
            ({currentRowCount} rows)
          </div>

          {/* Add files */}
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-300 rounded-lg py-3 text-xs text-gray-500 hover:border-[#39b6e6] hover:text-[#39b6e6] transition-colors"
          >
            + Add Run File(s)
          </button>
          <input ref={fileRef} type="file" accept=".json" multiple onChange={handleAddFiles} className="hidden" />

          {/* Loaded runs */}
          {loadedRuns.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-600">Loaded:</div>
              {loadedRuns.map((run, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-xs">
                  <div>
                    <span className="font-mono">{(run.batchId || 'unknown').slice(0, 8)}</span>
                    <span className="text-gray-400 ml-2">({run.results.length} rows)</span>
                    {run.savedAt && <span className="text-gray-400 ml-2">{new Date(run.savedAt).toLocaleDateString()}</span>}
                  </div>
                  <button onClick={() => handleRemoveRun(i)} className="text-red-400 hover:text-red-600">&times;</button>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          <div className="text-xs font-semibold text-[#002144]">
            Combined total: {totalRows} rows
          </div>

          {/* Deduplication strategy */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-gray-600">Deduplication:</div>
            {[
              { value: 'keepAll', label: 'Keep all rows (allow duplicate references)' },
              { value: 'keepLatest', label: "Keep latest run's row (by batchTimestamp)" },
              { value: 'keepBest', label: 'Keep best rate (lowest totalCharge)' },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="dedup"
                  value={opt.value}
                  checked={strategy === opt.value}
                  onChange={() => setStrategy(opt.value)}
                  className="text-[#39b6e6]"
                />
                {opt.label}
              </label>
            ))}
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          )}
        </div>

        <div className="border-t px-5 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700">Cancel</button>
          <button
            onClick={handleCombine}
            disabled={loadedRuns.length === 0}
            className="text-xs px-4 py-1.5 rounded bg-[#39b6e6] hover:bg-[#2d9bc4] disabled:bg-gray-300 text-white font-semibold transition-colors"
          >
            Combine
          </button>
        </div>
      </div>
    </div>
  );
}
