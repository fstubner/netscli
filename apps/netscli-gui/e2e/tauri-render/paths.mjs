import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const e2eRoot = path.resolve(moduleDir, '..');
export const guiRoot = path.resolve(e2eRoot, '..');
export const repoRoot = path.resolve(guiRoot, '..', '..');
export const artifactsDir = path.join(e2eRoot, 'artifacts');
export const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
export const tauriDriverBin =
  process.env.TAURI_DRIVER ??
  path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');
