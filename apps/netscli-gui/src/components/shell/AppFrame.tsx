import { Minus, Square, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import type { AppWindowAction } from '../../services/appWindow';

interface AppFrameProps {
  children: ReactNode;
  onDragStart: (event: MouseEvent<HTMLDivElement>) => void;
  onWindowAction: (action: AppWindowAction) => void;
}

export function AppFrame({ children, onDragStart, onWindowAction }: AppFrameProps) {
  return (
    <header className="app-frame" onDoubleClick={() => onWindowAction('maximize')}>
      <div className="app-frame-drag" onMouseDown={onDragStart}>
        {children}
      </div>
      <div className="window-controls">
        <button
          aria-label="Minimize"
          data-tooltip="Minimize"
          data-tooltip-placement="bottom"
          onClick={() => onWindowAction('minimize')}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label="Maximize"
          data-tooltip="Maximize"
          data-tooltip-placement="bottom"
          onClick={() => onWindowAction('maximize')}
        >
          <Square size={12} />
        </button>
        <button
          aria-label="Close"
          data-tooltip="Close"
          data-tooltip-placement="bottom"
          onClick={() => onWindowAction('close')}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}

