import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TooltipState {
  text: string;
  left: number;
  top: number;
  align: 'center' | 'right';
  placement: 'top' | 'bottom';
}

export function AppTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    let left = tooltip.left;
    let top = tooltip.top;

    if (rect.left < viewportPadding) {
      left += viewportPadding - rect.left;
    } else if (rect.right > window.innerWidth - viewportPadding) {
      left -= rect.right - (window.innerWidth - viewportPadding);
    }

    if (rect.top < viewportPadding) {
      top += viewportPadding - rect.top;
    } else if (rect.bottom > window.innerHeight - viewportPadding) {
      top -= rect.bottom - (window.innerHeight - viewportPadding);
    }

    left = Math.round(left);
    top = Math.round(top);
    if (left !== tooltip.left || top !== tooltip.top) {
      setTooltip({ ...tooltip, left, top });
    }
  }, [tooltip]);

  useEffect(() => {
    let activeElement: HTMLElement | null = null;
    let closeTimer: number | undefined;

    function clearCloseTimer() {
      if (closeTimer) {
        window.clearTimeout(closeTimer);
        closeTimer = undefined;
      }
    }

    function hide() {
      clearCloseTimer();
      activeElement = null;
      setTooltip(null);
    }

    function showFor(target: HTMLElement) {
      const host = target.closest<HTMLElement>('[data-tooltip]');
      const text = host?.dataset.tooltip;
      if (!host || !text) return;

      clearCloseTimer();
      activeElement = host;
      const rect = host.getBoundingClientRect();
      const placement = host.dataset.tooltipPlacement === 'bottom' ? 'bottom' : 'top';
      const align = host.dataset.tooltipAlign === 'right' ? 'right' : 'center';
      const x = align === 'right' ? rect.right : rect.left + rect.width / 2;
      const y = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;
      setTooltip({
        text,
        left: Math.round(x),
        top: Math.round(y),
        align,
        placement,
      });
    }

    function handlePointerOver(event: PointerEvent) {
      showFor(event.target as HTMLElement);
    }

    function handlePointerOut(event: PointerEvent) {
      if (!activeElement) return;
      const related = event.relatedTarget as Node | null;
      if (related && activeElement.contains(related)) return;
      closeTimer = window.setTimeout(hide, 40);
    }

    function handleFocusIn(event: FocusEvent) {
      showFor(event.target as HTMLElement);
    }

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearCloseTimer();
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  if (!tooltip) return null;

  return (
    <div
      className={`app-tooltip align-${tooltip.align} placement-${tooltip.placement}`}
      data-testid="app-tooltip"
      ref={tooltipRef}
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>
  );
}
