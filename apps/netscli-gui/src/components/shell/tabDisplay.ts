import type { WorkspaceTab } from '../../tools/types';

interface TabIdentity {
  identifier: string;
  label: string;
}

export function tabDisplayFor(_tab: WorkspaceTab, index: number, identities: TabIdentity[]) {
  const identity = identities[index];
  const duplicateCount = identities.filter(
    (item) => item.label === identity.label && item.identifier === identity.identifier,
  ).length;
  const identifier = !identity.identifier
    ? ''
    : identity.identifier === 'New'
      ? `#${index + 1}`
      : duplicateCount > 1
        ? `${identity.identifier} #${index + 1}`
        : identity.identifier;
  const tooltip = !identifier ? identity.label : `${identity.label}: ${identifier}`;

  return { identity, identifier, tooltip };
}
