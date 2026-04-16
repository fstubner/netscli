import React from 'react';
import './Banner.css';

interface BannerProps {
  compact?: boolean;
}

// ASCII banner text for NETSCLI (single font, no per-character spans).
const ASCII_BANNER = [
  '███╗   ██╗███████╗████████╗███████╗ ██████╗██╗     ██╗',
  '████╗  ██║██╔════╝╚══██╔══╝██╔════╝██╔════╝██║     ██║',
  '██╔██╗ ██║█████╗     ██║   ███████╗██║     ██║     ██║',
  '██║╚██╗██║██╔══╝     ██║   ╚════██║██║     ██║     ██║',
  '██║ ╚████║███████╗   ██║   ███████║╚██████╗███████╗██║',
  '╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚══════╝ ╚═════╝╚══════╝╚═╝',
];

export const Banner: React.FC<BannerProps> = ({ compact = true }) => {
  return (
    <div className="banner-container" data-compact={compact ? 'true' : 'false'}>
      <div className={`banner-ascii-wrapper${compact ? ' compact' : ''}`}>
        {ASCII_BANNER.map((line, lineIdx) => (
          <div key={lineIdx} className="banner-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};
