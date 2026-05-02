# Release process

netscli ships through five distribution channels. As of v0.2.1 every step
after "publish the GitHub release" is automated by
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml).

## One-time secret setup

Before the first automated release runs, add these secrets at
**GitHub → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it | Used by |
|--------|-----------------|---------|
| `CARGO_REGISTRY_TOKEN` | [crates.io → Account Settings → API Tokens](https://crates.io/settings/tokens) → "New Token" with `publish-update` scope (limit to `netscli-core`, `netscli-mcp`, `netscli` if you want least-privilege) | `crates-io` job |
| `HOMEBREW_TAP_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) → fine-grained or classic PAT with `Contents: Read & Write` on `fstubner/homebrew-tap` | `homebrew` job |
| `SCOOP_BUCKET_TOKEN` | Same shape as Homebrew but for `fstubner/scoop-bucket`. May reuse the same PAT if scoped widely. | `scoop` job |
| `WINGET_TOKEN` | Classic PAT with `public_repo` scope. The releaser action forks `microsoft/winget-pkgs` under your account and opens a PR — needs to write to your fork. | `winget` job |
| `AUR_SSH_PRIVATE_KEY` | The private half of the `~/.ssh/aur` key already registered with your AUR account (we generated this earlier). Paste the full file content (`-----BEGIN OPENSSH PRIVATE KEY-----` through `-----END OPENSSH PRIVATE KEY-----` inclusive). | `aur` job |

## The release flow

1. **Bump versions + CHANGELOG**, merge to main. (Already done for v0.2.1
   via [#30](https://github.com/fstubner/netscli/pull/30).)
2. **Tag and draft the release.** Either `gh release create vX.Y.Z --draft
   --generate-notes` or use the web UI's "Draft a new release" button.
3. **Promote the draft to public.** This is the one human action that
   stays in the loop.
   ```bash
   gh release edit vX.Y.Z --draft=false --repo fstubner/netscli
   ```
   This single event fires both `release.yml` (builds binaries + GUI
   installers, attaches them to the release) and `publish.yml` (fans out
   to package managers).
4. **Watch the dashboard.** From the release page or the Actions tab:
   - `Release` workflow: 13 CLI assets + 4 GUI installers attached.
   - `Publish to package managers` workflow: 5 jobs, one per channel.

   The `homebrew`, `scoop`, and `aur` jobs poll for asset availability
   (up to 15 minutes) so they tolerate the parallel race against
   `release.yml`.

5. **If something fails**, re-run just that job from the Actions tab —
   `workflow_dispatch` accepts a tag input so you can re-run a specific
   channel without rebuilding binaries or re-running the others.

## What still needs human attention

- **Winget moderator approval.** The action opens a PR to
  `microsoft/winget-pkgs`; a community moderator merges it within a few
  hours to days. CLA must be signed once per account (you've done this).
- **GUI-channel manifests** (Homebrew Cask, separate Winget GUI entry,
  Scoop extras, AUR `netscli-gui-bin`). These are CLI-only today; adding
  GUI-channel manifests is a separate setup PR that lands once the first
  GUI installer release is verified to work end-to-end (planned post-v0.2.1).

## Action pin policy

The two third-party actions used by this workflow are referenced by
version tag, not commit SHA:
- `vedantmgoyal2009/winget-releaser@v2`
- `KSXGitHub/github-actions-deploy-aur@v2.7.0`

These are stable, widely-used actions; pinning to SHA is on the radar
but not blocking. If you want stricter supply-chain hygiene, swap each
`@vN` for the matching `@<sha>` and let Dependabot bump them.
