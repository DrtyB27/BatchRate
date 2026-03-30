import React, { useState, useMemo, useRef } from 'react';
import { deduplicateRows } from '../services/rateDeduplicator.js';
import { readProfileFile, validateProfile } from '../services/tuningProfile.js';

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8];
const DELAY_OPTIONS = [0, 50, 100, 150, 200, 300, 500];
const RETRY_OPTIONS = [0, 1, 2, 3];
const CHUNK_SIZE_OPTIONS = [200, 300, 400, 500, 700, 1000];
const MAX_AGENTS_OPTIONS = [2, 3, 4, 5, 6, 8];
const PER_AGENT_CONC_OPTIONS = [1, 2, 3, 4];
const TOTAL_CONC_OPTIONS = [4, 6, 8, 10, 12];
const STAGGER_OPTIONS = [250, 500, 1000, 1500, 2000];
const TARGET_RESPONSE_OPTIONS = [1000, 1500, 2000, 3000, 5000];

// Strategy presets
const STRATEGIES = {
  fast: {
    label: 'Fast',
    description: '3-digit dedup, 4 carriers, auto-tune',
    dedup: '3-digit',
    concurrency: 4,
    autoTune: true,
    autoTuneTarget: 2000,
    adaptiveBackoff: true,
  },
  balanced: {
    label: 'Balanced',
    description: '5-digit dedup, 4 carriers, auto-tune',
    dedup: '5-digit',
    concurrency: 4,
    autoTune: true,
    autoTuneTarget: 2000,
    adaptiveBackoff: true,
  },
  accurate: {
    label: 'Accurate',
    description: 'No dedup, all carriers, auto-tune',
    dedup: 'off',
    concurrency: 4,
    autoTune: true,
    autoTuneTarget: 2000,
    adaptiveBackoff: true,
  },
};

function StepperControl({ label, value, options, onChange, tooltip, suffix }) {
  const idx = options.indexOf(value);
  const display = suffix ? `${value}${suffix}` : value;
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[11px] text-gray-600 font-medium w-24 shrink-0">{label}</span>
      <button
        type="button"
        onClick={() => idx > 0 && onChange(options[idx - 1])}
        disabled={idx <= 0}
        className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30 text-xs font-bold text-gray-600"
      >-</button>
      <span className="text-xs font-semibold text-[#002144] w-14 text-center">{display}</span>
      <button
        type="button"
        onClick={() => idx < options.length - 1 && onChange(options[idx + 1])}
        disabled={idx >= options.length - 1}
        className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30 text-xs font-bold text-gray-600"
      >+</button>
    </div>
  );
}

export default function ExecutionControls({ settings, onChange, onRun, onPause, onResume, onCancel, running, paused, csvLoaded, rowCount, csvRows }) {
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [profileInfo, setProfileInfo] = useState(null); // { profile, filename }
  const [profileError, setProfileError] = useState(null);
  const profileInputRef = useRef(null);

  const update = (key, val) => onChange({ ...settings, [key]: val });

  const isMulti = true; // always multi-agent

  // Compute dedup stats for display
  const dedupStats = useMemo(() => {
    if (!csvRows || csvRows.length === 0 || settings.dedup === 'off') {
      return { uniqueScenarios: rowCount, reduction: 0, reductionPct: 0 };
    }
    try {
      const { stats } = deduplicateRows(csvRows, settings.dedup || '5-digit');
      return stats;
    } catch {
      return { uniqueScenarios: rowCount, reduction: 0, reductionPct: 0 };
    }
  }, [csvRows, rowCount, settings.dedup]);

  const estimatedCalls = dedupStats.uniqueScenarios || rowCount;
  // Rough time estimate: assume 500ms/call at optimal concurrency
  const effectiveConc = settings.autoTune ? Math.min(4, settings.concurrency || 4) : (settings.concurrency || 4);
  const estSeconds = estimatedCalls > 0 ? Math.round(estimatedCalls * 0.5 / effectiveConc) : 0;
  const estMinutes = estSeconds >= 60 ? `${Math.floor(estSeconds / 60)}m ${estSeconds % 60}s` : `${estSeconds}s`;

  // Apply strategy preset
  const applyStrategy = (key) => {
    const s = STRATEGIES[key];
    onChange({
      ...settings,
      strategy: key,
      dedup: s.dedup,
      concurrency: s.concurrency,
      autoTune: s.autoTune,
      autoTuneTarget: s.autoTuneTarget,
      adaptiveBackoff: s.adaptiveBackoff,
    });
  };

  const currentStrategy = settings.strategy || 'balanced';

  const summaryParts = [];
  if (settings.dedup && settings.dedup !== 'off') summaryParts.push(`${settings.dedup} dedup`);
  if (settings.autoTune) summaryParts.push('auto-tune');
  summaryParts.push('multi-agent');
  if (estimatedCalls < rowCount) summaryParts.push(`${estimatedCalls} calls`);
  const summaryText = summaryParts.join(' \u2022 ');

  const showXmlWarning = settings.concurrency > 2 && rowCount > 500;

  return (
    <div className="border border-gray-200 rounded-lg bg-white mb-4">
      {/* Header / collapsed summary */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <svg className={`w-3 h-3 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-semibold text-[#002144]">Execution Strategy</span>
        </div>
        <span className="text-[10px] text-gray-400 font-mono">{summaryText}</span>
      </button>

      {/* Expanded controls */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 space-y-3">

          {/* Strategy Slider */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#002144]">Speed vs Accuracy</span>
              {csvLoaded && rowCount > 0 && (
                <span className="text-[10px] text-gray-500">
                  {estimatedCalls.toLocaleString()} API calls &middot; Est: {estMinutes}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {Object.entries(STRATEGIES).map(([key, s]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyStrategy(key)}
                  className={`flex-1 rounded-lg px-3 py-2 text-left transition-colors border ${
                    currentStrategy === key
                      ? 'bg-[#39b6e6]/10 border-[#39b6e6] ring-1 ring-[#39b6e6]'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`text-xs font-semibold ${currentStrategy === key ? 'text-[#002144]' : 'text-gray-700'}`}>
                    {s.label}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{s.description}</div>
                </button>
              ))}
            </div>

            {/* Dedup stats callout */}
            {settings.dedup && settings.dedup !== 'off' && csvLoaded && dedupStats.reduction > 0 && (
              <div className="bg-green-50 border border-green-200 rounded px-2 py-1.5 text-[10px] text-green-700">
                Deduplication: {rowCount.toLocaleString()} shipments &rarr; {dedupStats.uniqueScenarios.toLocaleString()} unique rate scenarios ({dedupStats.reductionPct}% fewer API calls)
                {settings.dedup === '3-digit' && (
                  <span className="text-amber-600 ml-1">Rates estimated at 3-digit ZIP level. Actual rates may vary &plusmn;3%.</span>
                )}
              </div>
            )}
          </div>

          {/* Execution mode label */}
          <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
            <span className="text-[11px] text-gray-500">Multi-agent execution (auto-resume enabled)</span>
          </div>

          {/* Advanced Settings toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[11px] text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
          >
            <svg className={`w-2.5 h-2.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            Advanced Settings
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-2 border-l-2 border-gray-100">
              {/* Dedup precision */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-gray-600 font-medium w-24 shrink-0">Dedup:</span>
                {['off', '5-digit', '3-digit'].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => update('dedup', d)}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                      (settings.dedup || 'off') === d
                        ? 'bg-[#002144] text-white'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >{d === 'off' ? 'Off' : d === '5-digit' ? '5-Digit ZIP' : '3-Digit ZIP'}</button>
                ))}
              </div>

              {/* Concurrency mode */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-gray-600 font-medium w-24 shrink-0">Concurrency:</span>
                <button
                  type="button"
                  onClick={() => update('autoTune', false)}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                    !settings.autoTune ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >Fixed</button>
                <button
                  type="button"
                  onClick={() => update('autoTune', true)}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                    settings.autoTune ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >Auto-tune (rec)</button>
              </div>

              {settings.autoTune && (
                <StepperControl
                  label="Target resp"
                  value={settings.autoTuneTarget || 2000}
                  options={TARGET_RESPONSE_OPTIONS}
                  onChange={v => update('autoTuneTarget', v)}
                  tooltip="Target response time in ms. Auto-tuner adjusts concurrency to stay below this."
                  suffix="ms"
                />
              )}

              {/* Multi-agent settings */}
              {isMulti && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <StepperControl
                      label="Chunk Size"
                      value={settings.chunkSize || 400}
                      options={CHUNK_SIZE_OPTIONS}
                      onChange={v => update('chunkSize', v)}
                      tooltip="Rows per agent."
                    />
                    <StepperControl
                      label="Max Agents"
                      value={settings.maxAgents || 5}
                      options={MAX_AGENTS_OPTIONS}
                      onChange={v => update('maxAgents', v)}
                      tooltip="Maximum number of simultaneous agents."
                    />
                    <StepperControl
                      label="Per-Agent Conc"
                      value={settings.concurrencyPerAgent || 2}
                      options={PER_AGENT_CONC_OPTIONS}
                      onChange={v => update('concurrencyPerAgent', v)}
                      tooltip="Concurrent requests per agent."
                    />
                    <StepperControl
                      label="Total Max Conc"
                      value={settings.totalMaxConcurrency || 8}
                      options={TOTAL_CONC_OPTIONS}
                      onChange={v => update('totalMaxConcurrency', v)}
                      tooltip="Hard cap on total in-flight API requests."
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <StepperControl
                      label="Delay"
                      value={settings.delayMs}
                      options={DELAY_OPTIONS}
                      onChange={v => update('delayMs', v)}
                      tooltip="Per-request delay within each agent."
                      suffix="ms"
                    />
                    <StepperControl
                      label="Stagger"
                      value={settings.staggerStartMs || 500}
                      options={STAGGER_OPTIONS}
                      onChange={v => update('staggerStartMs', v)}
                      tooltip="Delay between agent launches."
                      suffix="ms"
                    />
                    <StepperControl
                      label="Retries"
                      value={settings.retryAttempts}
                      options={RETRY_OPTIONS}
                      onChange={v => update('retryAttempts', v)}
                      tooltip="Per-agent retry attempts."
                    />
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-600 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.adaptiveBackoff}
                        onChange={e => update('adaptiveBackoff', e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Auto-throttle (per agent)
                    </label>
                  </div>
                  {rowCount > 0 && (
                    <p className="text-[10px] text-gray-500 bg-gray-50 rounded px-2 py-1">
                      {estimatedCalls.toLocaleString()} calls &divide; {settings.chunkSize || 400} = {Math.ceil(estimatedCalls / (settings.chunkSize || 400))} agents.
                      Up to {Math.min(settings.maxAgents || 5, Math.floor((settings.totalMaxConcurrency || 8) / (settings.concurrencyPerAgent || 2)))} active simultaneously.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tuning Profile */}
          {showAdvanced && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-indigo-800">Tuning Profile</span>
                {profileInfo && (
                  <button
                    onClick={() => {
                      onChange({ ...settings, tuningProfile: null });
                      setProfileInfo(null);
                    }}
                    className="text-[10px] text-indigo-500 hover:text-indigo-700"
                  >
                    Clear
                  </button>
                )}
              </div>
              {profileInfo ? (
                <div className="text-[10px] text-indigo-700 space-y-0.5">
                  <div className="font-medium">Loaded: {profileInfo.filename}</div>
                  <div>Optimal concurrency: {profileInfo.profile.learned.optimalConcurrency} | Baseline: {profileInfo.profile.learned.baselineResponseMs}ms</div>
                  <div>Warning: {profileInfo.profile.learned.warningThresholdMs}ms | Critical: {profileInfo.profile.learned.criticalThresholdMs}ms</div>
                  {profileInfo.profile.refinementCount > 0 && (
                    <div>Refined {profileInfo.profile.refinementCount}x ({profileInfo.profile.sampleSize} total samples)</div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => profileInputRef.current?.click()}
                    className="text-[10px] bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium px-2.5 py-1 rounded transition-colors"
                  >
                    Load Profile
                  </button>
                  <input
                    ref={profileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = '';
                      try {
                        const profile = await readProfileFile(file);
                        const validation = validateProfile(profile);
                        if (!validation.valid) throw new Error(validation.error);
                        onChange({
                          ...settings,
                          tuningProfile: profile,
                          autoTune: true,
                          autoTuneTarget: profile.learned.baselineResponseMs || settings.autoTuneTarget,
                        });
                        setProfileInfo({ profile, filename: file.name });
                        setProfileError(null);
                      } catch (err) {
                        setProfileError(err.message);
                        setTimeout(() => setProfileError(null), 4000);
                      }
                    }}
                  />
                  <span className="text-[10px] text-indigo-500">Load a saved profile to auto-configure execution settings</span>
                </div>
              )}
              {profileError && (
                <div className="text-[10px] text-red-600 bg-red-50 rounded px-2 py-1">{profileError}</div>
              )}
            </div>
          )}

          {showXmlWarning && (
            <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">
              Saving XML at high concurrency with {rowCount} rows increases memory usage. Consider disabling XML save in the sidebar.
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-2">
        {!running && !paused && (
          <button
            onClick={onRun}
            disabled={!csvLoaded}
            className="bg-[#39b6e6] hover:bg-[#2d9bc4] disabled:bg-gray-300 text-white font-semibold px-5 py-2 rounded-md transition-colors text-sm flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.8A1 1 0 005 3.7v12.6a1 1 0 001.3.9l10-6.3a1 1 0 000-1.8l-10-6.3z" /></svg>
            Run Batch
            {csvLoaded && estimatedCalls < rowCount && (
              <span className="text-[10px] font-normal opacity-80">({estimatedCalls.toLocaleString()} calls)</span>
            )}
          </button>
        )}
        {running && (
          <button
            onClick={onPause}
            className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-md transition-colors text-sm flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6 4h2v12H6V4zm6 0h2v12h-2V4z" /></svg>
            Pause
          </button>
        )}
        {paused && (
          <button
            onClick={onResume}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-md transition-colors text-sm flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.8A1 1 0 005 3.7v12.6a1 1 0 001.3.9l10-6.3a1 1 0 000-1.8l-10-6.3z" /></svg>
            Resume
          </button>
        )}
        {(running || paused) && (
          <button
            onClick={onCancel}
            className="bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-md transition-colors text-sm flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 4h12v12H4V4z" /></svg>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
