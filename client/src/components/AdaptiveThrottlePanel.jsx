import React from 'react';
import { computeAdaptiveFloor, computeEffectiveFloor } from '../hooks/useAdaptiveConcurrency.js';

/**
 * Adaptive Concurrency Throttle panel.
 *
 * Renders next to the existing concurrency controls. Owns nothing;
 * the host component owns config + log state and passes them in.
 */
export default function AdaptiveThrottlePanel({
  config,
  onConfigChange,
  perAgentConcurrency,
  log,
  active,
  pendingRows = 0,
  calibrationState,
  onManualThresholdChange,
}) {
  const update = (key, value) => onConfigChange({ ...config, [key]: value });
  const mode = typeof config.mode === 'string'
    ? config.mode
    : (config.enabled ? 'active' : 'off');
  const enabled = mode !== 'off';
  const autoCalibrate = config.autoCalibrate !== false;

  const lastAdjustTs = log && log.length > 0 ? log[0].ts : null;
  const sinceMs = lastAdjustTs ? Date.now() - lastAdjustTs : null;
  const sinceLabel = sinceMs == null
    ? 'no adjustments yet'
    : `last adjusted ${formatAgo(sinceMs)} ago`;

  const manualFloor = config.minConcurrency ?? 2;
  const adaptiveFloor = computeAdaptiveFloor(pendingRows);
  const effectiveFloor = computeEffectiveFloor(manualFloor, pendingRows);

  const calPhase = calibrationState?.phase ?? 'idle';
  const calSamples = calibrationState?.samples ?? 0;
  const calBaseline = calibrationState?.baselineP95 ?? null;
  const calTarget = config.warmupSamples ?? 30;

  let calibStatus = null;
  if (!enabled) {
    calibStatus = null;
  } else if (!autoCalibrate) {
    calibStatus = <span className="text-gray-500">Manual thresholds</span>;
  } else if (calPhase === 'calibrating' || calPhase === 'idle') {
    calibStatus = <span className="text-amber-600 font-semibold">Calibrating {calSamples}/{calTarget}…</span>;
  } else if (calPhase === 'done') {
    calibStatus = (
      <span className="text-green-700 font-semibold">
        Calibrated to {config.upperP95Ms}/{config.lowerP95Ms}
        {calBaseline ? ` (baseline P95 ${Math.round(calBaseline)}ms)` : ''}
      </span>
    );
  } else if (calPhase === 'manual') {
    calibStatus = <span className="text-gray-500">Manual override — calibration aborted</span>;
  }

  const handleThresholdChange = (key, value) => {
    if (onManualThresholdChange && (key === 'upperP95Ms' || key === 'lowerP95Ms')) {
      onManualThresholdChange();
    }
    update(key, value);
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="bg-[#002144] text-white px-4 py-2 flex items-center gap-3 rounded-t-lg">
        <span className="text-xs font-bold uppercase tracking-wider">Adaptive Concurrency Throttle</span>
        <span className="ml-auto text-[10px] text-[#39B6E6]">P95 hysteresis</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Mode tri-state */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {[
            { val: 'off',     label: 'Off',           tip: 'Throttle inactive (default)' },
            { val: 'suggest', label: 'Suggest only',  tip: 'Log decisions without changing concurrency' },
            { val: 'active',  label: 'Active',        tip: 'Apply throttle decisions' },
          ].map(({ val, label, tip }) => (
            <label key={val} className="flex items-center gap-1.5 cursor-pointer" title={tip}>
              <input
                type="radio"
                name="throttle-mode"
                value={val}
                checked={mode === val}
                onChange={() => update('mode', val)}
                className="border-gray-300"
              />
              <span className={`text-xs font-semibold ${mode === val ? 'text-[#002144]' : 'text-gray-500'}`}>
                {label}
              </span>
            </label>
          ))}
          <span className="text-[10px] text-gray-500">— Default off — opt in to enable</span>
        </div>

        {/* Auto-calibrate */}
        <label className={`flex items-center gap-2 ${enabled ? 'cursor-pointer' : 'opacity-50'}`}>
          <input
            type="checkbox"
            checked={autoCalibrate}
            disabled={!enabled}
            onChange={e => update('autoCalibrate', e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-[11px] font-medium text-gray-700">
            Auto-calibrate from first {calTarget} rows
          </span>
          <span className="text-[10px] text-gray-500">(recommended)</span>
        </label>

        {/* Per-agent concurrency snapshot */}
        <div>
          <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">Live concurrency per agent</p>
          {perAgentConcurrency && Object.keys(perAgentConcurrency).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(perAgentConcurrency).map(([agentId, n]) => (
                <span
                  key={agentId}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-mono"
                  title={`${agentId}: concurrency ${n}`}
                >
                  {agentId}: <strong className="text-[#002144]">{n}</strong>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-400 italic">No active agents</p>
          )}
        </div>

        {/* Thresholds */}
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Upper P95 (ms)"
            value={config.upperP95Ms ?? 12000}
            min={1000}
            max={120000}
            step={500}
            onChange={v => handleThresholdChange('upperP95Ms', v)}
            disabled={!enabled}
            tooltip="Throttle DOWN trigger: when rolling P95 exceeds this for the cooldown window."
          />
          <NumberField
            label="Lower P95 (ms)"
            value={config.lowerP95Ms ?? 7000}
            min={500}
            max={60000}
            step={500}
            onChange={v => handleThresholdChange('lowerP95Ms', v)}
            disabled={!enabled}
            tooltip="Recover UP trigger: when rolling P95 stays below this for the cooldown window."
          />
          <NumberField
            label="Cooldown (s)"
            value={Math.round((config.cooldownMs ?? 30000) / 1000)}
            min={5}
            max={300}
            step={5}
            onChange={v => update('cooldownMs', v * 1000)}
            disabled={!enabled}
            tooltip="Minimum time between adjustments per agent."
          />
          <NumberField
            label="Floor"
            value={manualFloor}
            min={1}
            max={8}
            step={1}
            onChange={v => update('minConcurrency', v)}
            disabled={!enabled}
            tooltip="Manual floor — never throttle below this."
          />
        </div>

        {/* Status row */}
        {enabled && (
          <div className="text-[10px] space-y-0.5 text-gray-600">
            {calibStatus && <div>Status: {calibStatus}</div>}
            <div>
              Effective floor: max(manual={manualFloor}, adaptive={adaptiveFloor}) ={' '}
              <strong className="text-[#002144]">{effectiveFloor}</strong>
              {pendingRows > 0 && (
                <span className="text-gray-500"> — {pendingRows.toLocaleString()} rows pending</span>
              )}
            </div>
            <div className="text-gray-500">P95 input excludes NO_RATES (data-side) results.</div>
          </div>
        )}

        {/* Adjustment log */}
        <div>
          <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">
            Adjustment log {log && log.length > 0 ? `(${Math.min(10, log.length)} of ${log.length})` : ''}
          </p>
          {log && log.length > 0 ? (
            <ul className="text-[10px] space-y-0.5 max-h-32 overflow-auto bg-gray-50 rounded p-2">
              {log.slice(0, 10).map((e, i) => {
                const badge = e.mode === 'active' ? '[ACTIVE] ' : e.mode === 'suggest' ? '[SUGGEST]' : '';
                const badgeClass = e.mode === 'active' ? 'text-[#002144]' : 'text-amber-700';
                const verb = e.mode === 'active'
                  ? (e.direction === 'down' ? 'dropped' : 'raised')
                  : (e.direction === 'down' ? 'would drop' : 'would raise');
                return (
                  <li key={i} className="font-mono">
                    <span className="text-gray-500">{formatTime(e.ts)}</span>
                    {' '}
                    <span className={`font-bold ${badgeClass}`}>{badge}</span>
                    {' '}
                    <span className="text-[#002144]">{e.agentId}</span>:{' '}
                    <span className={e.direction === 'down' ? 'text-amber-600' : 'text-green-700'}>
                      {verb} conc {e.from} → {e.to}
                    </span>
                    {' '}
                    <span className="text-gray-500">({e.reason})</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[10px] text-gray-400 italic">No adjustments yet</p>
          )}
        </div>

        {/* Footer */}
        <div className="text-[10px] pt-1 border-t border-gray-100">
          {mode === 'active'
            ? <span className="text-[#002144] font-semibold">Adaptive throttle is ACTIVE — {active ? sinceLabel : 'waiting for warmup samples'}</span>
            : mode === 'suggest'
              ? <span className="text-amber-700 font-semibold">Suggest-only — {active ? sinceLabel : 'waiting for warmup samples'} (no concurrency mutations)</span>
              : <span className="text-gray-500">Adaptive throttle is OFF</span>
          }
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, step, onChange, disabled, tooltip }) {
  return (
    <label className="flex items-center gap-2" title={tooltip}>
      <span className="text-[10px] text-gray-600 font-medium w-24 shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={e => {
          const v = parseInt(e.target.value, 10);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="text-xs border border-gray-300 rounded px-1.5 py-0.5 w-20 disabled:bg-gray-100 disabled:text-gray-400"
      />
    </label>
  );
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatAgo(ms) {
  if (ms < 1000) return '<1s';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
