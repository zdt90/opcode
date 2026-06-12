import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { api } from '../lib/api';

const AUTOCORRECT_KEY = 'input_autocorrect';

interface InputBehaviorContextType {
  /** When true (default), OS-level auto-correction is enabled in the prompt textarea. */
  autoCorrect: boolean;
  setAutoCorrect: (value: boolean) => Promise<void>;
  isLoading: boolean;
}

const InputBehaviorContext = createContext<InputBehaviorContextType | undefined>(undefined);

export const InputBehaviorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [autoCorrect, setAutoCorrectState] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const saved = await api.getSetting(AUTOCORRECT_KEY);
        // null means the key was never written → keep the default (true = on)
        if (saved !== null) setAutoCorrectState(saved === 'true');
      } catch {
        // Ignore — keep default (on)
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const setAutoCorrect = useCallback(async (value: boolean) => {
    setAutoCorrectState(value);
    await api.saveSetting(AUTOCORRECT_KEY, value ? 'true' : 'false');
  }, []);

  return (
    <InputBehaviorContext.Provider value={{ autoCorrect, setAutoCorrect, isLoading }}>
      {children}
    </InputBehaviorContext.Provider>
  );
};

export const useInputBehavior = () => {
  const ctx = useContext(InputBehaviorContext);
  if (!ctx) throw new Error('useInputBehavior must be used within InputBehaviorProvider');
  return ctx;
};

