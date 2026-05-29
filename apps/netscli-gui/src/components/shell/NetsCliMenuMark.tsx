export function NetsCliMenuMark() {
  return (
    <span className="menu-brand-mark" aria-label="NetsCLI" role="img">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="menu-brand-gradient" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#005a1e" />
            <stop offset="45%" stopColor="#0aae7a" />
            <stop offset="100%" stopColor="#1edcff" />
          </linearGradient>
        </defs>
        <g
          fill="url(#menu-brand-gradient)"
          fontFamily='ui-monospace, "Cascadia Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          fontSize="7.4"
          fontWeight="400"
          textAnchor="middle"
        >
          <text x="32" y="18" xmlSpace="preserve">███╗   ██╗</text>
          <text x="32" y="25.4" xmlSpace="preserve">████╗  ██║</text>
          <text x="32" y="32.8" xmlSpace="preserve">██╔██╗ ██║</text>
          <text x="32" y="40.2" xmlSpace="preserve">██║╚██╗██║</text>
          <text x="32" y="47.6" xmlSpace="preserve">██║ ╚████║</text>
          <text x="32" y="55" xmlSpace="preserve">╚═╝  ╚═══╝</text>
        </g>
      </svg>
    </span>
  );
}

