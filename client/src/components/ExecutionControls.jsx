import React, { useState } from 'react';

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8];
const DELAY_OPTIONS = [0, 50, 100, 150, 200, 300, 500];
const RETRY_OPTIONS = [0, 1, 2, 3];
const CHUNK_SIZE_OPTIONS = [200, 300, 400, 500, 700, 1000];
const MAX_AGENTS_OPTIONS = [2, 3, 4, 5, 6, 8];
const PER_AGENT_CONC_OPTIONS = [1, 2, 3, 4];
const TOTAL_CONC_OPTIONS = [4, 6, 8, 10, 12];
const STAGGER_OPTIONS = [250, 500, 1000, 1500, 2000];

function StepperControl({ label, value, options, onChange, tooltip }) {
  const idx = options.indexOf(value);
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[11px] text-gray-600 font-medium w-24 shrink-0">{label}</span>
      <button
        type="button"
        onClick={() => idx > 0 && onChange(options[idx - 1])}
        disabled={idx <= 0}
        className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30 text-xs font-bold text-gray-600"
      >-</button>
      <span className="text-xs font-semibold text-[#002144] w-10 text-center">{typeof value === 'number' && label.includes('Delay') ? `${value}ms` : value}</span>
      <button
        type="button"
        onClick={() => idx < options.length - 1 && onChange(options[idx + 1])}
        disabled={idx >= options.length - 1}
        className="w-5 h-5 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30 text-xs font-bold text-gray-600"
      >+</button>
    </div>
  );
}

export default function ExecutionControls({ settings, onChange, onRun, onPause, onResume, onCancel, running, paused, csvLoaded, rowCount }) {
  const [expanded, setExpanded] = useState(false);

  const update = (key, val) => onChange({ ...settings, [key]: val });

  const isMulti = settings.executionMode === 'multi';
  const showMultiRecommendation = rowCount > 400 && !isMulti && csvLoaded;

  const summaryText = isMulti
    ? `Multi-Agent \u2022 ${settings.chunkSize || 400} rows/agent \u2022 ${settings.maxAgents || 5} agents \u2022 ${settings.totalMaxConcurrency || 8} total conc`
    : `${settings.concurrency} concurrent \u2022 ${settings.delayMs}ms delay \u2022 ${settings.retryAttempts} retry${settings.adaptiveBackoff ? ' \u2022 auto-throttle' : ''}`;

  // XML memory warning
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
          <span className="text-xs font-semibold text-[#002144]">Execution Settings</span>
        </div>
        <span className="text-[10px] text-gray-400 font-mono">{summaryText}</span>
      </button>

      {/* Expanded controls */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
            <span className="text-[11px] text-gray-600 font-medium">Execution Mode:</span>
            <button
              type="button"
              onClick={() => update('executionMode', 'single')}
              className={`text-[11px] px-2.5 py-1 rounded font-medium transition-colors ${!isMulti ? 'bg-[#39b6e6] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
            >Single Agent</button>
            <button
              type="button"
              onClick={() => update('executionMode', 'multi')}
              className={`text-[11px] px-2.5 py-1 rounded font-medium transition-colors ${isMulti ? 'bg-[#39b6e6] text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
            >Multi-Agent</button>
          </div>

          {/* Single agent settings */}
          {!isMulti && (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <StepperControl
                label="Concurrency"
                value={settings.concurrency}
                options={CONCURRENCY_OPTIONS}
                onChange={v => update('concurrency', v)}
                tooltip="Number of simultaneous API calls. Higher = faster but uses more server capacity."
              />
              <StepperControl
                label="Delay"
                value={settings.delayMs}
                options={DELAY_OPTIONS}
                onChange={v => update('delayMs', v)}
                tooltip="Milliseconds between dispatches. Set to 0 for maximum speed."
              />
              <StepperControl
                label="Retries"
                value={settings.retryAttempts}
                options={RETRY_OPTIONS}
                onChange={v => update('retryAttempts', v)}
                tooltip="Number of retry attempts for failed requests."
              />
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 font-medium cursor-pointer" title="Automatically reduce speed on errors">
                <input
                  type="checkbox"
                  checked={settings.adaptiveBackoff}
                  onChange={e => update('adaptiveBackoff', e.target.checked)}
                  className="rounded border-gray-300"
                />
                Auto-throttle
              </label>
            </div>
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
                  tooltip="Rows per agent. Each agent processes this many rows independently."
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
                  tooltip="Hard cap on total in-flight API requests across all agents."
                />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <StepperControl
                  label="Delay"
                  value={settings.delayMs}
                  options={DELAY_OPTIONS}
                  onChange={v => update('delayMs', v)}
                  tooltip="Per-request delay within each agent."
                />
                <StepperControl
                  label="Stagger"
                  value={settings.staggerStartMs || 500}
                  options={STAGGER_OPTIONS}
                  onChange={v => update('staggerStartMs', v)}
                  tooltip="Delay between agent launches to avoid burst connections."
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
                  {rowCount} rows \u00F7 {settings.chunkSize || 400} = {Math.ceil(rowCount / (settings.chunkSize || 400))} agents.
                  Up to {Math.min(settings.maxAgents || 5, Math.floor((settings.totalMaxConcurrency || 8) / (settings.concurrencyPerAgent || 2)))} active simultaneously.
                </p>
              )}
            </div>
          )}

          {/* Multi-agent recommendation */}
          {showMultiRecommendation && (
            <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[11px] text-blue-700 flex items-center justify-between">
              <span>
                Large batch ({rowCount} rows). Multi-Agent mode splits into {Math.ceil(rowCount / 400)} independent agents for resilience.
              </span>
              <button
                type="button"
                onClick={() => onChange({
                  ...settings,
                  executionMode: 'multi',
                  chunkSize: 400,
                  maxAgents: 5,
                  concurrencyPerAgent: 2,
                  totalMaxConcurrency: 8,
                  staggerStartMs: 500,
                })}
                className="bg-blue-500 text-white px-2 py-0.5 rounded text-[10px] font-medium hover:bg-blue-600 ml-2 whitespace-nowrap"
              >
                Use Multi-Agent
              </button>
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
