import type { InstallClient } from './types';
import type { InstallSteps } from './install-types';

// Install routes grouped by the client they install into -- an editor, a
// coding agent, a plugin marketplace -- rather than by operating system.
//
// For a product whose install depends on which tool someone already uses
// rather than on their OS: a plugin for several agents, an extension for
// several editors. When this list has entries, the install section shows one
// card per client in place of the Windows / macOS / Linux tabs, and the "Try
// it" commands and binaries note follow underneath. Leave it empty and the
// section is the per-OS tabs from install.ts, as before.
//
// Give every client the product supports a card, including one with no
// command: a card that says "install from the Chat view" tells a reader the
// client is supported; a missing card tells them it is not.
export const installClients: InstallClient[] = [];

// Optional numbering for the layout above; has no effect while `installClients`
// is empty. When set, the grid is headed "1", the first of `tryCommands` in
// install.ts becomes step 2, and the section can take further steps. Leave it
// undefined for the unnumbered "Then" panel. Only `install` and `after` are
// required; install-types.ts says what each field does.
//
//   export const installSteps: InstallSteps = {
//     install: 'Once per editor: install the extension',
//     after: 'Once per project: set it up',
//     afterNote: 'Or ask your editor to do it.',   // plain text under step 2
//     use: { title: 'Use it', text: 'Open the command palette and run Example: Start.' },
//     // afterCards replaces step 2's single command with cards in step 1's style;
//     // moreSteps adds headed card groups numbered on from 3 (an optional add-on).
//   };
//
// Cards may also say who makes a client (`maker`) and what kind of tool it is
// (`kind`: 'terminal' or 'editor', drawn as a small glyph beside the name).
export const installSteps: InstallSteps | undefined = undefined;
