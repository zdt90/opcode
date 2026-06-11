import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { api } from '../lib/api';

export type UIScale = 'small' | 'medium' | 'large';

interface UIScaleContextType {
  scale: UIScale;
  setScale: (scale: UIScale) => Promise<void>;
  isLoading: boolean;
}

const UIScaleContext = createContext<UIScaleContextType | undefined>(undefined);

const SCALE_STORAGE_KEY = 'ui_scale_preference';

// Maps each scale to a CSS zoom factor applied on the document root, scaling the
// whole UI (fonts + layout) like VSCode's cmd +/-. "medium" matches the
// previous, unscaled state.
const SCALE_FACTORS: Record<UIScale, number> = {
  small: 0.9,
  medium: 1,
  large: 1.1,
};

const isValidScale = (value: unknown): value is UIScale =>
  value === 'small' || value === 'medium' || value === 'large';

const applyScale = (scale: UIScale) => {
  const factor = SCALE_FACTORS[scale] ?? 1;
  // `zoom` is non-standard but supported by the Chromium/WebKit webviews Tauri
  // uses, and scales layout as well as text.
  document.documentElement.style.setProperty('zoom', String(factor));
};

export const UIScaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scale, setScaleState] = useState<UIScale>('medium');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadScale = async () => {
      try {
        const saved = await api.getSetting(SCALE_STORAGE_KEY);
        if (isValidScale(saved)) {
          setScaleState(saved);
          applyScale(saved);
        } else {
          applyScale('medium');
        }
      } catch (error) {
        console.error('Failed to load UI scale preference:', error);
        applyScale('medium');
      } finally {
        setIsLoading(false);
      }
    };

    loadScale();
  }, []);

  const setScale = useCallback(async (newScale: UIScale) => {
    try {
      setScaleState(newScale);
      applyScale(newScale);
      await api.saveSetting(SCALE_STORAGE_KEY, newScale);
    } catch (error) {
      console.error('Failed to save UI scale preference:', error);
    }
  }, []);

  const value: UIScaleContextType = { scale, setScale, isLoading };

  return (
    <UIScaleContext.Provider value={value}>
      {children}
    </UIScaleContext.Provider>
  );
};

export const useUIScale = () => {
  const context = useContext(UIScaleContext);
  if (!context) {
    throw new Error('useUIScale must be used within a UIScaleProvider');
  }
  return context;
};
