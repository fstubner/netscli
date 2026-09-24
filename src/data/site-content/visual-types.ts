// What a picture slot can hold, in one type, so that anything which shows a
// visual -- a surface card, the hero -- takes the same set of kinds and a new
// kind is added once. In its own file for the same reason as hero-types.ts:
// types.ts has a 300-line guard.
//
// Rendered by components/Visual.astro. A card or hero that sets `visual`
// shows it in place of its older `image` / `codeHtml` / `heroImage` fields,
// which keep working for sites that have not moved over.

/** A picture file. Give the intrinsic size so the browser reserves the space
 *  before the file arrives. */
export interface ImageVisual {
  kind: 'image';
  src: string;
  webp?: string;
  alt: string;
  width: number;
  height: number;
}

/** Pre-highlighted code, drawn on the code surface. The markup is yours;
 *  colour it with the `--ui-code-*` tokens so it follows the theme. */
export interface CodeVisual {
  kind: 'code';
  html: string;
  /** Accessible name for the scrollable region. Defaults to "Code example". */
  label?: string;
}

/** The terminal panel from terminal.ts, as rendered to an image by
 *  `npm run assets:terminal`. Width and height are what that script
 *  printed. */
export interface TerminalVisual {
  kind: 'terminal';
  alt: string;
  width: number;
  height: number;
}

/** A coding agent at work: a project's files, one file open, and the chat in
 *  which the agent calls tools and reads what they return. */
export interface AgentSessionVisual {
  kind: 'agent-session';
  session: AgentSession;
}

export type Visual = ImageVisual | CodeVisual | TerminalVisual | AgentSessionVisual;

export interface AgentSession {
  /** Centred in the window's title bar, e.g. the editor and project name. */
  title: string;
  /** Files in the explorer, as paths from the project root. Folders are
   *  derived from the paths and listed first, as an editor does. */
  files: string[];
  /** The file open in the editor. Its path should be one of `files`. */
  open: {
    path: string;
    /** The file's text, as it really is. Rendered as text, never as HTML. */
    text: string;
    /** Substrings to pick out in the accent colour wherever they appear --
     *  usually the names the chat goes on to use. */
    highlight?: string[];
  };
  /** Labels over the chat's two speakers. Default "You" and "Agent". */
  userLabel?: string;
  agentLabel?: string;
  turns: AgentTurn[];
}

/** One step of the chat, in order. A tool call sits under the agent message
 *  before it. */
export type AgentTurn =
  | { role: 'user'; text: string }
  | { role: 'agent'; text: string }
  | {
      role: 'tool';
      /** The call as the agent made it: `name(arg: "value")`. */
      call: string;
      /** What came back, one line each. Edit only by removing lines. */
      result: string[];
    };
