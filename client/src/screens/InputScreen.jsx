import React, { useState, useCallback } from 'react';
import ParametersSidebar from '../components/ParametersSidebar.jsx';
import CsvDropzone from '../components/CsvDropzone.jsx';

const DEFAULT_PARAMS = {
  contRef: '',
  contractStatus: 'BeingEntered',
  clientTPNum: '',
  carrierTPNum: '',
  skipSafety: true,
  contractUse: ['ClientCost'],
  useRoutingGuides: false,
  forceRoutingGuideName: '',
  numberOfRates: 4,
  showTMSMarkup: false,
  margins: [],
  saveRequestXml: true,
  saveResponseXml: true,
};

export default function InputScreen({ onBatchStart, onResultRow }) {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [csvRows, setCsvRows] = useState(null);
  const [running, setRunning] = useState(false);

  const handleDataLoaded = useCallback((rows) => {
    setCsvRows(rows);
  }, []);

  const handleClear = useCallback(() => {
    setCsvRows(null);
  }, []);

  const handleRunBatch = async () => {
    if (!csvRows || csvRows.length === 0) return;
    setRunning(true);

    // Signal batch start
    onBatchStart(params, csvRows.length);

    try {
      const res = await fetch('/api/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rows: csvRows, params }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Batch request failed');
      }

      // Read NDJSON stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const row = JSON.parse(line);
              onResultRow(row);
            } catch {}
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const row = JSON.parse(buffer);
          onResultRow(row);
        } catch {}
      }
    } catch (err) {
      console.error('Batch error:', err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <ParametersSidebar params={params} setParams={setParams} />

      <main className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Batch Rate Input</h2>
          <button
            onClick={handleRunBatch}
            disabled={!csvRows || csvRows.length === 0 || running}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2 rounded-md transition-colors text-sm"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Running...
              </span>
            ) : 'Run Batch'}
          </button>
        </div>

        <CsvDropzone onDataLoaded={handleDataLoaded} onClear={handleClear} />
      </main>
    </div>
  );
}
