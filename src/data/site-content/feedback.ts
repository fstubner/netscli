import type { Feedback } from './types';

// Where "was this useful?" goes. Issue links rather than a form: the site is
// static and stays that way, so a form would mean a backend, a third party or
// both -- inherited by every product cloned from this template. Issues land
// where the work already is, and the reporter can see what happened next.
//
// The cost is real and worth stating: a visitor without a GitHub account will
// not file one. That is the trade this makes deliberately -- fewer, better
// reports from people already close to the project, rather than more reports
// arriving somewhere nobody reads.
//
// `repo` defaults to `social.repo` in footer.ts; set it here only when
// feedback belongs somewhere else. Labels and templates are optional: a repo
// with no issue templates still gets working links, just without the
// prefilled body.
export const feedback: Feedback = {
  enabled: true,
  prompt: 'Something wrong, or missing?',
  repo: 'fstubner/xtctx',
  problem: {
    label: 'Report a problem',
    issueLabels: ['bug'],
  },
  idea: {
    label: 'Suggest something',
    issueLabels: ['enhancement'],
  },
};
