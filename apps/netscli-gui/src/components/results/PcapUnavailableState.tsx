import { AlertTriangle, ExternalLink } from 'lucide-react';

import { openAllowedExternalUrl } from '../../services/externalLinks';
import type { PcapCapability } from '../../types/netscli';

export function PcapUnavailableState({ capability }: { capability: PcapCapability }) {
  const buildWithoutPcap = !capability.compiled || capability.message?.includes("built without feature 'pcap'");
  const title = buildWithoutPcap ? 'Packet Capture is not included in this build' : 'Packet Capture needs a capture driver';
  const body = buildWithoutPcap
    ? 'Use a PCAP-enabled NetsCLI Desktop build. On Windows, Npcap is also required before captures can run.'
    : 'Install Npcap on Windows, or libpcap on Linux/macOS, then restart NetsCLI and open Packet Capture again.';

  return (
    <div className="pcap-unavailable" data-testid="pcap-unavailable-state">
      <AlertTriangle size={24} />
      <div className="pcap-unavailable-copy">
        <h2>{title}</h2>
        <p>{body}</p>
        {capability.message ? <code>{capability.message}</code> : null}
      </div>
      <button
        type="button"
        onClick={() => void openAllowedExternalUrl('https://github.com/fstubner/netscli#packet-capture')}
      >
        <ExternalLink size={14} />
        <span>Open setup docs</span>
      </button>
    </div>
  );
}
