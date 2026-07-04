import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export interface AnchorRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface PopoverPosition {
  left: number;
  maxHeight: number;
  top: number;
}

interface PopoverPositionOptions {
  align?: 'start' | 'end';
  height: number;
  offset?: number;
  padding?: number;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
}

export function computePopoverPosition(
  anchor: AnchorRect,
  {
    align = 'start',
    height,
    offset = 4,
    padding = 8,
    viewportHeight,
    viewportWidth,
    width,
  }: PopoverPositionOptions,
): PopoverPosition {
  const preferredLeft = align === 'end' ? anchor.right - width : anchor.left;
  const left = clamp(preferredLeft, padding, Math.max(padding, viewportWidth - width - padding));

  const below = anchor.bottom + offset;
  const above = anchor.top - height - offset;
  const top =
    below + height <= viewportHeight - padding || above < padding
      ? clamp(below, padding, Math.max(padding, viewportHeight - height - padding))
      : Math.max(padding, above);

  return {
    left: Math.round(left),
    maxHeight: Math.max(120, Math.round(viewportHeight - top - padding)),
    top: Math.round(top),
  };
}

export function computePointPopoverPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
): PopoverPosition {
  const left = clamp(x, padding, Math.max(padding, viewportWidth - width - padding));
  const top = clamp(y, padding, Math.max(padding, viewportHeight - height - padding));
  return {
    left: Math.round(left),
    maxHeight: Math.max(120, Math.round(viewportHeight - top - padding)),
    top: Math.round(top),
  };
}

export function useAnchoredPopoverPosition({
  align = 'start',
  anchorRef,
  estimatedHeight = 260,
  open,
  panelRef,
  positionKey,
  width,
}: {
  align?: 'start' | 'end';
  anchorRef: RefObject<HTMLElement | null>;
  estimatedHeight?: number;
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  positionKey?: unknown;
  width: number;
}) {
  const [position, setPosition] = useState<PopoverPosition>({ left: 8, maxHeight: estimatedHeight, top: 8 });

  useLayoutEffect(() => {
    if (!open) return;

    function update() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const panelRect = panelRef.current?.getBoundingClientRect();
      setPosition(
        computePopoverPosition(anchor.getBoundingClientRect(), {
          align,
          height: panelRect?.height || estimatedHeight,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          width: panelRect?.width || width,
        }),
      );
    }

    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [align, anchorRef, estimatedHeight, open, panelRef, positionKey, width]);

  return position;
}

export function useOverlayDismiss({
  enabled,
  onClose,
  refs,
  restoreFocusRef,
}: {
  enabled: boolean;
  onClose: () => void;
  refs: Array<RefObject<HTMLElement | null>>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!enabled) return;

    function close() {
      onClose();
      window.setTimeout(() => restoreFocusRef?.current?.focus({ preventScroll: true }), 0);
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, onClose, refs, restoreFocusRef]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
