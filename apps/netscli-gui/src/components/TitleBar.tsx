import React, { useState, useEffect, useRef } from 'react';
import './TitleBar.css';

interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  separator?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface TitleBarProps {
  menus?: Menu[];
}

/**
 * Custom title bar used when Tauri renders the app without native
 * decorations (`decorations: false` in tauri.conf.json). Falls back to
 * rendering nothing in the browser dev build so `vite dev` doesn't show
 * unusable window controls.
 */
export const TitleBar: React.FC<TitleBarProps> = ({ menus = [] }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Keep the unlisten handle on a ref so that when StrictMode or a
    // parent re-render unmounts us before `onResized` resolves, we can
    // still dispose the listener once the registration completes.
    const unlistenRef: { current: null | (() => void) } = { current: null };

    (async () => {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
        return;
      }

      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (cancelled) return;

        setIsTauri(true);
        const win = getCurrentWindow();
        const maximized = await win.isMaximized();
        if (cancelled) return;
        setIsMaximized(maximized);

        const unlisten = await win.onResized(async () => {
          const max = await win.isMaximized();
          if (!cancelled) setIsMaximized(max);
        });

        if (cancelled) {
          // Unmounted before subscription finished — dispose immediately.
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      } catch {
        // Tauri API genuinely unavailable (e.g. browser dev build without
        // the internals injected). No user-facing recovery is needed.
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // Close menu on click outside.
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setExpandedMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleMinimize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error('Failed to minimize:', err);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (isMaximized) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (err) {
      console.error('Failed to toggle maximize:', err);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Failed to close:', err);
    }
  };

  const handleMenuItemClick = (item: MenuItem) => {
    item.action?.();
    setMenuOpen(false);
    setExpandedMenu(null);
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
    setExpandedMenu(null);
  };

  const toggleSubmenu = (label: string) => {
    setExpandedMenu((prev) => (prev === label ? null : label));
  };

  if (!isTauri) {
    // No native window controls in the browser dev build.
    return null;
  }

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar-content">
        <div className="title-bar-left">
          {menus.length > 0 && (
            <div className="title-bar-menu-container" ref={menuRef}>
              <button
                className={`title-bar-hamburger ${menuOpen ? 'active' : ''}`}
                onClick={toggleMenu}
                onMouseDown={(e) => e.stopPropagation()}
                title="Menu"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <path
                    fill="currentColor"
                    d="M2 3h12v1.5H2V3zm0 4.25h12v1.5H2v-1.5zm0 4.25h12V13H2v-1.5z"
                  />
                </svg>
              </button>
              {menuOpen && (
                <div className="hamburger-dropdown">
                  {menus.map((menu) => (
                    <div key={menu.label} className="hamburger-menu-group">
                      <button
                        className={`hamburger-menu-header ${
                          expandedMenu === menu.label ? 'expanded' : ''
                        }`}
                        onClick={() => toggleSubmenu(menu.label)}
                      >
                        <span>{menu.label}</span>
                        <svg
                          className="hamburger-chevron"
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                        >
                          <path fill="currentColor" d="M3 2l4 3-4 3V2z" />
                        </svg>
                      </button>
                      {expandedMenu === menu.label && (
                        <div className="hamburger-submenu">
                          {menu.items.map((item, idx) =>
                            item.separator ? (
                              // Separators don't have unique labels, so combine
                              // the parent menu label with the index to get a
                              // stable key that doesn't collide with siblings.
                              <div
                                key={`${menu.label}-sep-${idx}`}
                                className="hamburger-separator"
                              />
                            ) : (
                              <button
                                key={`${menu.label}-${item.label}`}
                                className="hamburger-submenu-item"
                                onClick={() => handleMenuItemClick(item)}
                              >
                                <span className="hamburger-item-label">{item.label}</span>
                                {item.shortcut && (
                                  <span className="hamburger-item-shortcut">
                                    {item.shortcut}
                                  </span>
                                )}
                              </button>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="title-bar-title">NetsCLI</div>
        </div>
        <div className="title-bar-controls">
          <button
            className="title-bar-button"
            onClick={handleMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            title="Minimize"
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path fill="currentColor" d="M0 5h12v2H0z" />
            </svg>
          </button>
          <button
            className="title-bar-button"
            onClick={handleMaximize}
            onMouseDown={(e) => e.stopPropagation()}
            title={isMaximized ? 'Restore' : 'Maximize'}
            type="button"
          >
            {isMaximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path fill="currentColor" d="M2 2h4v4H2V2zm4 4h4v4H6V6z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path fill="currentColor" d="M2 2h8v8H2z" />
              </svg>
            )}
          </button>
          <button
            className="title-bar-button title-bar-button-close"
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            title="Close"
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                fill="currentColor"
                d="M1 1l10 10M11 1L1 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
