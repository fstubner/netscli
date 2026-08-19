/** Shape used for both the GitHub Releases API response and the
 *  CHANGELOG.md-derived fallback releases — a loose subset since either
 *  source may omit fields the other provides (mergeRelease reconciles them). */
export interface ChangelogRelease {
  /** Set when nothing has confirmed a release exists under this tag, so its
   *  `html_url` may 404. Such an entry is never linked. */
  unreleased?: boolean;
  /** Set only once GitHub has answered and had no release under this tag --
   *  i.e. we know it is unreleased rather than merely not knowing yet. Only
   *  then is it labelled, so a real release is not mislabelled while the
   *  first paint waits for the fetch. */
  confirmedUnreleased?: boolean;
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
