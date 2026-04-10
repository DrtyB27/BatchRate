import React, { createContext, useContext, useState, useCallback } from 'react';

const ScenarioContext = createContext(null);

export function ScenarioProvider({ children }) {
  const [carrierSelections, setCarrierSelectionsRaw] = useState({});
  const [scenarioName, setScenarioNameRaw] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const setCarrierSelections = useCallback((selectionsOrUpdater) => {
    setCarrierSelectionsRaw(selectionsOrUpdater);
    setIsDirty(true);
  }, []);

  const setScenarioName = useCallback((name) => {
    setScenarioNameRaw(name);
    setIsDirty(true);
  }, []);

  const resetScenario = useCallback(() => {
    setCarrierSelectionsRaw({});
    setScenarioNameRaw('');
    setIsDirty(false);
  }, []);

  const applyScenario = useCallback((selections, name) => {
    setCarrierSelectionsRaw(selections);
    setScenarioNameRaw(name || '');
    setIsDirty(false);
  }, []);

  return (
    <ScenarioContext.Provider value={{
      carrierSelections,
      scenarioName,
      isDirty,
      setCarrierSelections,
      setScenarioName,
      resetScenario,
      applyScenario,
    }}>
      {children}
    </ScenarioContext.Provider>
  );
}

export function useScenario() {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenario must be used within ScenarioProvider');
  return ctx;
}
