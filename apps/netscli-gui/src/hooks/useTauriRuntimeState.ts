import { useEffect, useState } from 'react';

import { isTauri } from '../services/env';
import {
  chooseFileSaveDefaultDirectory,
  clearFileSaveDefaultDirectory,
  getFileSavePreferences,
  getPcapCapability,
  setFileSaveAskEachTime,
} from '../services/netscli';
import type { FileSavePreferences } from '../types/netscli';

export function useTauriRuntimeState() {
  const [fileSavePreferences, setFileSavePreferences] = useState<FileSavePreferences>({
    ask_each_time: false,
    default_directory: null,
  });
  const [pcapAvailable, setPcapAvailable] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void Promise.allSettled([getPcapCapability(), getFileSavePreferences()]).then((results) => {
      if (cancelled) return;
      const [pcapCapability, savePreferences] = results;
      setPcapAvailable(pcapCapability.status === 'fulfilled' ? pcapCapability.value.available : false);
      if (savePreferences.status === 'fulfilled') {
        setFileSavePreferences(savePreferences.value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleFileSaveAskEachTime() {
    if (!isTauri()) return;
    try {
      const next = await setFileSaveAskEachTime(!fileSavePreferences.ask_each_time);
      setFileSavePreferences(next);
    } catch (error) {
      console.error(error);
    }
  }

  async function chooseSaveFolder() {
    if (!isTauri()) return;
    try {
      const next = await chooseFileSaveDefaultDirectory();
      setFileSavePreferences(next);
    } catch (error) {
      if (!/cancelled/i.test(String(error))) console.error(error);
    }
  }

  async function clearSaveFolder() {
    if (!isTauri()) return;
    try {
      const next = await clearFileSaveDefaultDirectory();
      setFileSavePreferences(next);
    } catch (error) {
      console.error(error);
    }
  }

  return {
    chooseSaveFolder,
    clearSaveFolder,
    fileSavePreferences,
    pcapAvailable,
    toggleFileSaveAskEachTime,
  };
}
