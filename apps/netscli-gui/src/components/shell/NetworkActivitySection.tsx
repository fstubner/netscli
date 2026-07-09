import { Network } from 'lucide-react';

import type { DefaultInterfaceInfo, InterfaceInfo } from '../../types/netscli';
import type { AddressPreference, TrafficDisplayUnit, TrafficPrecision } from '../../hooks/usePreferences';
import { NetworkInterfacePicker } from './NetworkInterfacePicker';
import { SettingsSelect, SettingsSwitch } from './SettingsControls';

interface NetworkActivitySectionProps {
  addressPreference: AddressPreference;
  animateTrafficArrows: boolean;
  defaultInterface: DefaultInterfaceInfo | null;
  interfaces: InterfaceInfo[];
  trafficDisplayUnit: TrafficDisplayUnit;
  trafficInterfaceName: string | null;
  trafficPrecision: TrafficPrecision;
  onSelectTrafficInterface: (name: string) => void;
  onSetAddressPreference: (preference: AddressPreference) => void;
  onSetTrafficDisplayUnit: (unit: TrafficDisplayUnit) => void;
  onSetTrafficPrecision: (precision: TrafficPrecision) => void;
  onToggleTrafficArrowAnimation: () => void;
}

export function NetworkActivitySection({
  addressPreference,
  animateTrafficArrows,
  defaultInterface,
  interfaces,
  trafficDisplayUnit,
  trafficInterfaceName,
  trafficPrecision,
  onSelectTrafficInterface,
  onSetAddressPreference,
  onSetTrafficDisplayUnit,
  onSetTrafficPrecision,
  onToggleTrafficArrowAnimation,
}: NetworkActivitySectionProps) {
  return (
    <section className="settings-section">
      <span className="settings-section-label">
        <Network size={13} />
        Network Activity
      </span>
      <SettingsSwitch
        checked={animateTrafficArrows}
        label="Activity Animation"
        note="Flicker the status-bar arrows only when sampled traffic changes."
        testId="settings-activity-animation-toggle"
        onClick={onToggleTrafficArrowAnimation}
      />
      <div className="settings-row">
        <div className="settings-row-copy">
          <span>Traffic Units</span>
          <small>Unit shown beside status-bar upload and download rates.</small>
        </div>
        <SettingsSelect
          label="Traffic Units"
          testId="settings-traffic-unit"
          value={trafficDisplayUnit}
          options={[
            { value: 'Gbps', label: 'Gbps' },
            { value: 'Mbps', label: 'Mbps' },
            { value: 'Kbps', label: 'Kbps' },
          ]}
          onSelect={(value) => onSetTrafficDisplayUnit(value as TrafficDisplayUnit)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-copy">
          <span>Traffic Precision</span>
          <small>Decimal places for status-bar traffic rates.</small>
        </div>
        <SettingsSelect
          label="Traffic Precision"
          testId="settings-traffic-precision"
          value={String(trafficPrecision)}
          options={[
            { value: '0', label: '0 decimals' },
            { value: '1', label: '1 decimal' },
            { value: '2', label: '2 decimals' },
          ]}
          onSelect={(value) => onSetTrafficPrecision(Number(value) as TrafficPrecision)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-copy">
          <span>Network Interface</span>
          <small>Interface used for status-bar traffic rates.</small>
        </div>
        <NetworkInterfacePicker
          compact
          defaultInterface={defaultInterface}
          interfaces={interfaces}
          selectedName={trafficInterfaceName}
          onSelect={onSelectTrafficInterface}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-copy">
          <span>Address Preference</span>
          <small>Address family shown beside the selected interface.</small>
        </div>
        <SettingsSelect
          label="Address Preference"
          testId="settings-address-preference"
          value={addressPreference}
          options={[
            { value: 'ipv4', label: 'IPv4 first' },
            { value: 'ipv6', label: 'IPv6 first' },
          ]}
          onSelect={(value) => onSetAddressPreference(value as AddressPreference)}
        />
      </div>
    </section>
  );
}
