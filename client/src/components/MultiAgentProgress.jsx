import React, { useState } from 'react';

const STATUS_ICONS = {
  queued: { icon: '\u23F3', label: 'Queued', color: 'text-gray-400' },
  running: { icon: '\uD83D\uDD04', label: 'Running', color: 'text-blue-600' },
  paused: { icon: '\u23F8', label: 'Paused', color: 'text-amber-600' },
  stalled: { icon: '\u26A1', label: 'Stalled', color: 'text-red-600' },
  complete: { icon: '\u2705', label: 'Done', color: 'text-green-600' },
  failed: { icon: '\u274C', label: 'Failed', color: 'text-red-600' },
  cancelled: { icon: '\u23F9', label: 'Cancelled', color: 'text-gray-500' },
};

function AgentRow({ agent, onPause, onResume, onCancel, onRetry }) {
  const status = STATUS_ICONS[agent.state] || STATUS_ICONS.queued;
  const pct = agent.total > 0 ? (agent.completed / agent.total) * 100 : 0;
  const errorCount = agent.failed || 0;

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50 text-xs">
      <td className="px-3 py-2 font-medium text-[#002144]">{agent.agentId.replace('agent-', 'Agent ')}</td>
      <td className="px-3 py-2">
        <span className={`${status.color} font-medium`}>
          <span className="mr-1">{status.icon}</span>{status.label}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-24">
            <div
              className={`h-full transition-all ${agent.state === 'stalled' ? 'bg-red-400' : agent.state === 'complete' ? 'bg-green-500' : 'bg-[#39b6e6]'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-gray-500 w-20">{agent.completed}/{agent.total}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono">{agent.throughput}/s</td>
      <td className="px-3 py-2 text-right">
        {errorCount > 0 ? (
          <span className="text-red-600 font-medium">{errorCount}</span>
        ) : (
          <span className="text-gray-400">0</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {agent.state === 'running' && (
            <>
              <button onClick={() => onPause(agent.agentId)} className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-200 px-1.5 py-0.5 rounded">Pause</button>
              <button onClick={() => onCancel(agent.agentId)} className="text-[10px] bg-red-100 text-red-700 hover:bg-red-200 px-1.5 py-0.5 rounded">Cancel</button>
            </>
          )}
          {agent.state === 'paused' && (
            <>
              <button onClick={() => onResume(agent.agentId)} className="text-[10px] bg-green-100 text-green-700 hover:bg-green-200 px-1.5 py-0.5 rounded">Resume</button>
              <button onClick={() => onCancel(agent.agentId)} className="text-[10px] bg-red-100 text-red-700 hover:bg-red-200 px-1.5 py-0.5 rounded">Cancel</button>
            </>
          )}
          {agent.state === 'stalled' && (
            <>
              <button onClick={() => onRetry(agent.agentId)} className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-200 px-1.5 py-0.5 rounded">Retry Failed</button>
              <button onClick={() => onCancel(agent.agentId)} className="text-[10px] bg-red-100 text-red-700 hover:bg-red-200 px-1.5 py-0.5 rounded">Skip</button>
            </>
          )}
          {agent.state === 'failed' && (
            <button onClick={() => onRetry(agent.agentId)} className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-200 px-1.5 py-0.5 rounded">Retry All</button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function MultiAgentProgress({ progress, onPauseAll, onResumeAll, onCancelAll, onPauseAgent, onResumeAgent, onCancelAgent, onRetryAgent, onRetryAllFailed, onSkipPause }) {
  const [expanded, setExpanded] = useState(true);

  if (!progress || !progress.isMultiAgent) return null;

  const { totalRows, totalCompleted, totalSucceeded, totalFailed, agents,
    overallThroughput, estimatedRemaining, elapsedMs, activeAgents,
    queuedAgents, completedAgents, failedAgents, state, interChunkPause } = progress;

  const pct = totalRows > 0 ? (totalCompleted / totalRows) * 100 : 0;
  const successPct = totalRows > 0 ? (totalSucceeded / totalRows) * 100 : 0;
  const failPct = totalRows > 0 ? (totalFailed / totalRows) * 100 : 0;

  const elapsedSec = Math.round(elapsedMs / 1000);
  const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

  const isComplete = state === 'COMPLETE';
  const hasFailed = totalFailed > 0;
  const allDone = isComplete || state === 'CANCELLED';

  return (
    <div className="border border-gray-200 rounded-lg bg-white space-y-0 overflow-hidden">
      {/* Overall progress */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
            <div className="absolute inset-0 flex">
              <div className="bg-green-500 h-full transition-all" style={{ width: `${successPct}%` }} />
              <div className="bg-red-500 h-full transition-all" style={{ width: `${failPct}%` }} />
            </div>
          </div>
          <span className="text-sm font-bold text-[#002144] w-44 text-right">
            {totalCompleted}/{totalRows} <span className="text-gray-400 font-normal">({pct.toFixed(1)}%)</span>
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-gray-500">Speed:</span> <strong>{overallThroughput} rows/sec</strong></div>
          <div><span className="text-gray-500">Elapsed:</span> <strong>{elapsedStr}</strong></div>
          <div><span className="text-gray-500">Remaining:</span> <strong>{estimatedRemaining}</strong></div>
          <div className="text-green-700"><span className="text-gray-500">Success:</span> <strong>{totalSucceeded}</strong></div>
          <div className="text-red-600"><span className="text-gray-500">Failed:</span> <strong>{totalFailed}</strong></div>
        </div>

        {/* Inter-chunk pause banner */}
        {interChunkPause && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-3">
            <svg className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-1-4a1 1 0 10-2 0v4a1 1 0 001 1h3a1 1 0 100-2h-2V6z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-amber-700 font-medium">
              Chunk {interChunkPause.chunkIndex} of {interChunkPause.totalChunks} complete &mdash; pausing {Math.round(interChunkPause.pauseMs / 1000)}s before next chunk ({Math.round(interChunkPause.remainingMs / 1000)}s remaining)
            </span>
            {onSkipPause && (
              <button
                onClick={onSkipPause}
                className="text-[10px] bg-amber-200 hover:bg-amber-300 text-amber-800 px-2 py-0.5 rounded font-medium transition-colors ml-auto shrink-0"
              >
                Run next chunk now
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{agents.length} agents</span>
          <span>{activeAgents} active</span>
          {queuedAgents > 0 && <span>{queuedAgents} queued</span>}
          <span>{completedAgents} done</span>
          {failedAgents > 0 && <span className="text-red-600">{failedAgents} stalled</span>}
          <div className="flex-1" />
          {state === 'RUNNING' && (
            <>
              <button onClick={onPauseAll} className="bg-amber-100 text-amber-700 hover:bg-amber-200 px-2 py-0.5 rounded text-[10px] font-medium">Pause All</button>
              <button onClick={onCancelAll} className="bg-red-100 text-red-700 hover:bg-red-200 px-2 py-0.5 rounded text-[10px] font-medium">Cancel All</button>
            </>
          )}
          {state === 'PAUSED' && (
            <>
              <button onClick={onResumeAll} className="bg-green-100 text-green-700 hover:bg-green-200 px-2 py-0.5 rounded text-[10px] font-medium">Resume All</button>
              <button onClick={onCancelAll} className="bg-red-100 text-red-700 hover:bg-red-200 px-2 py-0.5 rounded text-[10px] font-medium">Cancel All</button>
            </>
          )}
          {allDone && hasFailed && (
            <button onClick={onRetryAllFailed} className="bg-blue-500 text-white hover:bg-blue-600 px-3 py-1 rounded text-xs font-medium">Retry {totalFailed} Failed Rows</button>
          )}
        </div>
      </div>

      {/* Agent table toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 hover:bg-gray-100"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="font-medium">Agent Details</span>
        <span className="text-gray-400">({agents.length} agents)</span>
      </button>

      {/* Agent table */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-t border-gray-200">
              <tr className="text-[10px] uppercase text-gray-500 tracking-wider">
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Progress</th>
                <th className="px-3 py-2 text-right">Speed</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => (
                <AgentRow
                  key={agent.agentId}
                  agent={agent}
                  onPause={onPauseAgent}
                  onResume={onResumeAgent}
                  onCancel={onCancelAgent}
                  onRetry={onRetryAgent}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
