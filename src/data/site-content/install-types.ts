// Types for the install-by-client layout, in their own file because types.ts
// has a 300-line guard.

/** What kind of tool a client is. Drawn as a neutral glyph beside its name:
 *  a terminal prompt or an editor window. Not a logo -- most vendors do not
 *  allow a third party to show theirs without asking. */
export type InstallClientKind = 'terminal' | 'editor';

/** Headings that number the two steps of the by-client layout: install the
 *  plugin (the grid), then the command every project runs (the first of
 *  `tryCommands`, shown as a card, with the rest as small links under it).
 *  Omit it and the layout keeps its unnumbered "Then" panel. */
export interface InstallSteps {
  install: string;
  after: string;
  /** One line under step 2's command, e.g. another way to do it. Plain text. */
  afterNote?: string;
  /** A third step, after setup: what to do next, in a sentence. The rest of
   *  `tryCommands` move under it as links. Omit it and they stay under step 2. */
  use?: { title: string; text: string };
  /** Step 2 as cards in the same style as step 1's, e.g. "ask your agent"
   *  and "run it yourself". When set they replace the command and note. */
  afterCards?: import('./types').InstallClient[];
  /** Further steps after step 2, each a heading over cards in the same
   *  style, numbered on from 3. For what some users do once, such as an
   *  optional add-on; say so in the label. */
  moreSteps?: { label: string; cards: import('./types').InstallClient[] }[];
}
