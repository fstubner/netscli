import type { LucideIcon } from 'lucide-react';

import { TOOL_CONFIG } from '../../tools/registry';
import type { ToolKind } from '../../tools/types';

export interface MenuItem {
  label: string;
  Icon: LucideIcon;
  action?: () => void;
  disabled?: boolean;
  selected?: boolean;
  variant?: 'danger';
  /** Rendered as unavailable, but still clickable. See `toolItemFactory`. */
  muted?: boolean;
  tooltip?: string;
}

export interface MenuSection {
  label?: string;
  items: MenuItem[];
}

/**
 * Build a menu entry for a tool, greyed with the reason when it cannot run.
 *
 * Greyed rather than removed: removing it is what the app used to do, and
 * people went looking for packet capture, found no trace of it, and no
 * explanation either.
 *
 * Greyed but still clickable, deliberately. The pane behind it carries the
 * setup instructions and the link to them, so a genuinely inert entry would
 * take away the one place that says how to fix the thing it is greyed for.
 */
export function toolItemFactory(
  onAddTab: (kind: ToolKind) => void,
  reasons?: Partial<Record<ToolKind, string>>
): (kind: ToolKind) => MenuItem {
  return (kind) => {
    const reason = reasons?.[kind];
    return {
      label: TOOL_CONFIG[kind].label,
      Icon: TOOL_CONFIG[kind].Icon,
      action: () => onAddTab(kind),
      muted: Boolean(reason),
      tooltip: reason ? `${reason} Open for setup instructions.` : undefined,
    };
  };
}
