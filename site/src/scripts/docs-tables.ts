// Markdown table behaviour for the docs: option markers, per-cell column
// labels for the narrow-screen card layout, and the horizontal scroll
// wrapper.
//
// Split out of docs-header.ts, whose transition exception named
// "split search vs toc vs tables next". This is the tables third.

export function applyDocsTableBehaviour(): void {
  // Two markers, two different rules, and they were four levels of nested
  // loop apart in the same function -- close enough to look identical and
  // far enough apart that the difference was invisible. Named, the
  // difference is the names.

  /** Scan forward past other elements until a table turns up, and tag it. */
  const tagNextTableElement = (marker: Element, option: string): void => {
    let sibling = marker.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLTableElement) {
        sibling.classList.add(option);
        return;
      }
      sibling = sibling.nextElementSibling;
    }
  };

  /** Tag only the very next element, and only if it is a table. */
  const tagImmediatelyFollowingTable = (marker: Node, option: string): void => {
    let sibling = marker.nextSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        if (sibling instanceof HTMLTableElement) sibling.classList.add(option);
        return;
      }
      sibling = sibling.nextSibling;
    }
  };

  /**
   * Copy each column's heading onto its cells as `data-label`.
   *
   * The narrow-screen styles stack a table into cards and print that label
   * beside each value, so a cell without one loses its meaning entirely at
   * mobile widths.
   */
  const labelCellsWithTheirColumn = (table: Element): void => {
    const labels = [...table.querySelectorAll('thead th')].map(
      (cell) => cell.textContent?.trim().replace(/\s+/g, ' ') ?? ''
    );
    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell instanceof HTMLElement && labels[index]) cell.dataset.label = labels[index];
      });
    });
  };

  const tableOptionClasses = new Map([
    ['netscli-table: row-headers', 'table-row-headers'],
    ['netscli-table: plain-first-column', 'table-plain-first-column'],
  ]);

  const applyTableOptions = () => {
    const content = document.querySelector('.sl-markdown-content');
    if (!content) return;

    content.querySelectorAll('[data-netscli-table]').forEach((marker) => {
      const markerValue = marker.getAttribute('data-netscli-table')?.trim().toLowerCase();
      const option = tableOptionClasses.get(`netscli-table: ${markerValue}`);
      if (!option) return;

      tagNextTableElement(marker, option);
    });

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_COMMENT);
    let comment = walker.nextNode();
    while (comment) {
      const option = tableOptionClasses.get(comment.nodeValue?.trim().toLowerCase() ?? '');
      if (option) tagImmediatelyFollowingTable(comment, option);
      comment = walker.nextNode();
    }

    content.querySelectorAll('table').forEach((table) => {
      labelCellsWithTheirColumn(table);

      if (table.parentElement?.classList.contains('netscli-table-scroll')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'netscli-table-scroll';
      // The wrapper is the horizontally-scrollable region; make it reachable
      // by keyboard (axe scrollable-region-focusable) since the table inside
      // it isn't otherwise a focusable element.
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', 'Scrollable table');
      table.before(wrapper);
      wrapper.append(table);
    });
  };

  const scheduleTableOptions = () => {
    window.requestAnimationFrame(applyTableOptions);
  };


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleTableOptions, { once: true });
  } else {
    scheduleTableOptions();
  }
}
