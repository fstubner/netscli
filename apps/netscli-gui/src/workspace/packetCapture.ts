/**
 * Why packet capture cannot run, in words a user can act on.
 *
 * Two distinct causes with the same symptom: a build compiled without the
 * feature can never capture, while a build that has it still needs a capture
 * driver present. Saying "not available" for both sends half the people to
 * install a driver that will not help them.
 */
export function packetCaptureUnavailableMessage(message?: string | null): string {
  if (message?.includes("built without feature 'pcap'")) {
    return 'Packet Capture is not included in this build.';
  }
  return 'Packet Capture needs Npcap/libpcap before it can run.';
}
