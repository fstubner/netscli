/**
 * Copy-to-clipboard buttons for every `.has-copy` block and FAQ command row.
 *
 * Split out of `landing-page.ts` to keep that file under the 300-line
 * guard. It is a self-contained concern: it owns the button markup, the
 * copied/failed states, and — the fiddly part — deciding what a given block
 * should actually put on the clipboard.
 */
export function initCopyButtons(): void {
    document.querySelectorAll<HTMLElement>(".has-copy, .faq-command").forEach((el) => {
    if (el.querySelector(":scope > .copy-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy command");
    btn.title = "Copy command";
    const copyIcon = `
      <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
        <path d="M5.5 2.5h7v9h-7z"></path>
        <path d="M3.5 4.5h-1v9h7v-1"></path>
      </svg>
    `;
    const copiedIcon = `
      <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
        <path d="M3 8.2 6.1 11 13 4"></path>
      </svg>
    `;
    btn.innerHTML = copyIcon;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      let t = el.dataset.copy
        || el.querySelector("code")?.textContent?.trim()
        || el.textContent?.trim()
        || "";
      if (el.classList.contains("codeblock") || el.classList.contains("tryblock")) {
        // Copy the commands, not the sample output shown beneath them.
        //
        // Every non-empty line used to be kept, `$` stripped, and the lot
        // joined. On a block that shows a command and its output, that meant
        // a button labelled "Copy command" produced the command *plus* the
        // JSON it prints:
        //
        //     some-tool run --json
        //     [
        //       { "ok": true },
        //     ...
        //
        // Pasted into a shell that runs the scan, then tries to execute
        // `[`, `{ "port": 80… }` and `]`.
        //
        // So: if a block uses `$` prompts, those lines are the commands
        // and everything else is output — take only them. A block with no
        // prompts (the MCP config JSON) is content in its own right, so
        // copy it whole, dropping only `//` comment lines. Preserving
        // those lines verbatim also keeps the JSON's indentation, which
        // the old per-line `.trim()` flattened.
        const lines = t.split("\n");
        const prompted = lines.filter((line: string) => /^\s*\$\s+/.test(line));
        t = (prompted.length > 0
          ? prompted.map((line: string) => line.replace(/^\s*\$\s+/, "").trim())
          : lines.filter((line: string) => !/^\s*\/\//.test(line)).map((line: string) => line.replace(/\s+$/, ""))
        )
          .filter((line: string, i: number, all: string[]) => line.trim() !== "" || (i > 0 && i < all.length - 1))
          .join("\n")
          .trim();
      }
      navigator.clipboard.writeText(t).then(() => {
        btn.innerHTML = copiedIcon;
        btn.classList.add("copied");
        btn.setAttribute("aria-label", "Copied");
        btn.title = "Copied";
        setTimeout(() => {
          btn.innerHTML = copyIcon;
          btn.classList.remove("copied");
          btn.setAttribute("aria-label", "Copy command");
          btn.title = "Copy command";
        }, 2500);
      }).catch(() => {
        btn.setAttribute("aria-label", "Copy failed");
        btn.title = "Copy failed";
      });
    });
    el.appendChild(btn);
  });

}
