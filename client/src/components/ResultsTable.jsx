import React, { useState, useMemo } from 'react';
import { isMinimumRated } from '../services/analyticsEngine.js';

/**
 * Flatten results into one row per carrier per shipment.
 * Failed/no-rate rows get one row with blank carrier columns.
 * Adds isMinimumRated flag to each rate object.
 */
export function flattenResults(results) {
  const rows = [];
  for (const r of results) {
    if (r.rates && r.rates.length > 0) {
      for (const rate of r.rates) {
        rate.isMinimumRated = isMinimumRated(rate);
        rows.push({ ...r, rate, hasRate: true });
      }
    } else {
      rows.push({ ...r, rate: {}, hasRate: false });
    }
  }
  return rows;
}

/**
 * Compute low cost flags per Reference group.
 */
export function computeLowCostFlags(flatRows) {
  const groups = {};
  for (const row of flatRows) {
    const ref = row.reference || '';
    if (!groups[ref]) groups[ref] = [];
    groups[ref].push(row);
  }

  const flags = new Map();
  for (const [, group] of Object.entries(groups)) {
    const validRaw = group.filter(r => r.hasRate && r.rate.validRate !== 'false');
    const validCust = group.filter(r => r.hasRate && r.rate.validRate !== 'false');

    // Min raw total charge
    if (validRaw.length > 0) {
      const minRaw = Math.min(...validRaw.map(r => r.rate.totalCharge || Infinity));
      for (const r of validRaw) {
        if (r.rate.totalCharge === minRaw) {
          const key = flags.get(r) || {};
          key.lowCostRaw = true;
          flags.set(r, key);
        }
      }
    }

    // Min customer price
    if (validCust.length > 0) {
      const minCust = Math.min(...validCust.map(r => r.rate.customerPrice ?? r.rate.totalCharge ?? Infinity));
      for (const r of validCust) {
        const cp = r.rate.customerPrice ?? r.rate.totalCharge ?? Infinity;
        if (cp === minCust) {
          const key = flags.get(r) || {};
          key.lowCostCustomer = true;
          flags.set(r, key);
        }
      }
    }
  }
  return flags;
}

const COLUMNS = [
  // Shipment identity
  { key: 'reference', label: 'Reference', get: r => r.reference },
  { key: 'origCity', label: 'Orig City', get: r => r.origCity },
  { key: 'origState', label: 'Org State', get: r => r.origState },
  { key: 'origPostal', label: 'Org Postal Code', get: r => r.origPostal },
  { key: 'origCountry', label: 'Orig Cntry', get: r => r.origCountry },
  { key: 'destCity', label: 'Dst City', get: r => r.destCity },
  { key: 'destState', label: 'Dst State', get: r => r.destState },
  { key: 'destPostal', label: 'Dst Postal Code', get: r => r.destPostal },
  { key: 'destCountry', label: 'Dst Cntry', get: r => r.destCountry },
  // Input freight
  { key: 'inputClass', label: 'Class', get: r => r.inputClass },
  { key: 'inputNetWt', label: 'Net Wt Lb', get: r => r.inputNetWt },
  { key: 'inputPcs', label: 'Pcs', get: r => r.inputPcs },
  { key: 'inputHUs', label: 'Ttl HUs', get: r => r.inputHUs },
  { key: 'pickupDate', label: 'Pickup Date', get: r => r.pickupDate },
  // Carrier result
  { key: 'scac', label: 'SCAC', get: r => r.rate?.carrierSCAC || '', group: 'carrier' },
  { key: 'carrierName', label: 'Carrier Name', get: r => r.rate?.carrierName || '', group: 'carrier' },
  { key: 'contractRef', label: 'Contract Ref', get: r => r.rate?.contractRef || '', group: 'carrier' },
  { key: 'contractDesc', label: 'Contract Desc', get: r => r.rate?.contractDescription || '', group: 'carrier' },
  { key: 'strategyDesc', label: 'Strategy Desc', get: r => r.rate?.strategyDescription || '', group: 'carrier' },
  { key: 'tierId', label: 'Tier ID', get: r => r.rate?.tierId || '', group: 'carrier' },
  { key: 'ratingType', label: 'Rating Type', get: r => r.rate?.ratingType || '', group: 'carrier' },
  { key: 'fak', label: 'FAK', get: r => r.rate?.firstFAK || '', group: 'carrier' },
  // Raw pricing
  { key: 'tariffGross', label: 'Tariff Gross', get: r => r.rate?.tariffGross, fmt: 'money', view: 'raw' },
  { key: 'tariffDiscount', label: 'Tariff Discount', get: r => r.rate?.tariffDiscount, fmt: 'money', view: 'raw' },
  { key: 'tariffDiscPct', label: 'Tariff Disc %', get: r => r.rate?.tariffDiscountPct, fmt: 'pct', view: 'raw' },
  { key: 'tariffNet', label: 'Tariff Net', get: r => r.rate?.tariffNet, fmt: 'money', view: 'raw' },
  { key: 'netCharge', label: 'Net Charge', get: r => r.rate?.netCharge, fmt: 'money', view: 'raw' },
  { key: 'accTotal', label: 'Acc Total', get: r => r.rate?.accTotal, fmt: 'money', view: 'raw' },
  { key: 'totalCharge', label: 'TOTAL CHARGE', get: r => r.rate?.totalCharge, fmt: 'money', view: 'raw' },
  { key: 'minRated', label: 'Min Rated', get: r => r.rate?.isMinimumRated ? 'MIN' : '', special: 'minRated' },
  // Service
  { key: 'serviceDays', label: 'Service Days', get: r => r.rate?.serviceDays, group: 'carrier' },
  { key: 'serviceDesc', label: 'Service Desc', get: r => r.rate?.serviceDescription || '', group: 'carrier' },
  { key: 'estDelivery', label: 'Est. Delivery', get: r => r.rate?.estimatedDelivery || '', group: 'carrier' },
  { key: 'distance', label: 'Distance', get: r => r.rate?.distance, group: 'carrier' },
  { key: 'ratingDesc', label: 'Rating Desc', get: r => r.rate?.ratingDescription || '', group: 'carrier' },
  { key: 'origTerminal', label: 'Orig Terminal', get: r => r.rate?.origTerminalCity ? `${r.rate.origTerminalCode} - ${r.rate.origTerminalCity}` : '', group: 'carrier' },
  { key: 'destTerminal', label: 'Dest Terminal', get: r => r.rate?.destTerminalCity ? `${r.rate.destTerminalCode} - ${r.rate.destTerminalCity}` : '', group: 'carrier' },
  { key: 'validRate', label: 'Valid Rate', get: r => r.rate?.validRate || '', group: 'carrier' },
  // Margin & customer
  { key: 'marginType', label: 'Margin Type', get: r => r.rate?.marginType || '', view: 'customer' },
  { key: 'marginValue', label: 'Margin Value', get: r => r.rate?.marginValue, view: 'customer' },
  { key: 'customerPrice', label: 'CUSTOMER PRICE', get: r => r.rate?.customerPrice, fmt: 'money', view: 'customer' },
  // Low cost flags
  { key: 'lowCostRaw', label: 'Low Cost (raw)', get: () => '', view: 'raw', special: 'lowCostRaw' },
  { key: 'lowCostCustomer', label: 'Low Cost (cust)', get: () => '', view: 'customer', special: 'lowCostCustomer' },
  // Status
  { key: 'ratingMessage', label: 'Rating Message', get: r => r.ratingMessage || '' },
];

function fmtVal(val, fmt) {
  if (val == null || val === '') return '';
  if (fmt === 'money') return `$${Number(val).toFixed(2)}`;
  if (fmt === 'pct') return `${Number(val).toFixed(2)}%`;
  return String(val);
}

export default function ResultsTable({ flatRows, lowCostFlags, viewMode, onRowClick }) {
  const [sortCol, setSortCol] = useState('reference');
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState({});

  const visibleCols = useMemo(() => {
    return COLUMNS.filter(col => {
      if (viewMode === 'raw' && col.view === 'customer') return false;
      if (viewMode === 'customer' && col.view === 'raw') return false;
      return true;
    });
  }, [viewMode]);

  const filteredRows = useMemo(() => {
    let rows = [...flatRows];

    // Apply filters
    for (const [key, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      const col = COLUMNS.find(c => c.key === key);
      if (!col) continue;
      const lowerFilter = filterVal.toLowerCase();
      rows = rows.filter(r => {
        const cellVal = String(col.get(r) ?? '').toLowerCase();
        return cellVal.includes(lowerFilter);
      });
    }

    // Sort
    const col = COLUMNS.find(c => c.key === sortCol);
    if (col) {
      rows.sort((a, b) => {
        let va = col.get(a) ?? '';
        let vb = col.get(b) ?? '';
        if (col.fmt === 'money' || col.fmt === 'pct') {
          va = Number(va) || 0;
          vb = Number(vb) || 0;
        } else {
          va = String(va).toLowerCase();
          vb = String(vb).toLowerCase();
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }, [flatRows, filters, sortCol, sortDir]);

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-100">
            {visibleCols.map(col => (
              <th
                key={col.key}
                className="px-2 py-1.5 text-left font-semibold text-gray-600 whitespace-nowrap cursor-pointer hover:bg-gray-200 border-b"
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {sortCol === col.key && (
                  <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                )}
              </th>
            ))}
          </tr>
          <tr className="bg-gray-50">
            {visibleCols.map(col => (
              <th key={col.key} className="px-1 py-0.5 border-b">
                <input
                  className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs font-normal"
                  placeholder="Filter..."
                  value={filters[col.key] || ''}
                  onChange={e => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row, idx) => {
            const flags = lowCostFlags.get(row) || {};
            const isError = !row.hasRate;

            return (
              <tr
                key={idx}
                className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${isError ? 'bg-red-50' : ''}`}
                onClick={() => onRowClick(row)}
              >
                {visibleCols.map(col => {
                  let cellVal;
                  let bgClass = '';

                  if (col.special === 'minRated') {
                    cellVal = row.rate?.isMinimumRated ? 'MIN' : '';
                    if (row.rate?.isMinimumRated) bgClass = 'font-bold';
                  } else if (col.special === 'lowCostRaw') {
                    cellVal = flags.lowCostRaw ? '\u2713' : '';
                    if (flags.lowCostRaw) bgClass = 'bg-green-100';
                  } else if (col.special === 'lowCostCustomer') {
                    cellVal = flags.lowCostCustomer ? '\u2713' : '';
                    if (flags.lowCostCustomer) bgClass = 'bg-blue-100';
                  } else if (col.key === 'ratingMessage' && isError) {
                    cellVal = row.ratingMessage || 'No rates';
                    bgClass = 'text-red-600 font-medium';
                  } else {
                    cellVal = fmtVal(col.get(row), col.fmt);
                  }

                  const inlineStyle = col.special === 'minRated' && row.rate?.isMinimumRated
                    ? { backgroundColor: '#FFF3E0' } : undefined;

                  return (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 whitespace-nowrap ${bgClass}`}
                      style={inlineStyle}
                    >
                      {cellVal}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {filteredRows.length === 0 && (
        <div className="text-center text-gray-400 py-8 text-sm">No results yet</div>
      )}
    </div>
  );
}
