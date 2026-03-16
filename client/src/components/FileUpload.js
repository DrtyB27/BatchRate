import React, { useRef, useState } from 'react';

function FileUpload({ onUpload, loading }) {
  const fileRef = useRef();
  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0] || null);
  };

  const handleSubmit = () => {
    if (selectedFile) {
      onUpload(selectedFile);
    }
  };

  const downloadSample = () => {
    const csv = 'origin_zip,dest_zip,weight_lbs,freight_class,pieces\n10001,90210,5000,70,4\n60601,30301,12000,85,8\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_lanes.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="file-upload">
        <button className="btn btn-select" onClick={() => fileRef.current.click()}>
          Select CSV File
        </button>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} />
        {selectedFile && <span className="file-name">{selectedFile.name}</span>}
        <button
          className="btn btn-upload"
          onClick={handleSubmit}
          disabled={!selectedFile || loading}
        >
          {loading ? 'Rating...' : 'Rate Shipments'}
        </button>
      </div>
      <div className="sample-link">
        <a onClick={downloadSample}>Download sample CSV template</a>
      </div>
    </div>
  );
}

export default FileUpload;
