import React, { useMemo } from 'react';
import { applyMargin } from '../../services/ratingClient.js';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;
const fmtDelta = (v) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}`;

const SCENARIO_COLORS = ['#6B7280', '#0EA5E9', '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6'];

function getColor(idx, scenario) {
  if (scenario.isCurrentState) return SCENARIO_COLORS[0];
  if (scenario.isHistoricMatch) return SCENARIO_COLORS[1];
  if (scenario.isLowCost) return SCENARIO_COLORS[2];
  return SCENARIO_COLORS[Math.min(idx, SCENARIO_COLORS.length - 1)];
}

function MetricRow({ label, value, delta, deltaLabel }) {
  return (
    <div className="flex justify-between items-baseline py-1 border-b border-gray-50">
      <span className="text-gray-500 text-xs">{label}</span>
      <div className="text-right">
        <span className="text-xs font-semibold text-[#002144]">{value}</span>
        {delta != null && (
          <div className={`text-[10px] ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {deltaLabel || fmtDelta(delta)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScenarioSummary({ scenarios, currentStateResult, historicMatchResult, lowCostResult, view = 'internal', markups }) {
  const isCustomer = view === 'customer';

  // Compute customer spend for each scenario (approximate: apply margin to totalSpend / shipments)
  const customerSpends = useMemo(() => {
    if (!isCustomer || !markups) return {};
    const spends = {};
    for (const s of scenarios) {
      if (!s.result) continue;
      // Use per-lane breakdown to get more accurate customer pricing
      let custTotal = 0;
      for (const lb of Object.values(s.result.laneBreakdown || {})) {
        if (lb.awardedCost != null && lb.awardedSCAC) {
          const m = applyMargin(lb.awardedCost, lb.awardedSCAC, markups);
          custTotal += m.customerPrice;
        }
      }
      spends[s.id] = custTotal;
    }
    return spends;
  }, [scenarios, isCustomer, markups]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {scenarios.map((s, idx) => {
        const r = s.result;
        if (!r) return null;
        const color = getColor(idx, s);

        const displaySpend = isCustomer && customerSpends[s.id] != null ? customerSpends[s.id] : r.summary.totalSpend;
        const currentDisplaySpend = isCustomer && currentStateResult && customerSpends[scenarios.find(x => x.isCurrentState)?.id]
          ? customerSpends[scenarios.find(x => x.isCurrentState)?.id]
          : currentStateResult?.summary.totalSpend;

        // Savings vs Current State
        let savingsVsCurrent = null;
        let savingsVsCurrentPct = null;
        if (currentDisplaySpend != null && !s.isCurrentState) {
          savingsVsCurrent = currentDisplaySpend - displaySpend;
          savingsVsCurrentPct = currentDisplaySpend > 0
            ? (savingsVsCurrent / currentDisplaySpend) * 100 : 0;
        }

        // Savings vs Low Cost
        let savingsVsLowCost = null;
        if (lowCostResult && !s.isLowCost) {
          const lowCostSpend = isCustomer && customerSpends[scenarios.find(x => x.isLowCost)?.id] != null
            ? customerSpends[scenarios.find(x => x.isLowCost)?.id]
            : lowCostResult.summary.totalSpend;
          savingsVsLowCost = displaySpend - lowCostSpend;
        }

        // Historic Match specific
        const isHM = s.isHistoricMatch;
        let rateChangeSavings = null;
        let rateChangePct = null;
        let carrierOptSavings = null;
        if (!isCustomer && isHM && r.summary.rateChangeSavings != null) {
          rateChangeSavings = r.summary.rateChangeSavings;
          rateChangePct = r.summary.rateChangePct;
          if (lowCostResult) {
            carrierOptSavings = r.summary.totalSpend - lowCostResult.summary.totalSpend;
          }
        }

        // Margin % (internal only)
        let marginPct = null;
        if (!isCustomer && markups && customerSpends[s.id] != null && r.summary.totalSpend > 0) {
          marginPct = ((customerSpends[s.id] - r.summary.totalSpend) / customerSpends[s.id]) * 100;
        }

        return (
          <div key={s.id} className="bg-white rounded-lg border border-gray-200 shadow-sm min-w-[220px] flex-shrink-0">
            <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: `3px solid ${color}` }}>
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
                {s.name}
              </span>
            </div>
            <div className="px-3 py-2">
              <MetricRow label={isCustomer ? 'Customer Spend' : 'Total Spend'} value={fmtMoney(displaySpend)} />
              <MetricRow label="# Carriers" value={r.summary.carrierCount} />
              <MetricRow label="# Shipments" value={r.summary.shipmentsAwarded} />
              <MetricRow label="# Unserviced" value={r.summary.unservicedCount} />
              {!isCustomer && <MetricRow label="# Min Rated" value={r.summary.minRatedCount} />}
              {!isCustomer && <MetricRow label="Avg Disc % (excl min)" value={fmtPct(r.summary.avgDiscountPct)} />}
              {!isCustomer && marginPct != null && (
                <MetricRow
                  label="Expected Margin %"
                  value={fmtPct(marginPct)}
                  delta={marginPct}
                  deltaLabel={marginPct >= 0 ? 'Profitable' : 'Loss'}
                />
              )}
              {savingsVsCurrent != null && (
                <MetricRow
                  label="Savings vs Current"
                  value={fmtDelta(savingsVsCurrent)}
                  delta={savingsVsCurrent}
                  deltaLabel={`${savingsVsCurrentPct >= 0 ? '+' : ''}${savingsVsCurrentPct.toFixed(1)}%`}
                />
              )}
              {!isCustomer && isHM && rateChangeSavings != null && (
                <MetricRow
                  label="Rate Change vs Historic"
                  value={fmtDelta(rateChangeSavings)}
                  delta={rateChangeSavings}
                  deltaLabel={`${rateChangePct >= 0 ? '+' : ''}${rateChangePct.toFixed(1)}%`}
                />
              )}
              {!isCustomer && isHM && carrierOptSavings != null && (
                <MetricRow
                  label="Savings vs Low Cost"
                  value={fmtDelta(-carrierOptSavings)}
                  delta={-carrierOptSavings}
                />
              )}
              {!isHM && savingsVsLowCost != null && (
                <MetricRow
                  label="vs. Low Cost Award"
                  value={fmtDelta(-savingsVsLowCost)}
                  delta={-savingsVsLowCost}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
