import { open, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import { getCanonicalRepoId } from "./normalizer.js";
import { pushTurnDelta, type SyncCredentials } from "./client.js";

export interface TailerOptions {
  projectDir: string;
  credentials: SyncCredentials;
  pollIntervalMs?: number;
}

export interface WatchState {
  filePath: string;
  tool: string;
  sourceSessionId: string;
  offset: number;
  messageIndex: number;
}

/**
 * Lightweight real-time transcript file tailer.
 * Uses byte-offset tracking with shared read handles to avoid file locking.
 */
export class RealtimeTranscriptWatcher {
  private activeWatchers: FSWatcher[] = [];
  private fileOffsets = new Map<string, WatchState>();
  private isProcessing = false;

  constructor(private options: TailerOptions) {}

  /**
   * Tail a specific JSONL transcript file as turns are appended.
   */
  async watchTranscriptFile(filePath: string, tool: string, sourceSessionId: string): Promise<void> {
    try {
      const stats = await stat(filePath);
      // Start tailing from current end or 0
      this.fileOffsets.set(filePath, {
        filePath,
        tool,
        sourceSessionId,
        offset: stats.size, // tail from current moment onwards
        messageIndex: 0,
      });

      const watcher = watch(filePath, async (eventType) => {
        if (eventType === "change") {
          await this.handleFileChange(filePath);
        }
      });

      this.activeWatchers.push(watcher);
    } catch {
      // File might not exist yet; watcher can retry
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const state = this.fileOffsets.get(filePath);
      if (!state) return;

      const stats = await stat(filePath);
      if (stats.size <= state.offset) {
        if (stats.size < state.offset) {
          // File was truncated / recreated
          state.offset = 0;
          state.messageIndex = 0;
        } else {
          return;
        }
      }

      const bytesToRead = stats.size - state.offset;
      const buffer = Buffer.alloc(bytesToRead);

      const fileHandle = await open(filePath, "r");
      try {
        await fileHandle.read(buffer, 0, bytesToRead, state.offset);
      } finally {
        await fileHandle.close();
      }

      state.offset = stats.size;

      const text = buffer.toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);

      const { repoId, repoRoot } = await getCanonicalRepoId(this.options.projectDir);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          state.messageIndex += 1;

          const content = parsed.content || parsed.message || (typeof parsed === "string" ? parsed : JSON.stringify(parsed));
          const contentHash = createHash("sha256").update(content).digest("hex");

          await pushTurnDelta(this.options.credentials, {
            tool: state.tool,
            sourceSessionId: state.sourceSessionId,
            repoUrl: repoId,
            projectRoot: repoRoot,
            timestamp: parsed.created_at || new Date().toISOString(),
            role: parsed.role || (parsed.type === "USER_INPUT" ? "user" : "assistant"),
            content,
            messageIndex: state.messageIndex,
            contentHash,
            status: "active",
          });
        } catch {
          // Skip invalid JSON lines
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  close(): void {
    for (const w of this.activeWatchers) {
      try {
        w.close();
      } catch {
        // Ignore
      }
    }
    this.activeWatchers = [];
  }
}
