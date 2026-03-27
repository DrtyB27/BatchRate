import React, { useMemo } from 'react';
import MarkupSlider from './MarkupSlider.jsx';
import { solveForTarget } from '../../services/analyticsEngine.js';

function fmt$(v) {
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function TargetSolver({ totalCost, historicSpend, onApplyMarkup }) {
  const [targetType, setTargetType] = React.useState('dual');
  const [savingsPct, setSavingsPct] = React.useState(8);
  const [marginPct, setMarginPct] = React.useState(10);

  const target = useMemo(() => {
    if (!totalCost || totalCost === 0) return null;
    if (targetType === 'savings') return solveForTarget(totalCost, historicSpend, { type: 'savings', savingsPct });
    if (targetType === 'margin') return solveForTarget(totalCost, historicSpend, { type: 'margin', marginPct });
    return solveForTarget(totalCost, historicSpend, { type: 'dual', savingsPct, marginPct });
  }, [totalCost, historicSpend, targetType, savingsPct, marginPct]);

  const hasHistoric = historicSpend > 0;

  return (
    <div className="space-y-3">
      {/* Target type selector */}
      <div className="flex gap-1">
        {hasHistoric && (
          <button
            onClick={() => setTargetType('savings')}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${targetType === 'savings' ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            Savings Target
          </button>
        )}
        <button
          onClick={() => setTargetType('margin')}
          className={`px-2 py-1 text-xs rounded font-medium transition-colors ${targetType === 'margin' ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
        >
          Margin Target
        </button>
        {hasHistoric && (
          <button
            onClick={() => setTargetType('dual')}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${targetType === 'dual' ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            Dual Target
          </button>
        )}
      </div>

      {/* Target sliders */}
      <div className="space-y-2">
        {(targetType === 'savings' || targetType === 'dual') && hasHistoric && (
          <div>
            <label className="text-[10px] font-medium text-gray-500 mb-0.5 block">Customer Savings Target</label>
            <MarkupSlider
              type="%"
              value={savingsPct}
              onValueChange={setSavingsPct}
              showTypeToggle={false}
            />
          </div>
        )}
        {(targetType === 'margin' || targetType === 'dual') && (
          <div>
            <label className="text-[10px] font-medium text-gray-500 mb-0.5 block">DLX Margin Target</label>
            <MarkupSlider
              type="%"
              value={marginPct}
              onValueChange={setMarginPct}
              showTypeToggle={false}
            />
          </div>
        )}
      </div>

      {/* Results */}
      {target && (
        <div className={`rounded-lg p-3 border ${target.feasible ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-sm font-bold ${target.feasible ? 'text-green-700' : 'text-red-700'}`}>
              {target.feasible ? '\u2705 FEASIBLE' : '\u274C NOT FEASIBLE'}
            </span>
          </div>

          {target.feasible ? (
            <div className="space-y-1 text-xs text-gray-700">
              <p>Recommended markup: <strong>{target.markup.toFixed(1)}%</strong></p>
              {hasHistoric && target.customerSaves != null && (
                <p>Customer saves: <strong>{fmt$(historicSpend * target.customerSaves / 100)}</strong> ({target.customerSaves.toFixed(1)}%)</p>
              )}
              <p>DLX margin: <strong>{fmt$(target.margin)}</strong> ({target.marginPct.toFixed(1)}%)</p>

              <button
                onClick={() => onApplyMarkup(Math.round(target.markup * 10) / 10)}
                className="mt-2 px-3 py-1.5 bg-[#002144] hover:bg-[#003366] text-white text-xs rounded font-medium transition-colors"
              >
                Apply This Markup
              </button>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-gray-700">
              <p>These targets are mutually exclusive.</p>
              {target.maxSavingsAtTargetMargin != null && (
                <p>Max customer savings at {marginPct}% margin: <strong>{target.maxSavingsAtTargetMargin.toFixed(1)}%</strong></p>
              )}
              {target.maxMarginAtTargetSavings != null && (
                <p>Max DLX margin at {savingsPct}% customer savings: <strong>{target.maxMarginAtTargetSavings.toFixed(1)}%</strong></p>
              )}
              <p className="text-gray-500 italic mt-1">Adjust one target to find a feasible solution.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
