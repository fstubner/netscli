import { useEffect, useState } from 'react';

import { isTauri } from '../services/env';
import {
  chooseFileSaveDefaultDirectory,
  clearFileSaveDefaultDirectory,
  getFileSavePreferences,
  getMdnsCapability,
  getPcapCapability,
  setFileSaveAskEachTime,
} from '../services/netscli';
import type { FileSavePreferences, OptionalCapability } from '../types/netscli';
import type { PcapCapability } from '../types/netscli';
import type { ToolCapabilityMap } from '../tools/types';

export function useTauriRuntimeState() {
  const [fileSavePreferences, setFileSavePreferences] = useState<FileSavePreferences>({
    ask_each_time: false,
    default_directory: null,
  });
  const [pcapCapability, setPcapCapability] = useState<PcapCapability>({
    compiled: false,
    available: false,
    interfaces: [],
    message: 'Checking Packet Capture support.',
  });
  const [mdnsCapability, setMdnsCapability] = useState<OptionalCapability>({
    compiled: true,
    available: true,
    message: null,
  });

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void Promise.allSettled([getPcapCapability(), getMdnsCapability(), getFileSavePreferences()]).then((results) => {
      if (cancelled) return;
      const [pcapCapability, mdnsCapability, savePreferences] = results;
      setPcapCapability(
        pcapCapability.status === 'fulfilled'
          ? pcapCapability.value
          : {
              compiled: false,
              available: false,
              interfaces: [],
              message: 'Packet Capture support could not be checked.',
            },
      );
      setMdnsCapability(
        mdnsCapability.status === 'fulfilled'
          ? mdnsCapability.value
          : {
              compiled: false,
              available: false,
              message: 'mDNS discovery support could not be checked.',
            },
      );
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

  // Packet Capture stays in the menu even on a build without the feature.
  //
  // It used to be filtered out, which is why the docs disagreed with each
  // other: `docs/install.md` and `docs/RELEASE.md` both say the tool appears
  // and presents setup guidance, while the app removed it entirely. Since no
  // published installer is built with `--features pcap`, every real user got
  // the hidden version — they went looking for packet capture, found no
  // trace of it, and no explanation of why.
  //
  // Nothing else is needed to make this safe. The pane already renders
  // `PcapUnavailableState` whenever the capability is unavailable, and
  // `runDisabledReason` in App.tsx already disables Run for the same
  // condition, so the tool is visible, explains itself, and stays
  // non-runnable — which is what RELEASE.md specifies.
  //
  // mDNS keeps the capability check: it is on by default in every published
  // build, so hiding it means the feature genuinely is not there.
  const toolCapabilities: ToolCapabilityMap = {
    mdns: mdnsCapability.compiled,
  };

  return {
    chooseSaveFolder,
    clearSaveFolder,
    fileSavePreferences,
    mdnsCapability,
    pcapCapability,
    toolCapabilities,
    toggleFileSaveAskEachTime,
  };
}
