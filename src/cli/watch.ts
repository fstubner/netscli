import { loadCredentials } from "../sync/client.js";
import { RealtimeTranscriptWatcher } from "../sync/watcher.js";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function runWatch(options: { projectDir?: string }): Promise<void> {
  const projectDir = options.projectDir || process.cwd();
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error("❌ Not authenticated. Please run `xtctx login` first.");
    process.exit(1);
  }

  console.log(`\nStarting xtctx real-time memory streamer...`);
  console.log(`- User:   ${credentials.user.username}`);
  console.log(`- Device: ${credentials.deviceName}`);
  console.log(`- Server: ${credentials.syncUrl}`);
  console.log(`- Target: ${projectDir}\n`);

  const watcher = new RealtimeTranscriptWatcher({
    projectDir,
    credentials,
  });

  // 1. Check Antigravity transcripts
  const antigravityBrain = process.platform === "win32"
    ? join(homedir(), ".gemini", "antigravity", "brain")
    : join(homedir(), ".gemini", "antigravity", "brain");

  if (existsSync(antigravityBrain)) {
    try {
      const convs = await readdir(antigravityBrain);
      for (const conv of convs) {
        const transcriptPath = join(antigravityBrain, conv, ".system_generated", "logs", "transcript.jsonl");
        if (existsSync(transcriptPath)) {
          await watcher.watchTranscriptFile(transcriptPath, "antigravity", conv);
        }
      }
      console.log(`✓ Watching Antigravity active transcripts`);
    } catch {
      // Ignore
    }
  }

  // 2. Check Claude Code transcripts
  const claudeProjects = join(homedir(), ".claude", "projects");
  if (existsSync(claudeProjects)) {
    try {
      const dirs = await readdir(claudeProjects);
      for (const d of dirs) {
        const fullDir = join(claudeProjects, d);
        const files = await readdir(fullDir);
        for (const f of files) {
          if (f.endsWith(".jsonl")) {
            await watcher.watchTranscriptFile(join(fullDir, f), "claude-code", f.replace(/\.jsonl$/, ""));
          }
        }
      }
      console.log(`✓ Watching Claude Code active transcripts`);
    } catch {
      // Ignore
    }
  }

  console.log("\nListening for agent turns in real time. Press Ctrl+C to stop.\n");

  process.on("SIGINT", () => {
    watcher.close();
    console.log("\nStopped real-time streamer.");
    process.exit(0);
  });
}
