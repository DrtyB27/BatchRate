import React from 'react';

const PHASE_COLORS = {
  PROBE:     'bg-blue-100 text-blue-800 border-blue-300',
  CALIBRATE: 'bg-amber-100 text-amber-800 border-amber-300',
  SCALE:     'bg-emerald-100 text-emerald-800 border-emerald-300',
  SUSTAIN:   'bg-emerald-100 text-emerald-800 border-emerald-300',
};

const EVENT_LABEL = {
  SPIKE_THROTTLE:             { color: 'text-amber-700',   label: 'Spike throttle' },
  SPIKE_CRITICAL_THROTTLE:    { color: 'text-rose-700',    label: 'Spike critical' },
  SUSTAINED_LATENCY_THROTTLE: { color: 'text-rose-700',    label: 'Sustained latency' },
  RECOVERY_SCALE_UP:          { color: 'text-emerald-700', label: 'Recovery +1' },
  COOLDOWN_SCALE_UP:          { color: 'text-emerald-700', label: 'Cooldown +1' },
};

export default function GovernorPanel({ governor, mode = 'compact' }) {
  if (!governor) return null;
  const {
    backoffActive, effectiveConcurrency, configuredConcurrency,
    effectiveDelayMs, rollingP95Ms, phase,
    sustainedTriggered, recentEvents = [],
  } = governor;

  if (mode === 'compact') {
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {phase && (
          <span className={`px-2 py-0.5 rounded border font-semibold ${PHASE_COLORS[phase] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>
            {phase}
          </span>
        )}
        <span className={`px-2 py-0.5 rounded border font-semibold ${backoffActive ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-700 border-slate-300'}`}>
          conc {effectiveConcurrency}/{configuredConcurrency}
        </span>
        <span className="px-2 py-0.5 rounded border border-slate-300 text-slate-700">
          delay {effectiveDelayMs}ms
        </span>
        <span className="px-2 py-0.5 rounded border border-slate-300 text-slate-700">
          P95 {rollingP95Ms}ms
        </span>
        {sustainedTriggered > 0 && (
          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">
            sustained-throttles: {sustainedTriggered}
          </span>
        )}
      </div>
    );
  }

  // expanded mode — full event timeline
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <h4 className="text-sm font-semibold text-[#002144] mb-2">Adaptive Governor</h4>
      <GovernorPanel governor={governor} mode="compact" />
      {recentEvents.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-600 mb-1">Recent events</div>
          <ul className="space-y-1 text-xs">
            {recentEvents.slice().reverse().map((e, i) => {
              const meta = EVENT_LABEL[e.type] || { color: 'text-slate-700', label: e.type };
              return (
                <li key={i} className="flex justify-between gap-2">
                  <span className={`${meta.color} font-medium shrink-0`}>{meta.label}</span>
                  <span className="text-slate-500 text-right">
                    conc {e.before?.conc ?? '?'} &rarr; {e.after?.conc ?? '?'}, delay {e.before?.delay ?? '?'} &rarr; {e.after?.delay ?? '?'}ms
                    {e.before?.p95 ? `  (P95 ${e.before.p95}ms)` : ''}
                    {e.before?.spikeRate !== undefined ? `  (spike ${e.before.spikeRate}%)` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
