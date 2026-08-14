/** Shape used for both the GitHub Releases API response and the
 *  CHANGELOG.md-derived fallback releases — a loose subset since either
 *  source may omit fields the other provides (mergeRelease reconciles them). */
export interface ChangelogRelease {
  name?: string;
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  summary?: string;
}

export interface MarkdownLinkToken {
  label: string;
  href: string;
  end: number;
}

export interface BareUrlToken {
  href: string;
  label: string;
  suffix: string;
  end: number;
}

export interface PullRequestToken {
  href: string;
  label: string;
  end: number;
}

export interface ListItem {
  text: string;
  children: ListItem[];
}
