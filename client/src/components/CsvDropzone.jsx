import React, { useRef, useState, useCallback } from 'react';
import Papa from 'papaparse';

const REQUIRED_COLUMNS = ['Reference', 'Org Postal Code', 'Dst Postal Code', 'Class', 'Net Wt Lb'];

export default function CsvDropzone({ onDataLoaded, onClear }) {
  const fileRef = useRef();
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message, preview?, headers? }

  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith('.csv')) {
      setStatus({ type: 'error', message: 'Please select a .csv file' });
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0 && result.data.length === 0) {
          setStatus({ type: 'error', message: `CSV parse error: ${result.errors[0].message}` });
          return;
        }

        const headers = result.meta.fields || [];
        const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
        if (missing.length > 0) {
          setStatus({
            type: 'error',
            message: `Missing required columns: ${missing.join(', ')}`,
          });
          onDataLoaded(null);
          return;
        }

        const rows = result.data;
        setStatus({
          type: 'success',
          message: `${rows.length} rows loaded`,
          preview: rows.slice(0, 5),
          headers,
        });
        onDataLoaded(rows);
      },
    });
  }, [onDataLoaded]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  }, [processFile]);

  const handleClear = () => {
    setStatus(null);
    onClear();
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="flex-1 flex flex-col">
      {!status && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex-1 min-h-[200px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors
            ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
        >
          <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm text-gray-600 font-medium">Drag and drop CSV here, or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">.csv files only</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => processFile(e.target.files[0])} />
        </div>
      )}

      {status?.type === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700 text-sm font-medium">{status.message}</p>
          <button onClick={handleClear} className="text-xs text-red-500 mt-2 hover:text-red-700">Try again</button>
        </div>
      )}

      {status?.type === 'success' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-green-700 font-medium text-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              {status.message}
            </span>
            <button onClick={handleClear} className="text-xs text-gray-500 hover:text-gray-700 ml-auto">Clear</button>
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-50">
                  {status.headers.slice(0, 20).map(h => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap border-b">{h}</th>
                  ))}
                  {status.headers.length > 20 && (
                    <th className="px-2 py-1.5 text-gray-400 border-b">+{status.headers.length - 20} more</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {status.preview.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {status.headers.slice(0, 20).map(h => (
                      <td key={h} className="px-2 py-1 whitespace-nowrap text-gray-700">{row[h] || ''}</td>
                    ))}
                    {status.headers.length > 20 && <td className="px-2 py-1 text-gray-400">...</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
