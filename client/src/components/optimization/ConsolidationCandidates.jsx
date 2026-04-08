import React, { useState, useMemo, useCallback } from 'react';
import { findConsolidationCandidates, WEIGHT_BREAKS } from '../../services/consolidationFinder.js';
import { rerateAllCandidates } from '../../services/consolidationRater.js';

function fmtMoney(v) {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v) { return Number(v || 0).toFixed(1) + '%'; }
function fmtNum(v) { return Number(v || 0).toLocaleString(); }

function confidenceLevel(currentBreak, targetBreak) {
  if (targetBreak >= 5000) return { label: 'Extreme', color: 'border-green-500 bg-green-50', barColor: 'bg-green-500', barPct: 100 };
  if (targetBreak >= 2000) return { label: 'Very High', color: 'border-green-400 bg-green-50', barColor: 'bg-green-400', barPct: 85 };
  if (targetBreak >= 1000) return { label: 'High', color: 'border-blue-500 bg-blue-50', barColor: 'bg-blue-500', barPct: 70 };
  if (targetBreak >= 500) return { label: 'Medium', color: 'border-amber-400 bg-amber-50', barColor: 'bg-amber-400', barPct: 50 };
  return { label: 'Low', color: 'border-gray-300 bg-gray-50', barColor: 'bg-gray-300', barPct: 30 };
}

function statusBadge(status) {
  switch (status) {
    case 'confirmed':
      return <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Confirmed</span>;
    case 'no-savings':
      return <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">No Savings</span>;
    case 'no-rates':
    case 'no-valid-rates':
      return <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">No Rates</span>;
    case 'error':
      return <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">Error</span>;
    case 'pending':
    default:
      return <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">Pending</span>;
  }
}

export default function ConsolidationCandidates({ flatRows, config, credentials, batchParams, onCandidatesUpdate }) {
  const [candidates, setCandidates] = useState(null);
  const [rerating, setRerating] = useState(false);
  const [rerateProgress, setRerateProgress] = useState(null);

  const handleFind = useCallback(() => {
    const found = findConsolidationCandidates(flatRows, config);
    setCandidates(found);
    if (onCandidatesUpdate) onCandidatesUpdate(found);
  }, [flatRows, config, onCandidatesUpdate]);

  const handleRerateAll = useCallback(async () => {
    if (!candidates || !credentials) return;
    setRerating(true);
    setRerateProgress({ completed: 0, total: candidates.filter(c => c.needsRerate && c.rerateStatus === 'pending').length });
    try {
      const updated = await rerateAllCandidates(
        candidates,
        credentials,
        batchParams,
        config,
        (completed, total, current) => setRerateProgress({ completed, total, current })
      );
      setCandidates(updated);
      if (onCandidatesUpdate) onCandidatesUpdate(updated);
    } finally {
      setRerating(false);
      setRerateProgress(null);
    }
  }, [candidates, credentials, batchParams, config, onCandidatesUpdate]);

  const handleRerateOne = useCallback(async (candidateId) => {
    if (!candidates || !credentials) return;
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    // Import dynamically to avoid circular deps
    const { rerateConsolidation } = await import('../../services/consolidationRater.js');
    const updated = await rerateConsolidation(candidate, credentials, batchParams);
    const newCandidates = candidates.map(c => c.id === candidateId ? updated : c);
    setCandidates(newCandidates);
    if (onCandidatesUpdate) onCandidatesUpdate(newCandidates);
  }, [candidates, credentials, batchParams, onCandidatesUpdate]);

  // Summary stats
  const summary = useMemo(() => {
    if (!candidates) return null;
    const total = candidates.length;
    const rerateCount = candidates.filter(c => c.needsRerate).length;
    const confirmed = candidates.filter(c => c.rerateStatus === 'confirmed');
    const noSavings = candidates.filter(c => c.rerateStatus === 'no-savings');
    const pending = candidates.filter(c => c.rerateStatus === 'pending' && c.needsRerate);
    const totalHeuristicSavings = candidates.reduce((s, c) =>
      s + c.individualTotalCost * c.estimatedSavingsPercent / 100, 0);
    const totalConfirmedSavings = confirmed.reduce((s, c) => s + (c.actualSavings || 0), 0);
    const totalLanes = new Set(candidates.map(c => `${c.lane.originZip}|${c.lane.destZip}`)).size;
    return { total, rerateCount, confirmed: confirmed.length, noSavings: noSavings.length,
      pending: pending.length, totalHeuristicSavings, totalConfirmedSavings, totalLanes };
  }, [candidates]);

  const hasCredentials = Boolean(credentials?.username && credentials?.baseURL);

  // Pre-find state
  if (!candidates) {
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center space-y-4">
            <div className="text-3xl text-gray-300">&#x2696;</div>
            <h3 className="text-sm font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
              Direct Consolidation Finder
            </h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              Scans batch results for same-lane shipments within the consolidation window whose combined weight
              crosses an LTL weight break threshold. No API calls — instant analysis.
            </p>
            <button
              onClick={handleFind}
              className="text-sm bg-[#39b6e6] hover:bg-[#2da0cc] text-white px-6 py-2.5 rounded-lg font-semibold transition-colors"
              style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
            >
              Find Direct Consolidations
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-3xl mx-auto text-center py-12 space-y-3">
          <div className="text-3xl text-gray-300">&#x2714;</div>
          <h3 className="text-sm font-semibold text-gray-500">No Consolidation Opportunities Found</h3>
          <p className="text-xs text-gray-400">
            No same-lane shipments within the {config.consolidationWindowDays}-day window cross a new weight break.
          </p>
          <button onClick={handleFind} className="text-xs text-[#39b6e6] hover:underline">Re-scan</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Header summary */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
              Direct Consolidation Opportunities
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {summary.total} candidates across {summary.totalLanes} lanes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleFind} className="text-[10px] text-gray-500 hover:text-gray-700 underline">
              Re-scan
            </button>
            {summary.pending > 0 && (
              <button
                onClick={handleRerateAll}
                disabled={rerating || !hasCredentials}
                className="text-xs bg-[#39b6e6] hover:bg-[#2da0cc] disabled:bg-gray-300 text-white px-4 py-1.5 rounded font-semibold transition-colors"
                style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
                title={!hasCredentials ? 'Credentials required — connect to 3G TMS first' : ''}
              >
                {rerating ? 'Rerating...' : `Rerate All (${summary.pending})`}
              </button>
            )}
          </div>
        </div>

        {/* Rerate progress bar */}
        {rerating && rerateProgress && (
          <div className="mb-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="bg-[#39b6e6] h-full rounded-full transition-all duration-300"
                  style={{ width: `${rerateProgress.total > 0 ? (rerateProgress.completed / rerateProgress.total) * 100 : 0}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-500 w-24 text-right">
                {rerateProgress.completed}/{rerateProgress.total} rated
              </span>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-[#002144]">{summary.total}</div>
            <div className="text-[10px] uppercase text-gray-500">Candidates</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-[#002144]">
              {summary.confirmed > 0
                ? fmtMoney(summary.totalConfirmedSavings)
                : `~${fmtMoney(summary.totalHeuristicSavings)}`}
            </div>
            <div className="text-[10px] uppercase text-gray-500">
              {summary.confirmed > 0 ? 'Confirmed Savings' : 'Est. Savings (heuristic)'}
            </div>
          </div>
          {summary.confirmed > 0 && (
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-green-600">{summary.confirmed}</div>
              <div className="text-[10px] uppercase text-gray-500">Confirmed</div>
            </div>
          )}
          {summary.noSavings > 0 && (
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-amber-600">{summary.noSavings}</div>
              <div className="text-[10px] uppercase text-gray-500">No Improvement</div>
            </div>
          )}
        </div>

        {/* Post-rerate summary */}
        {summary.confirmed > 0 && (
          <div className="mt-3 text-xs text-gray-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Rerated {summary.confirmed + summary.noSavings} candidates.{' '}
            <strong className="text-green-700">{summary.confirmed} confirmed savings ({fmtMoney(summary.totalConfirmedSavings)} total)</strong>.{' '}
            {summary.noSavings > 0 && <span className="text-amber-600">{summary.noSavings} no improvement.</span>}
          </div>
        )}
      </div>

      {!hasCredentials && summary.pending > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
          Connect to 3G TMS (via the credentials screen) to enable rerating. Heuristic savings estimates are shown below.
        </div>
      )}

      {/* Candidate cards */}
      <div className="space-y-3">
        {candidates.map((c, idx) => {
          const conf = confidenceLevel(c.currentMaxBreak, c.targetBreak);
          const isRerated = c.rerateStatus !== 'pending';
          const savings = c.actualSavings ?? (c.individualTotalCost * c.estimatedSavingsPercent / 100);
          const savingsPct = c.individualTotalCost > 0 ? (savings / c.individualTotalCost) * 100 : 0;

          return (
            <div
              key={c.id}
              className={`bg-white rounded-lg border-l-4 border border-gray-200 shadow-sm ${conf.color} overflow-hidden`}
            >
              <div className="px-4 py-3">
                {/* Card header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 font-medium">#{idx + 1}</span>
                    <span className="text-sm font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
                      {c.lane.originZip} &rarr; {c.lane.destZip}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      ({c.lane.originCity || ''}{c.lane.originState ? `, ${c.lane.originState}` : ''} &rarr;{' '}
                      {c.lane.destCity || ''}{c.lane.destState ? `, ${c.lane.destState}` : ''})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(c.rerateStatus)}
                    {!isRerated && hasCredentials && (
                      <button
                        onClick={() => handleRerateOne(c.id)}
                        className="text-[10px] text-[#39b6e6] hover:underline font-medium"
                      >
                        Rerate This
                      </button>
                    )}
                  </div>
                </div>

                {/* Shipment details */}
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mb-2">
                  <div>
                    <span className="text-gray-500">{c.shipments.length} shipments: </span>
                    <span className="font-medium text-[#002144]">
                      {c.individualWeights.map(w => `${w.toFixed(0)} lbs`).join(' + ')} = {c.combinedWeight.toFixed(0)} lbs
                    </span>
                  </div>
                  {c.pickupWindow.earliest && (
                    <div className="text-gray-500">
                      Pickup: {c.pickupWindow.earliest}{c.pickupWindow.latest !== c.pickupWindow.earliest ? ` – ${c.pickupWindow.latest}` : ''}
                      {c.pickupWindow.days > 0 && ` (${c.pickupWindow.days}d)`}
                    </div>
                  )}
                </div>

                {/* Break + confidence */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-xs">
                    <span className="text-gray-500">Break: </span>
                    <span className="font-semibold text-[#002144]">
                      {c.currentMaxBreak > 0 ? fmtNum(c.currentMaxBreak) : '<500'} &rarr; {fmtNum(c.targetBreak)}
                    </span>
                  </div>
                  <div className="flex-1 max-w-[120px]">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${conf.barColor}`} style={{ width: `${conf.barPct}%` }} />
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">{conf.label} confidence</span>
                </div>

                {/* Cost line */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
                  <div>
                    <span className="text-gray-500">Individual cost: </span>
                    <span className="font-medium">{fmtMoney(c.individualTotalCost)}</span>
                  </div>
                  {isRerated && c.reratedCost != null ? (
                    <div>
                      <span className="text-gray-500">Rerated: </span>
                      <span className="font-bold text-[#002144]">{fmtMoney(c.reratedCost)}</span>
                      {c.bestRateCarrier && (
                        <span className="text-gray-400 ml-1">({c.bestRateCarrier})</span>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span className="text-gray-500">Est. consolidated: </span>
                      <span className="font-medium text-gray-600">~{fmtMoney(c.estimatedConsolidatedCost)}</span>
                    </div>
                  )}
                  <div className={isRerated && c.actualSavings != null
                    ? (c.actualSavings > 0 ? 'text-green-600 font-bold' : 'text-amber-600 font-medium')
                    : 'text-gray-600 font-medium'
                  }>
                    {isRerated && c.actualSavings != null
                      ? (c.actualSavings > 0
                        ? `Savings: ${fmtMoney(c.actualSavings)} (${fmtPct(savingsPct)})`
                        : 'No savings')
                      : `~${fmtMoney(savings)} est.`
                    }
                  </div>
                </div>

                {/* Warnings */}
                {c.mixedClass && (
                  <div className="mt-2 text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 inline-flex items-center gap-1">
                    <span>&#x26A0;</span> Mixed class ({c.classes.join('/')}) — highest class {c.highestClass} used for rerate; FAK may apply
                  </div>
                )}
                {c.rerateStatus === 'error' && c.rerateMessage && (
                  <div className="mt-2 text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1">
                    {c.rerateMessage}
                  </div>
                )}
                {c.targetBreak >= 5000 && (
                  <div className="mt-2 text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-1 inline-flex items-center gap-1">
                    <span>&#x1F69B;</span> 5,000+ lbs — consider TL pricing for this lane
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Methodology note */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-[10px] text-gray-500 space-y-1">
        <div className="font-semibold text-gray-600 text-xs mb-1">How It Works</div>
        <div>&bull; Same-lane shipments (matching {config.consolidationMatchLevel === 'zip3' ? '3-digit' : '5-digit'} ZIP) within {config.consolidationWindowDays}-day window are grouped</div>
        <div>&bull; Groups whose combined weight crosses a new LTL weight break ({WEIGHT_BREAKS.join(', ')} lbs) are flagged as candidates</div>
        <div>&bull; Heuristic estimates assume 15-40% savings based on break crossed; rerating confirms actual tariff savings</div>
        <div>&bull; Rerating uses the highest freight class in the group (conservative) and the combined weight</div>
        <div className="pt-1 font-medium text-amber-600">Heuristic savings are estimates. Rerate for confirmed numbers.</div>
      </div>
    </div>
  );
}
