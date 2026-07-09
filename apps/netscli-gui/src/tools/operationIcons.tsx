import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

function createOperationIcon(displayName: string, paths: ReactNode): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function OperationIcon(
    {
      color = 'currentColor',
      fill = 'none',
      size = 24,
      strokeWidth = 1.75,
      absoluteStrokeWidth,
      ...props
    },
    ref,
  ) {
    const numericSize = typeof size === 'number' ? size : Number.parseFloat(String(size));
    const numericStrokeWidth = typeof strokeWidth === 'number' ? strokeWidth : Number.parseFloat(String(strokeWidth));
    const width =
      absoluteStrokeWidth && Number.isFinite(numericSize) && Number.isFinite(numericStrokeWidth)
        ? (numericStrokeWidth * 16) / numericSize
        : strokeWidth;

    return (
      <svg
        aria-hidden="true"
        fill={fill}
        height={size}
        ref={ref}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={width}
        viewBox="0 0 16 16"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        {paths}
      </svg>
    );
  });
  Icon.displayName = displayName;
  return Icon as LucideIcon;
}

export const PortScanIcon = createOperationIcon(
  'PortScanIcon',
  <>
    <path d="M5.2 3.3H3.7v1.5" />
    <path d="M10.8 3.3h1.5v1.5" />
    <path d="M12.3 11.2v1.5h-1.5" />
    <path d="M3.7 11.2v1.5h1.5" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
  </>,
);

export const PingIcon = createOperationIcon(
  'PingIcon',
  <>
    <circle cx="8" cy="8" r="5" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
  </>,
);

export const TraceRouteIcon = createOperationIcon(
  'TraceRouteIcon',
  <>
    <path d="M4.2 11.8 7.2 8.2 5.6 5.1 11.8 4.2" />
    <circle cx="4.2" cy="11.8" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="7.2" cy="8.2" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="11.8" cy="4.2" r="1.05" fill="currentColor" stroke="none" />
  </>,
);

export const DiscoverIcon = createOperationIcon(
  'DiscoverIcon',
  <>
    <rect x="7" y="2.8" width="2" height="2" rx="0.4" />
    <rect x="3.4" y="11.2" width="2" height="2" rx="0.4" />
    <rect x="10.6" y="11.2" width="2" height="2" rx="0.4" />
    <path d="M8 4.8v3.2H4.4v3.2" />
    <path d="M8 8h3.6v3.2" />
  </>,
);

export const InspectIcon = createOperationIcon(
  'InspectIcon',
  <>
    <circle cx="7" cy="7" r="3.4" />
    <path d="m9.5 9.5 3.2 3.2" />
    <path d="M5.6 7h2.8" />
  </>,
);

export const SweepIcon = createOperationIcon(
  'SweepIcon',
  <>
    <path d="M3 4.5h6" />
    <path d="M3 8h8" />
    <path d="M3 11.5h6" />
    <path d="m10.2 5.4 2.6 2.6-2.6 2.6" />
  </>,
);

export const DnsLookupIcon = createOperationIcon(
  'DnsLookupIcon',
  <>
    <circle cx="8" cy="8" r="5" />
    <path d="M3 8h10" />
    <path d="M8 3c1.2 1.3 1.8 3 1.8 5s-.6 3.7-1.8 5" />
    <path d="M8 3C6.8 4.3 6.2 6 6.2 8s.6 3.7 1.8 5" />
  </>,
);

export const ReverseDnsIcon = createOperationIcon(
  'ReverseDnsIcon',
  <>
    <path d="M4 5h8" />
    <path d="m9.8 3 2.2 2-2.2 2" />
    <path d="M12 11H4" />
    <path d="m6.2 9-2.2 2 2.2 2" />
  </>,
);

export const MdnsDiscoveryIcon = createOperationIcon(
  'MdnsDiscoveryIcon',
  <>
    <circle cx="4.4" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="M7.1 5.9a3 3 0 0 1 0 4.2" />
    <path d="M9.6 3.6a6.2 6.2 0 0 1 0 8.8" />
  </>,
);

export const InterfacesIcon = createOperationIcon(
  'InterfacesIcon',
  <>
    <path d="M4 4.5h8v5.2l-1.3 1.3H5.3L4 9.7Z" />
    <path d="M6.1 6.5v1.8" />
    <path d="M8 6.5v1.8" />
    <path d="M9.9 6.5v1.8" />
  </>,
);

export const ArpTableIcon = createOperationIcon(
  'ArpTableIcon',
  <>
    <rect x="3.2" y="4" width="9.6" height="8" rx="0.8" />
    <path d="M3.2 6.8h9.6" />
    <path d="M6.4 4v8" />
    <path d="M9.6 4v8" />
  </>,
);

export const PacketCaptureIcon = createOperationIcon(
  'PacketCaptureIcon',
  <>
    <rect x="3.2" y="4.5" width="9.6" height="7" rx="1" />
    <path d="M4.8 8h1.5l.9-1.8 1.7 3.6L10 8h1.2" />
  </>,
);
