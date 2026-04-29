import React from 'react';

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
}) {
  const update = (key, value) => onConfigChange({ ...config, [key]: value });
  const enabled = !!config.enabled;

  const lastAdjustTs = log && log.length > 0 ? log[0].ts : null;
  const sinceMs = lastAdjustTs ? Date.now() - lastAdjustTs : null;
  const sinceLabel = sinceMs == null
    ? 'no adjustments yet'
    : `last adjusted ${formatAgo(sinceMs)} ago`;

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="bg-[#002144] text-white px-4 py-2 flex items-center gap-3 rounded-t-lg">
        <span className="text-xs font-bold uppercase tracking-wider">Adaptive Concurrency Throttle</span>
        <span className="ml-auto text-[10px] text-[#39B6E6]">P95 hysteresis</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Enable toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => update('enabled', e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className={`text-xs font-semibold ${enabled ? 'text-[#002144]' : 'text-gray-500'}`}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <span className="text-[10px] text-gray-500">— off by default; existing batches behave identically</span>
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
            onChange={v => update('upperP95Ms', v)}
            disabled={!enabled}
            tooltip="Throttle DOWN trigger: when rolling P95 exceeds this for the cooldown window."
          />
          <NumberField
            label="Lower P95 (ms)"
            value={config.lowerP95Ms ?? 7000}
            min={500}
            max={60000}
            step={500}
            onChange={v => update('lowerP95Ms', v)}
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
            value={config.minConcurrency ?? 2}
            min={1}
            max={8}
            step={1}
            onChange={v => update('minConcurrency', v)}
            disabled={!enabled}
            tooltip="Lower bound — never throttle below this."
          />
        </div>

        {/* Adjustment log */}
        <div>
          <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">
            Adjustment log {log && log.length > 0 ? `(${Math.min(10, log.length)} of ${log.length})` : ''}
          </p>
          {log && log.length > 0 ? (
            <ul className="text-[10px] space-y-0.5 max-h-32 overflow-auto bg-gray-50 rounded p-2">
              {log.slice(0, 10).map((e, i) => (
                <li key={i} className="font-mono">
                  <span className="text-gray-500">{formatTime(e.ts)}</span>
                  {' '}
                  <span className="text-[#002144]">{e.agentId}</span>
                  {' '}
                  <span className={e.direction === 'down' ? 'text-amber-600' : 'text-green-700'}>
                    {e.direction === 'down' ? '↓' : '↑'} {e.from}→{e.to}
                  </span>
                  {' '}
                  <span className="text-gray-500">— {e.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-gray-400 italic">No adjustments yet</p>
          )}
        </div>

        {/* Footer */}
        <div className="text-[10px] pt-1 border-t border-gray-100">
          {enabled
            ? <span className="text-[#002144] font-semibold">Adaptive throttle is ACTIVE — {active ? sinceLabel : 'waiting for warmup samples'}</span>
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
