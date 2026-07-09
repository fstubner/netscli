export type ChangelogRelease = Record<string, unknown>;

export function initChangelogPage(
  repo: string,
  fallbackReleases: ChangelogRelease[],
  releaseSummaries: Record<string, string>,
): void {
const year = document.getElementById("y");
    if (year) year.textContent = new Date().getFullYear();

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    function safeHref(href) {
      try {
        const url = new URL(href, window.location.origin);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    }

    function externalLink(href, label, className = "external-link") {
      const link = document.createElement("a");
      link.href = href;
      link.className = className;
      const text = document.createElement("span");
      text.className = "external-link-label";
      text.textContent = label;
      link.append(text);
      return link;
    }

    function readMarkdownLink(text, start) {
      if (text[start] !== "[") return null;
      let depth = 1;
      let cursor = start + 1;
      for (; cursor < text.length; cursor += 1) {
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
          cursor += 1;
          continue;
        }
        if (text[cursor] === "[") depth += 1;
        if (text[cursor] === "]") {
          depth -= 1;
          if (depth === 0) break;
        }
      }

      if (depth !== 0 || text[cursor + 1] !== "(") return null;

      let end = cursor + 2;
      let parens = 1;
      let href = "";
      for (; end < text.length; end += 1) {
        const char = text[end];
        if (char === "\\" && end + 1 < text.length) {
          href += text[end + 1];
          end += 1;
          continue;
        }
        if (char === "(") {
          parens += 1;
          href += char;
          continue;
        }
        if (char === ")") {
          parens -= 1;
          if (parens === 0) break;
          href += char;
          continue;
        }
        href += char;
      }

      if (parens !== 0) return null;

      return {
        label: text.slice(start + 1, cursor).replace(/\\([[\]\\()])/g, "$1"),
        href: href.trim().split(/\s+/)[0],
        end: end + 1,
      };
    }

    function readBareUrl(text, start) {
      const match = text.slice(start).match(/^https?:\/\/[^\s<]+/);
      if (!match) return null;
      let href = match[0];
      let suffix = "";
      while (/[.,;:!?)]$/.test(href)) {
        suffix = `${href.at(-1)}${suffix}`;
        href = href.slice(0, -1);
      }
      return { href, label: href, suffix, end: start + href.length + suffix.length };
    }

    function readPullRequestRef(text, start) {
      if (text[start] !== "#") return null;
      const previous = text[start - 1] || "";
      if (previous && !/[\s([,;:]/.test(previous)) return null;
      const match = text.slice(start).match(/^#(\d+)\b/);
      if (!match) return null;
      return {
        href: `https://github.com/${repo}/pull/${match[1]}`,
        label: match[0],
        end: start + match[0].length,
      };
    }

    function appendInline(parent, text) {
      let cursor = 0;
      let plain = "";
      const flush = () => {
        if (!plain) return;
        parent.append(document.createTextNode(plain));
        plain = "";
      };

      while (cursor < text.length) {
        if (text.startsWith("`", cursor)) {
          const end = text.indexOf("`", cursor + 1);
          if (end > cursor) {
            flush();
            parent.append(el("code", "", text.slice(cursor + 1, end)));
            cursor = end + 1;
            continue;
          }
        }

        if (text.startsWith("**", cursor)) {
          const end = text.indexOf("**", cursor + 2);
          if (end > cursor) {
            flush();
            const strong = el("strong", "");
            appendInline(strong, text.slice(cursor + 2, end));
            parent.append(strong);
            cursor = end + 2;
            continue;
          }
        }

        if (text[cursor] === "@" && text[cursor + 1] === "[") {
          const link = readMarkdownLink(text, cursor + 1);
          const href = link && safeHref(link.href);
          if (link && href) {
            flush();
            parent.append(externalLink(href, `@${link.label}`));
            cursor = link.end;
            continue;
          }
        }

        if (text[cursor] === "[") {
          const link = readMarkdownLink(text, cursor);
          const href = link && safeHref(link.href);
          if (link && href) {
            flush();
            parent.append(externalLink(href, link.label));
            cursor = link.end;
            continue;
          }
        }

        if (text[cursor] === "#") {
          const pr = readPullRequestRef(text, cursor);
          if (pr) {
            flush();
            parent.append(externalLink(pr.href, pr.label));
            cursor = pr.end;
            continue;
          }
        }

        if (text.startsWith("https://", cursor) || text.startsWith("http://", cursor)) {
          const url = readBareUrl(text, cursor);
          const href = url && safeHref(url.href);
          if (url && href) {
            flush();
            parent.append(externalLink(href, url.label));
            if (url.suffix) parent.append(document.createTextNode(url.suffix));
            cursor = url.end;
            continue;
          }
        }

        plain += text[cursor];
        cursor += 1;
      }

      flush();
    }

    function normalizeMarkdown(markdown) {
      return (markdown || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\r\n/g, "\n");
    }

    function normalizeTag(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      return text.startsWith("v") ? text : `v${text}`;
    }

    function releaseAnchorId(release) {
      return `release-${normalizeTag(release.tag_name || release.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`;
    }

    function formatList(items) {
      if (items.length <= 1) return items[0] || "";
      if (items.length === 2) return `${items[0]} and ${items[1]}`;
      return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
    }

    function isBodyBoundary(line) {
      return (
        line.startsWith("#") ||
        line.startsWith("```") ||
        line.startsWith(">") ||
        /^[-*]\s+/.test(line) ||
        /^\d+\.\s+/.test(line) ||
        /^[-\s]*full changelog:/i.test(line)
      );
    }

    function isGeneratedReleaseBoilerplate(line, release) {
      const text = line.trim();
      const normalized = text
        .replace(/^[-\s]+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!normalized) return true;
      if (normalized === "---") return true;
      if (normalized.startsWith("full changelog:")) return true;
      if (normalized.startsWith("what's new in ")) {
        const tag = normalizeTag(release?.tag_name || release?.name).toLowerCase();
        return !tag || normalized.includes(tag.replace(/^v/, ""));
      }
      return false;
    }

    function sectionLabel(heading) {
      const normalized = heading.toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").trim();
      if (normalized.startsWith("added")) return "additions";
      if (normalized.startsWith("fixed")) return "fixes";
      if (normalized.startsWith("security")) return "security updates";
      if (normalized.startsWith("changed internal")) return "internal changes";
      if (normalized.startsWith("changed")) return "changes";
      if (normalized.startsWith("removed")) return "removals";
      if (normalized.startsWith("notes")) return "release notes";
      return normalized || "updates";
    }

    function summarizeRelease(release, markdown) {
      const curated = release.summary || releaseSummaries[normalizeTag(release.tag_name || release.name)];
      if (curated) return curated;

      const tag = release.tag_name || release.name || "This release";
      const lines = normalizeMarkdown(markdown)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !isGeneratedReleaseBoilerplate(line, release));

      for (let index = 0; index < lines.length; index += 1) {
        if (isBodyBoundary(lines[index])) {
          continue;
        }

        const paragraph = [];
        while (index < lines.length && !isBodyBoundary(lines[index])) {
          paragraph.push(lines[index]);
          index += 1;
        }

        const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
        if (text) return text;
      }

      const bodyText = lines
        .filter((line) => !line.startsWith("```") && !/full changelog/i.test(line))
        .join(" ")
        .toLowerCase();
      const sections = lines
        .map((line) => line.match(/^###\s+(.+)$/)?.[1])
        .filter(Boolean)
        .map(sectionLabel);
      const categories = [
        [/feat|feature|add|new capability|capability/, "new capabilities"],
        [/fix|bug|repair|regression/, "fixes"],
        [/refactor|split|decompose|extract|rename/, "refactors"],
        [/doc|readme|site|changelog/, "documentation"],
        [/ci|workflow|runner|release/, "release workflow"],
        [/deps?|dependency|bump/, "dependency maintenance"],
      ]
        .filter(([pattern]) => pattern.test(bodyText))
        .map(([, label]) => label);
      const surfaces = [
        [/gui|desktop|tauri|react/, "desktop app"],
        [/\bcli\b|command|subcommand/, "CLI"],
        [/\btui\b|terminal/, "terminal UI"],
        [/\bmcp\b|agent/, "MCP server"],
        [/core|library|crate|rust/, "Rust core"],
        [/docs?|site|changelog/, "docs site"],
      ]
        .filter(([pattern]) => pattern.test(bodyText))
        .map(([, label]) => label);

      const focus = sections.length
        ? formatList([...new Set(sections)].slice(0, 3))
        : categories.length
          ? formatList([...new Set(categories)].slice(0, 3))
          : "project updates";
      const surfaceText = surfaces.length ? ` across ${formatList([...new Set(surfaces)].slice(0, 4))}` : "";
      return `${tag} includes ${focus}${surfaceText}.`;
    }

    function isDuplicateReleaseHeading(text, release) {
      const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/^#+\s*/, "")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/[.:]+$/, "");
      const heading = normalize(text);
      return [release.name, release.tag_name].some((value) => heading && heading === normalize(value));
    }

    function normalizeReleaseHeading(text) {
      const value = String(text || "").trim();
      if (/^notes(?:\s+on\s+v?\d+(?:\.\d+)*(?:\S*)?)?$/i.test(value)) return "Notes";
      return value;
    }

    function addParagraph(root, lines, transform) {
      const rawText = lines.join(" ");
      const text = (transform ? transform(rawText) : rawText).replace(/\s+/g, " ").trim();
      if (!text) return;
      const paragraph = el("p", "release-paragraph");
      appendInline(paragraph, text);
      root.append(paragraph);
    }

    function addList(root, items, ordered) {
      const list = document.createElement(ordered ? "ol" : "ul");
      list.className = "release-note-list";
      for (const entry of items) {
        const listItem = el("li", "");
        const text = typeof entry === "string" ? entry : entry.text;
        appendInline(listItem, text);
        if (typeof entry !== "string" && entry.children?.length) {
          addList(listItem, entry.children, false);
        }
        list.append(listItem);
      }
      root.append(list);
    }

    function listMarker(line, ordered) {
      const match = line.match(ordered ? /^(\s*)\d+\.\s+(.+)$/ : /^(\s*)[-*]\s+(.+)$/);
      return match ? { indent: match[1].length, text: match[2].trim() } : null;
    }

    function anyListMarker(line) {
      const unordered = listMarker(line, false);
      return unordered || listMarker(line, true);
    }

    function endsListBlock(line, release) {
      const trimmed = line.trim();
      return (
        !trimmed ||
        isGeneratedReleaseBoilerplate(trimmed, release) ||
        trimmed.startsWith("```") ||
        /^(#{1,4})\s+/.test(trimmed) ||
        trimmed.startsWith(">")
      );
    }

    function collectList(lines, start, ordered, release) {
      const first = listMarker(lines[start], ordered);
      const baseIndent = first?.indent ?? 0;
      const items = [];
      let current = null;
      let currentChild = null;
      let index = start;

      while (index < lines.length) {
        const raw = lines[index];
        const trimmed = raw.trim();
        if (endsListBlock(raw, release)) break;

        const marker = listMarker(raw, ordered);
        const nestedMarker = anyListMarker(raw);

        if (marker && marker.indent === baseIndent) {
          current = { text: marker.text, children: [] };
          currentChild = null;
          items.push(current);
          index += 1;
          continue;
        }

        if (nestedMarker && current && nestedMarker.indent > baseIndent) {
          currentChild = { text: nestedMarker.text, children: [] };
          current.children.push(currentChild);
          index += 1;
          continue;
        }

        if (nestedMarker && nestedMarker.indent <= baseIndent) break;

        if (currentChild && /^\s+/.test(raw)) {
          currentChild.text = `${currentChild.text} ${trimmed}`;
        } else if (current) {
          current.text = `${current.text} ${trimmed}`;
        } else {
          break;
        }
        index += 1;
      }

      return { items, nextIndex: index };
    }

    function renderMarkdown(markdown, release) {
      const root = el("div", "release-body");
      const summaryText = summarizeRelease(release, markdown);
      const summary = el("p", "release-summary");
      appendInline(summary, summaryText);
      root.append(summary);

      const lines = normalizeMarkdown(markdown).split("\n");
      let i = 0;
      let summaryPrefixConsumed = false;
      const trimSummaryPrefix = (text) => {
        if (summaryPrefixConsumed || !summaryText) return text;
        const normalized = text.replace(/\s+/g, " ").trim();
        if (!normalized.startsWith(summaryText)) return text;
        summaryPrefixConsumed = true;
        return normalized.slice(summaryText.length).trim();
      };

      while (i < lines.length) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("<!--") || isGeneratedReleaseBoilerplate(trimmed, release)) {
          i += 1;
          continue;
        }

        if (trimmed.startsWith("```")) {
          const lang = trimmed.replace(/^```/, "").trim();
          const code = [];
          i += 1;
          while (i < lines.length && !lines[i].trim().startsWith("```")) {
            code.push(lines[i]);
            i += 1;
          }
          i += 1;
          const pre = document.createElement("pre");
          pre.className = "release-code";
          const codeNode = document.createElement("code");
          codeNode.className = "release-code-content";
          if (lang) {
            pre.dataset.lang = lang;
            codeNode.dataset.lang = lang;
          }
          codeNode.textContent = code.join("\n");
          pre.append(codeNode);
          root.append(pre);
          continue;
        }

        const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
          if (isDuplicateReleaseHeading(heading[2], release)) {
            i += 1;
            continue;
          }
          const depth = Math.min(heading[1].length + 2, 5);
          const node = el(`h${depth}`, "release-heading");
          appendInline(node, normalizeReleaseHeading(heading[2]));
          root.append(node);
          i += 1;
          continue;
        }

        if (listMarker(raw, false)) {
          const block = collectList(lines, i, false, release);
          addList(root, block.items, false);
          i = block.nextIndex;
          continue;
        }

        if (listMarker(raw, true)) {
          const block = collectList(lines, i, true, release);
          addList(root, block.items, true);
          i = block.nextIndex;
          continue;
        }

        if (trimmed.startsWith(">")) {
          const quote = [];
          while (i < lines.length && lines[i].trim().startsWith(">")) {
            quote.push(lines[i].trim().replace(/^>\s?/, ""));
            i += 1;
          }
          const blockquote = el("blockquote", "release-quote");
          appendInline(blockquote, quote.join(" "));
          root.append(blockquote);
          continue;
        }

        const paragraph = [];
        while (
          i < lines.length &&
          lines[i].trim() &&
          !isGeneratedReleaseBoilerplate(lines[i].trim(), release) &&
          !lines[i].trim().startsWith("```") &&
          !/^(#{1,4})\s+/.test(lines[i].trim()) &&
          !/^[-*]\s+/.test(lines[i].trim()) &&
          !/^\d+\.\s+/.test(lines[i].trim()) &&
          !lines[i].trim().startsWith(">")
        ) {
          paragraph.push(lines[i].trim());
          i += 1;
        }
        addParagraph(root, paragraph, trimSummaryPrefix);
      }

      if (root.children.length === 1) {
        root.append(el("p", "release-paragraph", "No release notes were published for this release."));
      }

      return root;
    }

    const fallbackByTag = new Map(
      fallbackReleases.map((release) => [normalizeTag(release.tag_name || release.name), release]),
    );

    function mergeRelease(release) {
      const tag = normalizeTag(release.tag_name || release.name);
      const fallback = fallbackByTag.get(tag);
      return {
        ...(fallback || {}),
        ...release,
        tag_name: release.tag_name || fallback?.tag_name || tag,
        name: release.name || fallback?.name || tag,
        html_url: release.html_url || fallback?.html_url,
        published_at: release.published_at || fallback?.published_at,
        body: fallback?.body || release.body || "",
        summary: releaseSummaries[tag] || fallback?.summary || release.summary,
      };
    }

    function setupReleaseDisclosure(item, body, index) {
      const collapsedHeight = window.matchMedia("(max-width: 42rem)").matches ? 260 : 300;
      const minimumOverflow = 80;
      const bodyId = `release-body-${index}`;
      body.id = bodyId;

      requestAnimationFrame(() => {
        if (body.scrollHeight <= collapsedHeight + minimumOverflow) return;

        item.classList.add("release-collapsible");
        body.style.setProperty("--release-collapsed-height", `${collapsedHeight}px`);
        body.style.setProperty("--release-expanded-height", `${body.scrollHeight}px`);

        const disclosure = el("div", "release-disclosure");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "release-toggle";
        button.setAttribute("aria-controls", bodyId);
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "Show full release notes");
        button.textContent = "Show more";
        disclosure.append(button);
        item.append(disclosure);

        button.addEventListener("click", () => {
          const expanded = !item.classList.contains("release-expanded");
          body.style.setProperty("--release-expanded-height", `${body.scrollHeight}px`);
          item.classList.toggle("release-expanded", expanded);
          button.setAttribute("aria-expanded", String(expanded));
          button.setAttribute("aria-label", expanded ? "Collapse release notes" : "Show full release notes");
          button.textContent = expanded ? "Show less" : "Show more";
          if (!expanded) item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      });
    }

    function updateReleaseTimeline(releases) {
      const timeline = document.getElementById("release-timeline");
      if (!timeline || !Array.isArray(releases) || releases.length === 0) return;

      const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short" });
      const yearGroups = new Map();

      releases.forEach((release) => {
        const publishedDate = release.published_at ? new Date(release.published_at) : null;
        if (!publishedDate || Number.isNaN(publishedDate.getTime())) return;

        const yearLabel = String(publishedDate.getFullYear());
        const monthKey = `${yearLabel}-${String(publishedDate.getMonth() + 1).padStart(2, "0")}`;
        const monthLabel = monthFormat.format(publishedDate);
        const releaseId = releaseAnchorId(release);

        if (!yearGroups.has(yearLabel)) yearGroups.set(yearLabel, new Map());
        const months = yearGroups.get(yearLabel);
        if (!months.has(monthKey)) {
          months.set(monthKey, { label: monthLabel, count: 0, href: `#${releaseId}` });
        }
        months.get(monthKey).count += 1;
      });

      timeline.textContent = "";
      if (yearGroups.size === 0) {
        timeline.append(el("span", "release-timeline-empty", "No dates"));
        return;
      }

      yearGroups.forEach((months, yearLabel) => {
        const group = el("div", "release-timeline-group");
        group.append(el("strong", "release-timeline-year", yearLabel));

        months.forEach((month) => {
          const link = document.createElement("a");
          link.href = month.href;
          link.className = "release-timeline-link";
          link.dataset.releaseTarget = month.href.slice(1);
          link.innerHTML = `<span>${month.label}</span><small>${month.count}</small>`;
          group.append(link);
        });

        timeline.append(group);
      });

      const timelineLinks = [...timeline.querySelectorAll(".release-timeline-link")];
      const releaseItems = timelineLinks
        .map((link) => document.getElementById(link.dataset.releaseTarget))
        .filter(Boolean);

      if (!("IntersectionObserver" in window) || releaseItems.length === 0) return;

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (!visible) return;

          timelineLinks.forEach((link) => {
            link.classList.toggle("active", link.dataset.releaseTarget === visible.target.id);
          });
        },
        { rootMargin: "-18% 0px -62% 0px", threshold: [0.12, 0.35, 0.6] }
      );

      releaseItems.forEach((item) => observer.observe(item));
      timelineLinks[0]?.classList.add("active");
    }

    function renderReleaseList(releases) {
        const list = document.getElementById("release-list");
        if (!list || !Array.isArray(releases) || releases.length === 0) return false;
        list.textContent = "";
        const dateFormat = new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });

        for (const [index, sourceRelease] of releases.entries()) {
          const release = mergeRelease(sourceRelease);
          const item = document.createElement("article");
          item.className = "release-item";
          item.id = releaseAnchorId(release);

          const header = el("div", "release-head");
          const headingGroup = el("div", "release-title-group");
          const heading = document.createElement("h2");
          const releaseUrl = release.html_url || `https://github.com/${repo}/releases`;
          const link = externalLink(releaseUrl, release.name || release.tag_name || "Release");
          heading.appendChild(link);

          const meta = document.createElement("p");
          meta.className = "release-meta";
          const published = release.published_at
            ? dateFormat.format(new Date(release.published_at))
            : "";
          meta.textContent = published;
          headingGroup.append(heading);

          header.append(headingGroup);
          if (published) header.append(meta);

          const body = renderMarkdown(release.body || "", release);
          item.append(header, body);
          list.appendChild(item);
          setupReleaseDisclosure(item, body, index);
        }
        updateReleaseTimeline([...releases].map(mergeRelease));
        return true;
    }

    const renderedFallback = renderReleaseList(fallbackReleases);

    fetch(`https://api.github.com/repos/${repo}/releases?per_page=8`)
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub releases request failed with ${response.status}`);
        return response.json();
      })
      .then((releases) => {
        const remoteTags = new Set(releases.map((release) => normalizeTag(release.tag_name || release.name)));
        const localOnlyReleases = fallbackReleases.filter(
          (release) => !remoteTags.has(normalizeTag(release.tag_name || release.name)),
        );
        renderReleaseList([...localOnlyReleases, ...releases]);
      })
      .catch(() => {
        const list = document.getElementById("release-list");
        if (list && !renderedFallback) {
          list.innerHTML =
            '<div class="release-empty">Could not load releases from GitHub right now. Use the releases link above.</div>';
        }
      });
}
