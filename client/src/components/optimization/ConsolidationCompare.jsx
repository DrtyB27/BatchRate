import React, { useMemo, useRef, useState } from 'react';
import { buildAwardLanes, buildConsolidationSankeyData } from '../../services/awardBridge.js';
import { computeSankeyData } from '../../services/analyticsEngine.js';
import CarrierSankey from '../CarrierSankey.jsx';

function fmtMoney(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPct(v) {
  return Number(v || 0).toFixed(1) + '%';
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString();
}

function KpiTile({ label, value, sub, color }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className={`text-lg font-bold ${color || 'text-[#002144]'}`} style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function CarrierTable({ rows, title, showType }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b px-3 py-2">
        <h4 className="text-xs font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>{title}</h4>
      </div>
      <div className="overflow-auto max-h-[300px]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-gray-600">
              <th className="px-3 py-1.5 text-left font-semibold">Carrier</th>
              {showType && <th className="px-3 py-1.5 text-center font-semibold">Type</th>}
              <th className="px-3 py-1.5 text-right font-semibold">Lanes</th>
              <th className="px-3 py-1.5 text-right font-semibold">Ann. Shipments</th>
              <th className="px-3 py-1.5 text-right font-semibold">Ann. Cost</th>
              <th className="px-3 py-1.5 text-right font-semibold">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.carrier + i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <td className="px-3 py-1.5">
                  <span className={`font-mono font-medium ${r.carrier === 'CONSOL' ? 'text-purple-700' : 'text-[#002144]'}`}>
                    {r.carrier}
                  </span>
                  {r.carrierName && <span className="text-gray-400 ml-1">{r.carrierName}</span>}
                </td>
                {showType && (
                  <td className="px-3 py-1.5 text-center">
                    {r.laneType === 'consolidation' ? (
                      <span className="text-[9px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">TL Linehaul</span>
                    ) : r.laneType === 'finalMile' ? (
                      <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">Final Mile</span>
                    ) : (
                      <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Direct</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 text-right">{r.lanes}</td>
                <td className="px-3 py-1.5 text-right">{fmtNum(r.annualShipments)}</td>
                <td className="px-3 py-1.5 text-right font-medium">{fmtMoney(r.annualCost)}</td>
                <td className="px-3 py-1.5 text-right text-gray-500">{fmtPct(r.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ConsolidationCompare({ optimizationResult, sampleWeeks, onBack, confirmedConsolidations }) {
  const [showSankey, setShowSankey] = useState(true);
  const directSankeyRef = useRef(null);
  const consolSankeyRef = useRef(null);

  const awardData = useMemo(
    () => buildAwardLanes(optimizationResult, sampleWeeks, confirmedConsolidations || null),
    [optimizationResult, sampleWeeks, confirmedConsolidations]
  );

  // Build Sankey data for consolidation view
  const consolSankeyData = useMemo(
    () => buildConsolidationSankeyData(awardData),
    [awardData]
  );

  // Build direct-scenario Sankey: group direct lanes by carrier as source and target (same carrier)
  const directSankeyData = useMemo(() => {
    // Build lanes compatible with computeSankeyData
    const lanesByCarrier = {};
    for (const dl of awardData.directLanes) {
      const key = `${dl.laneKey}|||${dl.carrier}`;
      if (!lanesByCarrier[key]) {
        lanesByCarrier[key] = {
          laneKey: dl.laneKey,
          carrierSCAC: dl.carrier,
          historicCarrier: dl.historicCarrier || dl.carrier,
          historicTotalAnnSpend: dl.historicCost ? dl.historicCost * (52 / Math.max(1, sampleWeeks)) : dl.annualCost,
          annualHistoric: dl.historicCost ? dl.historicCost * (52 / Math.max(1, sampleWeeks)) : dl.annualCost,
          annualSpend: 0,
        };
      }
      lanesByCarrier[key].annualSpend += dl.annualCost;
    }
    return computeSankeyData(Object.values(lanesByCarrier), 1);
  }, [awardData, sampleWeeks]);

  // Build carrier summary for direct scenario
  const directCarriers = useMemo(() => {
    const map = {};
    const total = awardData.directLanes.reduce((s, l) => s + l.annualCost, 0);
    for (const dl of awardData.directLanes) {
      if (!map[dl.carrier]) {
        map[dl.carrier] = { carrier: dl.carrier, carrierName: dl.carrierName, lanes: 0, annualShipments: 0, annualCost: 0, laneType: 'direct' };
      }
      map[dl.carrier].lanes++;
      map[dl.carrier].annualShipments += dl.annualShipments;
      map[dl.carrier].annualCost += dl.annualCost;
    }
    return Object.values(map)
      .map(c => ({ ...c, pct: total > 0 ? (c.annualCost / total) * 100 : 0 }))
      .sort((a, b) => b.annualCost - a.annualCost);
  }, [awardData]);

  // Build carrier summary for consolidation scenario
  const consolCarriers = useMemo(() => {
    const map = {};
    const { consolidationLanes, finalMileLanes, directLanes, summary } = awardData;
    const total = summary.consolidatedTotalCost;

    // Consolidation legs
    for (const cl of consolidationLanes) {
      if (!map['CONSOL']) {
        map['CONSOL'] = { carrier: 'CONSOL', carrierName: 'Consolidation (TL Linehaul)', lanes: 0, annualShipments: 0, annualCost: 0, laneType: 'consolidation' };
      }
      map['CONSOL'].lanes++;
      map['CONSOL'].annualShipments += cl.annualShipments;
      map['CONSOL'].annualCost += cl.annualCost;
    }

    // Final-mile legs
    for (const fl of finalMileLanes) {
      const key = `${fl.carrier}_fm`;
      if (!map[key]) {
        map[key] = { carrier: fl.carrier, carrierName: fl.carrierName, lanes: 0, annualShipments: 0, annualCost: 0, laneType: 'finalMile' };
      }
      map[key].lanes++;
      map[key].annualShipments += fl.annualShipments;
      map[key].annualCost += fl.annualCost;
    }

    // Direct (unconsolidated) shipments
    const consolidatedRefSet = new Set(consolidationLanes.flatMap(cl => cl.sourceShipmentIds));
    for (const dl of directLanes) {
      if (consolidatedRefSet.has(dl.sourceShipmentIds[0])) continue;
      const key = `${dl.carrier}_direct`;
      if (!map[key]) {
        map[key] = { carrier: dl.carrier, carrierName: dl.carrierName, lanes: 0, annualShipments: 0, annualCost: 0, laneType: 'direct' };
      }
      map[key].lanes++;
      map[key].annualShipments += dl.annualShipments;
      map[key].annualCost += dl.annualCost;
    }

    return Object.values(map)
      .map(c => ({ ...c, pct: total > 0 ? (c.annualCost / total) * 100 : 0 }))
      .sort((a, b) => b.annualCost - a.annualCost);
  }, [awardData]);

  const { summary } = awardData;
  const directLaneCount = new Set(awardData.directLanes.map(l => l.laneKey)).size;
  const consolLaneCount = summary.laneCount.consolidated + summary.laneCount.finalMile;
  const directCarrierCount = new Set(awardData.directLanes.map(l => l.carrier)).size;
  const consolCarrierSet = new Set([
    'CONSOL',
    ...awardData.finalMileLanes.map(l => l.carrier),
    ...awardData.directLanes
      .filter(l => !new Set(awardData.consolidationLanes.flatMap(cl => cl.sourceShipmentIds)).has(l.sourceShipmentIds[0]))
      .map(l => l.carrier),
  ]);

  return (
    <div className="flex-1 overflow-auto bg-[#F5F7FA] p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-xs text-gray-500 hover:text-[#002144] flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Optimization
          </button>
          <h2 className="text-lg font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            Consolidation Comparison
          </h2>
        </div>
      </div>

      {/* Savings banner */}
      <div className="rounded-xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #39B6E6, #002144)' }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-sm font-medium opacity-80">Estimated Annual Savings</div>
            <div className="text-3xl font-bold" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
              {fmtMoney(summary.estimatedSavings)}
            </div>
            <div className="text-sm opacity-80">{fmtPct(summary.savingsPercent)} reduction</div>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <div className="text-2xl font-bold">{summary.poolPointCount}</div>
              <div className="text-[10px] opacity-80 uppercase">Pool Points</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{fmtNum(summary.consolidatedShipments)}</div>
              <div className="text-[10px] opacity-80 uppercase">Ships Consolidated</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{summary.laneCount.consolidated}</div>
              <div className="text-[10px] opacity-80 uppercase">TL Lanes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side KPI panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Direct LTL Award panel */}
        <div className="space-y-3">
          <div className="bg-[#002144] text-white rounded-t-lg px-4 py-2" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            <h3 className="text-sm font-semibold">Direct LTL Award</h3>
            <p className="text-[10px] text-gray-300">All shipments rated individually, origin to destination</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <KpiTile label="Annual Cost" value={fmtMoney(summary.directTotalCost)} />
            <KpiTile label="Lanes" value={fmtNum(directLaneCount)} />
            <KpiTile label="Carriers" value={directCarrierCount} />
          </div>
        </div>

        {/* Consolidation Award panel */}
        <div className="space-y-3">
          <div className="rounded-t-lg px-4 py-2 text-white" style={{ background: '#39B6E6', fontFamily: "'Montserrat', Arial, sans-serif" }}>
            <h3 className="text-sm font-semibold">With Consolidation</h3>
            <p className="text-[10px] text-white/80">Consolidated via {summary.poolPointCount} pool points + LTL final mile</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <KpiTile label="Annual Cost" value={fmtMoney(summary.consolidatedTotalCost)} color="text-green-600" />
            <KpiTile
              label="Lanes"
              value={fmtNum(consolLaneCount)}
              sub={`${summary.laneCount.consolidated} TL + ${summary.laneCount.finalMile} FM`}
            />
            <KpiTile label="Carriers" value={consolCarrierSet.size} sub="+ CONSOL" />
          </div>
        </div>
      </div>

      {/* Sankey diagrams */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowSankey(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        >
          <div>
            <span className="text-sm font-bold text-[#002144]">Freight Flow Comparison</span>
            <span className="text-xs text-gray-400 ml-2">Direct carriers vs. consolidation routing</span>
          </div>
          <svg className={`w-4 h-4 text-gray-400 transform transition-transform ${showSankey ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showSankey && (
          <div className="border-t border-gray-200">
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
              <div className="p-3">
                <div className="text-[10px] uppercase text-gray-500 font-medium mb-2 text-center">Direct LTL — Carrier Flows</div>
                <CarrierSankey ref={directSankeyRef} data={directSankeyData} height={280} />
              </div>
              <div className="p-3">
                <div className="text-[10px] uppercase text-gray-500 font-medium mb-2 text-center">With Consolidation — Freight Routing</div>
                <CarrierSankey ref={consolSankeyRef} data={consolSankeyData} height={280} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Carrier tables side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CarrierTable rows={directCarriers} title="Direct LTL — Carrier Cost Breakdown" showType={false} />
        <CarrierTable rows={consolCarriers} title="With Consolidation — Cost Breakdown" showType={true} />
      </div>

      {/* Methodology note */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-[10px] text-gray-500 space-y-1">
        <div className="font-semibold text-gray-600 text-xs mb-1">Methodology</div>
        <div>&bull; Direct LTL: Each shipment's best rated cost, annualized from {sampleWeeks || '?'}-week sample (52/{sampleWeeks || '?'} = {(52 / Math.max(1, sampleWeeks || 1)).toFixed(1)}x factor)</div>
        <div>&bull; Consolidation: TL linehaul to pool point + handling + LTL final mile per destination</div>
        <div>&bull; <span className="font-mono text-purple-700">CONSOL</span> represents the consolidation activity (TL pickup, linehaul to pool point, handling). Real carriers handle final-mile LTL delivery.</div>
        <div className="pt-1 font-medium text-amber-600">All figures are estimates for bid strategy modeling. Actual costs will vary.</div>
      </div>
    </div>
  );
}
