import React, { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';

const EMPTY_ROW = { name: '', city: '', state: '', zipStart: '', zipEnd: '' };

/**
 * CustomerLocationManager — UI for uploading, pasting, and editing
 * a customer location list (LocationName, City, State, ZipStart, ZipEnd).
 *
 * Locations are persisted in the project save file (via parent state),
 * never in localStorage/sessionStorage.
 */
export default function CustomerLocationManager({ locations, onLocationsChange }) {
  const [editIdx, setEditIdx] = useState(null);
  const [editRow, setEditRow] = useState(EMPTY_ROW);
  const [addRow, setAddRow] = useState(null); // non-null when adding
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef(null);

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data
          .map(row => ({
            name: (row.LocationName || row.Name || row.name || '').trim(),
            city: (row.City || row.city || '').trim(),
            state: (row.State || row.state || '').trim(),
            zipStart: (row.ZipStart || row.zipStart || row['Zip Start'] || '').trim(),
            zipEnd: (row.ZipEnd || row.zipEnd || row['Zip End'] || '').trim(),
          }))
          .filter(r => r.name && r.zipStart);
        if (parsed.length > 0) {
          onLocationsChange(parsed);
        } else {
          alert('No valid rows found. Expected columns: LocationName, City, State, ZipStart, ZipEnd');
        }
      },
      error: () => alert('Failed to parse CSV file.'),
    });
    // Reset input so re-uploading same file triggers change
    e.target.value = '';
  }, [onLocationsChange]);

  const handleDelete = useCallback((idx) => {
    const next = locations.filter((_, i) => i !== idx);
    onLocationsChange(next);
    if (editIdx === idx) { setEditIdx(null); setEditRow(EMPTY_ROW); }
  }, [locations, onLocationsChange, editIdx]);

  const handleStartEdit = (idx) => {
    setEditIdx(idx);
    setEditRow({ ...locations[idx] });
    setAddRow(null);
  };

  const handleSaveEdit = () => {
    if (!editRow.name || !editRow.zipStart) return;
    const next = [...locations];
    next[editIdx] = { ...editRow };
    onLocationsChange(next);
    setEditIdx(null);
    setEditRow(EMPTY_ROW);
  };

  const handleCancelEdit = () => {
    setEditIdx(null);
    setEditRow(EMPTY_ROW);
  };

  const handleStartAdd = () => {
    setAddRow({ ...EMPTY_ROW });
    setEditIdx(null);
  };

  const handleSaveAdd = () => {
    if (!addRow.name || !addRow.zipStart) return;
    onLocationsChange([...locations, { ...addRow }]);
    setAddRow(null);
  };

  const handleClearAll = () => {
    onLocationsChange([]);
    setConfirmClear(false);
    setEditIdx(null);
    setAddRow(null);
  };

  return (
    <div className="space-y-3">
      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium bg-[#002144] text-white rounded hover:bg-[#003366]"
        >
          Upload CSV
        </button>
        <button
          onClick={handleStartAdd}
          className="px-3 py-1.5 text-xs font-medium bg-white text-[#002144] border border-[#002144] rounded hover:bg-gray-50"
        >
          + Add Row
        </button>
        {locations.length > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-red-600 font-medium">Clear all {locations.length} locations?</span>
              <button onClick={handleClearAll} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Yes</button>
              <button onClick={() => setConfirmClear(false)} className="px-2 py-1 bg-gray-200 rounded text-xs">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50"
            >
              Clear All
            </button>
          )
        )}
        <span className="text-xs text-gray-400 ml-auto">
          CSV columns: LocationName, City, State, ZipStart, ZipEnd
        </span>
      </div>

      {/* Table */}
      {locations.length > 0 || addRow ? (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-3 py-2">Location Name</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">ZIP Start</th>
                <th className="px-3 py-2">ZIP End</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => (
                editIdx === i ? (
                  <tr key={i} className="bg-blue-50">
                    <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded" value={editRow.name} onChange={e => setEditRow(r => ({ ...r, name: e.target.value }))} /></td>
                    <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded" value={editRow.city} onChange={e => setEditRow(r => ({ ...r, city: e.target.value }))} /></td>
                    <td className="px-2 py-1"><input className="w-16 px-1 py-0.5 text-sm border rounded" maxLength={2} value={editRow.state} onChange={e => setEditRow(r => ({ ...r, state: e.target.value.toUpperCase() }))} /></td>
                    <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded font-mono" value={editRow.zipStart} onChange={e => setEditRow(r => ({ ...r, zipStart: e.target.value }))} /></td>
                    <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded font-mono" value={editRow.zipEnd} onChange={e => setEditRow(r => ({ ...r, zipEnd: e.target.value }))} /></td>
                    <td className="px-2 py-1 flex gap-1">
                      <button onClick={handleSaveEdit} className="px-2 py-0.5 text-xs bg-green-600 text-white rounded">Save</button>
                      <button onClick={handleCancelEdit} className="px-2 py-0.5 text-xs bg-gray-300 rounded">Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-1.5 font-medium text-[#002144]">{loc.name}</td>
                    <td className="px-3 py-1.5">{loc.city}</td>
                    <td className="px-3 py-1.5">{loc.state}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{loc.zipStart}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{loc.zipEnd || '—'}</td>
                    <td className="px-3 py-1.5 flex gap-1">
                      <button onClick={() => handleStartEdit(i)} className="px-2 py-0.5 text-xs text-[#39b6e6] hover:underline">Edit</button>
                      <button onClick={() => handleDelete(i)} className="px-2 py-0.5 text-xs text-red-500 hover:underline">Del</button>
                    </td>
                  </tr>
                )
              ))}
              {addRow && (
                <tr className="bg-green-50">
                  <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded" placeholder="Name" value={addRow.name} onChange={e => setAddRow(r => ({ ...r, name: e.target.value }))} /></td>
                  <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded" placeholder="City" value={addRow.city} onChange={e => setAddRow(r => ({ ...r, city: e.target.value }))} /></td>
                  <td className="px-2 py-1"><input className="w-16 px-1 py-0.5 text-sm border rounded" placeholder="ST" maxLength={2} value={addRow.state} onChange={e => setAddRow(r => ({ ...r, state: e.target.value.toUpperCase() }))} /></td>
                  <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded font-mono" placeholder="64101" value={addRow.zipStart} onChange={e => setAddRow(r => ({ ...r, zipStart: e.target.value }))} /></td>
                  <td className="px-2 py-1"><input className="w-full px-1 py-0.5 text-sm border rounded font-mono" placeholder="64199 (opt)" value={addRow.zipEnd} onChange={e => setAddRow(r => ({ ...r, zipEnd: e.target.value }))} /></td>
                  <td className="px-2 py-1 flex gap-1">
                    <button onClick={handleSaveAdd} disabled={!addRow.name || !addRow.zipStart} className="px-2 py-0.5 text-xs bg-green-600 text-white rounded disabled:bg-gray-300">Add</button>
                    <button onClick={() => setAddRow(null)} className="px-2 py-0.5 text-xs bg-gray-300 rounded">Cancel</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 text-sm text-gray-400 border border-dashed border-gray-300 rounded-lg">
          No locations defined. Upload a CSV or add rows manually.
        </div>
      )}
    </div>
  );
}
