import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { artifactsDir } from '../../paths.mjs';

export async function countExportArtifacts() {
  await fs.mkdir(artifactsDir, { recursive: true });
  const entries = await fs.readdir(artifactsDir);
  return entries.filter((file) => /^netscli-.*\.(csv|json)$/i.test(file)).length;
}

export async function assertExportArtifactsCreated(baseline) {
  const deadline = Date.now() + 5_000;
  let count = baseline;
  while (Date.now() < deadline) {
    count = await countExportArtifacts();
    if (count >= baseline + 2) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(count >= baseline + 2, `Expected JSON and CSV export artifacts, got ${count - baseline}`);
}
