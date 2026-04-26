import React, { useEffect, useRef, useState, useCallback } from 'react';

const MORPH_MS = 400;
const HOLD_MS = 800;

/**
 * Segmented phase selector + auto-play scrubber that drives Sankey morph.
 * Animation runs through requestAnimationFrame; parent receives a single
 * onChange callback per frame with `{ currentPhaseIndex, animationProgress }`.
 *
 * Loop / Single Play state is local — by design the parent does not own it,
 * so toggling does not invalidate Sankey memoization in the host screen.
 * Default is Single Play (safer for live demos).
 */
export default function PhaseScrubber({ phaseSequence, currentPhaseIndex, animationProgress, onChange }) {
  const phases = [phaseSequence.baseline, ...phaseSequence.phases];
  const lastIdx = phases.length - 1;

  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState('single'); // 'single' | 'loop'
  const rafRef = useRef(null);
  const stateRef = useRef({ playing: false, mode: 'single', lastIdx });

  // Keep refs in sync — RAF closure reads the latest values without
  // re-creating the loop on every render.
  stateRef.current = { playing: isPlaying, mode, lastIdx };

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Tween from `from` to `to` over MORPH_MS, calling onChange on every frame.
  // Resolves with `to` settled when complete, or aborts if `playing` flips off.
  const tween = useCallback((fromIdx, toIdx) => {
    return new Promise(resolve => {
      const start = performance.now();
      const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / MORPH_MS);
        if (fromIdx === toIdx) {
          onChange({ currentPhaseIndex: toIdx, animationProgress: 0 });
          resolve();
          return;
        }
        onChange({ currentPhaseIndex: fromIdx, animationProgress: t });
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          // Settle on the destination phase with progress = 0
          onChange({ currentPhaseIndex: toIdx, animationProgress: 0 });
          rafRef.current = null;
          resolve();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    });
  }, [onChange]);

  const hold = useCallback((ms) => {
    return new Promise(resolve => {
      const start = performance.now();
      const step = (now) => {
        if (!stateRef.current.playing) { resolve(); return; }
        if (now - start >= ms) { resolve(); return; }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    });
  }, []);

  // Master play loop — walks forward, holds, repeats per mode.
  const runPlayback = useCallback(async (startFrom) => {
    let cursor = startFrom;
    while (stateRef.current.playing) {
      const target = cursor + 1;
      if (target > stateRef.current.lastIdx) {
        if (stateRef.current.mode === 'loop') {
          // Hop back to baseline and continue
          await tween(cursor, 0);
          cursor = 0;
          await hold(HOLD_MS);
          continue;
        } else {
          // Single play: stop at last phase
          setIsPlaying(false);
          return;
        }
      }
      await tween(cursor, target);
      cursor = target;
      await hold(HOLD_MS);
    }
  }, [tween, hold]);

  // Cleanup on unmount or when playing toggles off externally.
  useEffect(() => {
    return () => cancelRaf();
  }, [cancelRaf]);

  // When mode changes mid-play, cancel and let the user restart.
  useEffect(() => {
    if (!isPlaying) cancelRaf();
  }, [isPlaying, cancelRaf]);

  const handleJumpTo = useCallback((targetIdx) => {
    // Any click pauses playback and morphs to the target.
    if (isPlaying) {
      setIsPlaying(false);
      cancelRaf();
    }
    cancelRaf();
    tween(currentPhaseIndex, targetIdx);
  }, [isPlaying, currentPhaseIndex, tween, cancelRaf]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      cancelRaf();
      return;
    }
    // If at last phase in single mode, restart from baseline.
    const startIdx = (currentPhaseIndex >= lastIdx && mode === 'single') ? 0 : currentPhaseIndex;
    setIsPlaying(true);
    // Defer one tick so stateRef.current.playing reflects true.
    setTimeout(() => {
      stateRef.current.playing = true;
      runPlayback(startIdx);
    }, 0);
  }, [isPlaying, currentPhaseIndex, lastIdx, mode, runPlayback, cancelRaf]);

  const phaseBtnCls = (active) =>
    `px-3 py-1.5 text-xs font-semibold rounded transition-colors border ${
      active
        ? 'bg-[#002144] text-white border-[#002144]'
        : 'bg-white text-gray-700 border-gray-300 hover:border-[#39b6e6]'
    }`;

  void animationProgress;

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex flex-wrap items-center gap-3">
      {/* Segmented phase buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {phases.map((p, i) => (
          <button
            key={i}
            onClick={() => handleJumpTo(i)}
            className={phaseBtnCls(i === currentPhaseIndex)}
            title={p.scenarioName || p.label}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-gray-200" />

      {/* Play / Pause */}
      <button
        onClick={handlePlayPause}
        disabled={phases.length < 2}
        className="px-3 py-1.5 text-xs font-semibold rounded bg-[#39b6e6] hover:bg-[#2da0cc] disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors"
        title={isPlaying ? 'Pause animation' : 'Auto-play through phases'}
      >
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      {/* Mode toggle */}
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="phase-play-mode"
            checked={mode === 'loop'}
            onChange={() => setMode('loop')}
            className="accent-[#002144]"
          />
          Loop
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="phase-play-mode"
            checked={mode === 'single'}
            onChange={() => setMode('single')}
            className="accent-[#002144]"
          />
          Single Play
        </label>
      </div>
    </div>
  );
}
