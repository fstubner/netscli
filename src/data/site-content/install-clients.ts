import type { InstallClient } from './types';

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
