import React, { useEffect, useRef, useState, useCallback } from 'react';

const FADE_MS = 600;
const HOLD_MS = 400;
const LOOP_HOLD_MS = 2000;

/**
 * Drives sequential column reveal for the multi-stage Sankey.
 *
 * Animation contract:
 *   - Each subsequent column fades in over FADE_MS via requestAnimationFrame.
 *   - HOLD_MS pause between columns at step boundaries.
 *   - Pause requests are honored at the next step boundary (the in-progress
 *     fade completes first, then the controller halts).
 *   - On completion: Single mode -> show Replay; Loop mode -> hold LOOP_HOLD_MS
 *     then auto-reset and replay.
 *
 * State surfaced to parent via onChange({ revealedColumnCount, transitionProgress }):
 *   - revealedColumnCount: number of columns fully visible (1..columnCount)
 *   - transitionProgress: 0..1 fade for the column at index revealedColumnCount
 *     (only meaningful while < columnCount; 0 when settled)
 */
export default function RevealController({ phaseSequence, columnCount, revealedColumnCount, transitionProgress, onChange }) {
  void phaseSequence;
  void transitionProgress;

  // 'idle' | 'playing' | 'paused' | 'complete'
  const [state, setState] = useState('idle');
  const [mode, setMode] = useState('single'); // 'single' | 'loop' (default: single, preserved from Prompt 1)

  const rafRef = useRef(null);
  const loopTimerRef = useRef(null);
  const pauseRequestRef = useRef(false);
  const cursorRef = useRef(revealedColumnCount); // current "fully visible count"
  const stateRef = useRef({ state: 'idle', mode: 'single', columnCount });

  // Sync refs so the RAF closure reads fresh values without re-binding loops.
  stateRef.current = { state, mode, columnCount };
  cursorRef.current = revealedColumnCount;

  const cancelRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancelLoopTimer = useCallback(() => {
    if (loopTimerRef.current != null) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
  }, []);

  // RAF tween: fade column at index `targetIdx` from 0 -> 1 over FADE_MS.
  // Resolves when settled. The destination column is then fully visible
  // (revealedColumnCount = targetIdx + 1, transitionProgress = 0).
  const fadeIn = useCallback((targetIdx) => {
    return new Promise(resolve => {
      const start = performance.now();
      const step = (now) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / FADE_MS);
        if (t < 1) {
          // While fading: revealedColumnCount stays at targetIdx (the count
          // of fully-visible columns before this one); transitionProgress
          // expresses the fading column's opacity.
          onChange({ revealedColumnCount: targetIdx, transitionProgress: t });
          rafRef.current = requestAnimationFrame(step);
        } else {
          onChange({ revealedColumnCount: targetIdx + 1, transitionProgress: 0 });
          cursorRef.current = targetIdx + 1;
          rafRef.current = null;
          resolve();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    });
  }, [onChange]);

  const wait = useCallback((ms) => {
    return new Promise(resolve => {
      const start = performance.now();
      const step = (now) => {
        if (now - start >= ms) { resolve(); return; }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    });
  }, []);

  const runReveal = useCallback(async () => {
    while (true) {
      const cc = stateRef.current.columnCount;
      const cursor = cursorRef.current;
      if (cursor >= cc) {
        // Reached completion.
        if (stateRef.current.mode === 'loop') {
          // Hold then loop. Use a setTimeout so a Pause/Replay can cancel it.
          await new Promise(resolve => {
            loopTimerRef.current = setTimeout(() => {
              loopTimerRef.current = null;
              resolve();
            }, LOOP_HOLD_MS);
          });
          if (stateRef.current.state !== 'playing') return;
          // Reset and continue loop.
          onChange({ revealedColumnCount: 1, transitionProgress: 0 });
          cursorRef.current = 1;
          continue;
        }
        // Single mode -> complete.
        setState('complete');
        return;
      }

      // Reveal the next column.
      await fadeIn(cursor);

      // Pause boundary: if a pause was requested mid-fade, halt now.
      if (pauseRequestRef.current) {
        pauseRequestRef.current = false;
        setState('paused');
        return;
      }

      // Hold between fades unless this was the last column.
      if (cursorRef.current < stateRef.current.columnCount) {
        await wait(HOLD_MS);
      }

      // Re-check pause request after the hold (defensive).
      if (pauseRequestRef.current) {
        pauseRequestRef.current = false;
        setState('paused');
        return;
      }
    }
  }, [fadeIn, wait, onChange]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cancelRaf();
      cancelLoopTimer();
    };
  }, [cancelRaf, cancelLoopTimer]);

  // Cancel timers when mode changes (avoid an in-flight Loop hold persisting
  // after the user flips to Single).
  useEffect(() => {
    cancelLoopTimer();
  }, [mode, cancelLoopTimer]);

  // Clamp cursor when columnCount shrinks (parent removed a column).
  useEffect(() => {
    if (revealedColumnCount > columnCount) {
      onChange({ revealedColumnCount: Math.max(1, columnCount), transitionProgress: 0 });
    }
  }, [columnCount, revealedColumnCount, onChange]);

  const startReveal = useCallback((fromCursor) => {
    cursorRef.current = fromCursor;
    pauseRequestRef.current = false;
    setState('playing');
    // Defer until state effect lands so stateRef.current.state reads 'playing'.
    setTimeout(() => {
      stateRef.current = { ...stateRef.current, state: 'playing' };
      runReveal();
    }, 0);
  }, [runReveal]);

  const handlePlay = useCallback(() => {
    if (columnCount < 2) return;
    if (state === 'playing') return;
    if (state === 'paused') {
      // Resume from current cursor.
      startReveal(cursorRef.current);
      return;
    }
    // idle or complete shouldn't normally land here (Replay handles complete),
    // but guard anyway: start fresh.
    onChange({ revealedColumnCount: 1, transitionProgress: 0 });
    startReveal(1);
  }, [state, columnCount, onChange, startReveal]);

  const handlePause = useCallback(() => {
    if (state !== 'playing') return;
    pauseRequestRef.current = true;
  }, [state]);

  const handleReplay = useCallback(() => {
    cancelRaf();
    cancelLoopTimer();
    pauseRequestRef.current = false;
    onChange({ revealedColumnCount: 1, transitionProgress: 0 });
    startReveal(1);
  }, [cancelRaf, cancelLoopTimer, onChange, startReveal]);

  const playDisabled = columnCount < 2;
  const playTitle = playDisabled ? 'Add at least one column to enable reveal.' : (state === 'paused' ? 'Resume reveal' : 'Auto-reveal columns left to right');

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex flex-wrap items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mr-1">Reveal</span>

      {state !== 'playing' && state !== 'complete' && (
        <button
          onClick={handlePlay}
          disabled={playDisabled}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-[#39B6E6] hover:bg-[#2da0cc] disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors"
          title={playTitle}
        >
          {state === 'paused' ? '▶ Resume' : '▶ Play'}
        </button>
      )}

      {state === 'playing' && (
        <button
          onClick={handlePause}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-[#002144] hover:bg-[#001a36] text-white transition-colors"
          title="Pause at next step boundary"
        >
          ⏸ Pause
        </button>
      )}

      {(state === 'paused' || state === 'complete') && (
        <button
          onClick={handleReplay}
          disabled={playDisabled}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-white border border-[#002144] text-[#002144] hover:bg-[#002144]/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Reset to first column and replay"
        >
          ⟳ Replay
        </button>
      )}

      <div className="h-6 w-px bg-gray-200" />

      <div className="flex items-center gap-3 text-xs text-gray-600">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="brat-reveal-mode"
            checked={mode === 'loop'}
            onChange={() => setMode('loop')}
            className="accent-[#002144]"
          />
          Loop
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="brat-reveal-mode"
            checked={mode === 'single'}
            onChange={() => setMode('single')}
            className="accent-[#002144]"
          />
          Single
        </label>
      </div>

      <div className="ml-auto text-[11px] text-gray-400 font-mono">
        {Math.min(revealedColumnCount, columnCount)} / {columnCount} columns
      </div>
    </div>
  );
}
