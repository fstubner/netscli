/**
 * Compile-time check that the hand-written types in netscli.ts still match
 * what netscli-core actually sends.
 *
 * netscli.ts is written by hand on purpose: it is looser than the core in
 * places (fields that older saved result bundles lack are optional there) and
 * it carries the documentation the desktop app's code reads. Its weakness was
 * that nothing tied it to the Rust structs, so a field added, renamed or
 * retyped in the core would reach the app as `undefined` with no error.
 *
 * `generated/` is written from the Rust structs by ts-rs
 * (`cargo test -p netscli-core --features ts,mdns export_bindings`, see
 * crates/netscli-core/Cargo.toml), and CI fails if it is out of date. This
 * file then fails `tsc` unless, for every type, the two declare the same
 * field names and every value the core can send is one netscli.ts accepts.
 */
import type { ArpEntry } from './generated/ArpEntry';
import type { DnsRecord } from './generated/DnsRecord';
import type { FoundBy } from './generated/FoundBy';
import type { Host } from './generated/Host';
import type { HttpHeader } from './generated/HttpHeader';
import type { HttpProbe } from './generated/HttpProbe';
import type { InspectResult } from './generated/InspectResult';
import type { InterfaceInfo } from './generated/InterfaceInfo';
import type { MdnsService } from './generated/MdnsService';
import type { NameSource } from './generated/NameSource';
import type { NetworkStats } from './generated/NetworkStats';
import type { OsHint } from './generated/OsHint';
import type { PcapPacketSummary } from './generated/PcapPacketSummary';
import type { PcapParseResult } from './generated/PcapParseResult';
import type { PcapResult } from './generated/PcapResult';
import type { PingResult } from './generated/PingResult';
import type { PingSummary } from './generated/PingSummary';
import type { PortResult } from './generated/PortResult';
import type { PortStatus } from './generated/PortStatus';
import type { Protocol } from './generated/Protocol';
import type { SweepEntry } from './generated/SweepEntry';
import type { TlsProbe } from './generated/TlsProbe';
import type { TraceResult } from './generated/TraceResult';
import type * as App from './netscli';

type Expect<T extends true> = T;
/** Neither side has a field the other lacks. */
type SameFields<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never]
  ? true
  : false;
/** Every value of `Sent` is a valid `Accepted`. */
type Accepts<Accepted, Sent> = [Sent] extends [Accepted] ? true : false;
type Matches<Accepted, Sent> = SameFields<Accepted, Sent> extends true ? Accepts<Accepted, Sent> : false;

export type CoreContract = [
  Expect<Accepts<App.FoundBy, FoundBy>>,
  Expect<Accepts<App.NameSource, NameSource>>,
  Expect<Accepts<App.PortStatus, PortStatus>>,
  Expect<Accepts<NonNullable<App.PortResult['protocol']>, Protocol>>,
  Expect<Matches<App.Host, Host>>,
  Expect<Matches<App.HttpHeader, HttpHeader>>,
  Expect<Matches<App.HttpProbe, HttpProbe>>,
  Expect<Matches<App.TlsProbe, TlsProbe>>,
  Expect<Matches<App.PortResult, PortResult>>,
  Expect<Matches<App.PingResult, PingResult>>,
  Expect<Matches<App.PingSummary, PingSummary>>,
  Expect<Matches<App.TraceResult, TraceResult>>,
  Expect<Matches<App.InspectResult, InspectResult>>,
  Expect<Matches<App.OsHint, OsHint>>,
  Expect<Matches<App.MdnsService, MdnsService>>,
  Expect<Matches<App.SweepEntry, SweepEntry>>,
  Expect<Matches<App.InterfaceInfo, InterfaceInfo>>,
  Expect<Matches<App.ArpEntry, ArpEntry>>,
  Expect<Matches<App.NetworkStats, NetworkStats>>,
  Expect<Matches<App.PcapPacketSummary, PcapPacketSummary>>,
  Expect<Matches<App.PcapResult, PcapResult>>,
  Expect<Matches<App.PcapParseResult, PcapParseResult>>,
  Expect<Matches<App.DnsRecord, DnsRecord>>,
];
