import React from 'react';

function ResultsTable({ results }) {
  if (!results || results.length === 0) {
    return null;
  }

  return (
    <section className="results-section">
      <h2>Rating Results</h2>
      {results.map((lane) => (
        <div key={lane.rowIndex} className="results-lane">
          <div className="lane-header">
            <span>
              Lane {lane.rowIndex}: {lane.origin_zip} → {lane.dest_zip} |{' '}
              {lane.weight_lbs} lbs | Class {lane.freight_class} | {lane.pieces} pcs
            </span>
            {lane.error && <span className="lane-error">{lane.error}</span>}
          </div>

          {lane.rates.length > 0 ? (
            <table className="rate-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>SCAC</th>
                  <th>Total Cost</th>
                  <th>Transit Days</th>
                  <th>Service</th>
                  <th>Contract</th>
                </tr>
              </thead>
              <tbody>
                {lane.rates.map((rate, idx) => (
                  <tr key={idx}>
                    <td>{rate.carrier}</td>
                    <td>{rate.scac}</td>
                    <td>${rate.totalCost.toFixed(2)}</td>
                    <td>{rate.transitDays}</td>
                    <td>{rate.serviceType || '—'}</td>
                    <td>{rate.contract || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="no-rates">
              {lane.error ? 'No rates returned due to error' : 'No rates available'}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default ResultsTable;
