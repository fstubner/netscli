# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.
Entries are written by the `release` workflow when a release is cut by hand.

## [0.21.8](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.7...xtctx-v0.21.8) (2026-08-31)

> **Not on npm.** 0.20.0 through 0.21.8 were tagged and given GitHub
> Releases, but none of them was ever published to npm — the last version
> published before them is 0.19.0. Everything listed from here down to 0.20.0
> reaches `npx -y xtctx` users only in the next version that is published.


### Bug Fixes

* **disconnect:** do nothing in a project that was never configured ([#292](https://github.com/fstubner/xtctx/issues/292)) ([748bb02](https://github.com/fstubner/xtctx/commit/748bb02592b6bff894ad456b671ff5744071cc61))
* **setup:** do not route xtctx through npx inside its own repo ([#290](https://github.com/fstubner/xtctx/issues/290)) ([fe9f58f](https://github.com/fstubner/xtctx/commit/fe9f58fc991bfd71404f21363b26a94a3589f861))

## [0.21.7](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.6...xtctx-v0.21.7) (2026-08-30)


### Documentation

* present the plugin as the entry point and setup as the upgrade ([#287](https://github.com/fstubner/xtctx/issues/287)) ([4cb456b](https://github.com/fstubner/xtctx/commit/4cb456bb16b95c773297697466d64fed3adfa188))

## [0.21.6](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.5...xtctx-v0.21.6) (2026-08-30)


### Bug Fixes

* **index:** repair session roll-ups a killed scan never reached ([#285](https://github.com/fstubner/xtctx/issues/285)) ([9fead69](https://github.com/fstubner/xtctx/commit/9fead69e2de827072f427a8702e6e7d2211e5d3c))

## [0.21.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.4...xtctx-v0.21.5) (2026-08-30)


### Bug Fixes

* **security:** close prototype pollution, write escape, and injection paths ([#283](https://github.com/fstubner/xtctx/issues/283)) ([fdcffc7](https://github.com/fstubner/xtctx/commit/fdcffc704baf3f3a73854c969c619084618f4891))

## [0.21.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.3...xtctx-v0.21.4) (2026-08-30)


### Dependencies

* bump astro from 7.2.3 to 7.2.7 in /landing ([#186](https://github.com/fstubner/xtctx/issues/186)) ([a6d2edf](https://github.com/fstubner/xtctx/commit/a6d2edf2f7970649667d7a7122b6c67bae3de4d5))

## [0.21.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.2...xtctx-v0.21.3) (2026-08-30)


### Bug Fixes

* **landing:** source hero version from package.json ([#280](https://github.com/fstubner/xtctx/issues/280)) ([7ff3f04](https://github.com/fstubner/xtctx/commit/7ff3f043cb5d34c93725f888151f2f4001dce837))

## [0.21.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.1...xtctx-v0.21.2) (2026-08-30)


### Performance

* go back to MiniLM, which indexes three times faster ([#278](https://github.com/fstubner/xtctx/issues/278)) ([b57f3a8](https://github.com/fstubner/xtctx/commit/b57f3a82981176672c1637a6fc61012c8ade97ee))

## [0.21.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.21.0...xtctx-v0.21.1) (2026-08-29)


### Performance

* cap how many segments one window contributes to its vector ([#276](https://github.com/fstubner/xtctx/issues/276)) ([7e2693b](https://github.com/fstubner/xtctx/commit/7e2693b0af761523d52e4a7ee2c88e61beb215e5))

## [0.21.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.20.5...xtctx-v0.21.0) (2026-08-29)


### Features

* report how long indexing takes and how much is left ([#275](https://github.com/fstubner/xtctx/issues/275)) ([ff26c53](https://github.com/fstubner/xtctx/commit/ff26c53fb434436dd32745a4840d6b3dfad8e0a5))


### Documentation

* describe how a handoff flows through the parts ([#271](https://github.com/fstubner/xtctx/issues/271)) ([9c1e3c1](https://github.com/fstubner/xtctx/commit/9c1e3c12d5de4165477ffad456e26dcd3283198d))

## [0.20.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.20.4...xtctx-v0.20.5) (2026-08-29)


### Bug Fixes

* stop hybrid search hiding everything not yet vectorized ([#272](https://github.com/fstubner/xtctx/issues/272)) ([c7bebed](https://github.com/fstubner/xtctx/commit/c7bebed4648b1efc3e8900718662e231314521a6))

## [0.20.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.20.3...xtctx-v0.20.4) (2026-08-29)


### Bug Fixes

* report when Antigravity serves brain artifacts instead of transcripts ([#269](https://github.com/fstubner/xtctx/issues/269)) ([8d9cf60](https://github.com/fstubner/xtctx/commit/8d9cf6030eb8f037dc5bc2bc9f87a44837fbd281))

## [0.20.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.20.2...xtctx-v0.20.3) (2026-08-29)


### Dependencies

* bump actions/github-script from 7.1.0 to 9.0.0 ([#183](https://github.com/fstubner/xtctx/issues/183)) ([d39cc50](https://github.com/fstubner/xtctx/commit/d39cc50f709783c6e48089f746c3663cd6ea14a4))

## [0.20.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.20.1...xtctx-v0.20.2) (2026-08-29)


### Dependencies

* bump actions/upload-pages-artifact from 3.0.1 to 5.0.0 ([#187](https://github.com/fstubner/xtctx/issues/187)) ([f5b6fb4](https://github.com/fstubner/xtctx/commit/f5b6fb4dd7a1026c1a24912df33df4931d5395e7))

## [0.20.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.20.0...xtctx-v0.20.1) (2026-08-29)


### Dependencies

* bump peter-evans/create-issue-from-file from 5.0.1 to 6.0.0 ([#185](https://github.com/fstubner/xtctx/issues/185)) ([9cd6d67](https://github.com/fstubner/xtctx/commit/9cd6d67c5c4410379b9516b8447998934d6b2116))

## [0.20.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.19.0...xtctx-v0.20.0) (2026-08-29)


### Features

* make the repo installable from git ([#255](https://github.com/fstubner/xtctx/issues/255)) ([0ea79bd](https://github.com/fstubner/xtctx/commit/0ea79bddab065d8929bac1e9d0efcf5292cfc738))
* publish the plugin through a marketplace ([#219](https://github.com/fstubner/xtctx/issues/219)) ([7c55fc9](https://github.com/fstubner/xtctx/commit/7c55fc971f80b1d37ee99049fb66d19c58b4f945))
* ship xtctx as an installable agent plugin ([#202](https://github.com/fstubner/xtctx/issues/202)) ([8fedc45](https://github.com/fstubner/xtctx/commit/8fedc455d0cddf4826b3fc149d5c064de5336010))


### Bug Fixes

* capture plan records instead of dropping them ([#246](https://github.com/fstubner/xtctx/issues/246)) ([138cc50](https://github.com/fstubner/xtctx/commit/138cc507b088ace94b31e610834dc628138fcdec))
* require a human to publish a release ([#201](https://github.com/fstubner/xtctx/issues/201)) ([bedf543](https://github.com/fstubner/xtctx/commit/bedf543eb810ca3e0b17efc10c8600562a8856e4))
* stop the release loop the draft gate created ([#265](https://github.com/fstubner/xtctx/issues/265)) ([3328e8a](https://github.com/fstubner/xtctx/commit/3328e8a01aae02a025577534efe95a2d8257a4f7))


### Tests

* exercise semantic search through the spawned MCP server ([#228](https://github.com/fstubner/xtctx/issues/228)) ([6e186c6](https://github.com/fstubner/xtctx/commit/6e186c6d4490b5a846d86adf7176a23b8523d46b))


### Miscellaneous

* An automated release pipeline cut 76 release commits between 0.18.7 and 0.74.0 in
  a few hours on 2026-08-29, none of which anyone asked for and none of which
  were published to npm. The version was reset to 0.20.0 the same day and the
  pipeline was replaced by a manually-triggered release; see the comments in
  `.github/workflows/release.yml`. The individual "release xtctx X.Y.Z"
  entries those runs generated are summarised here rather than listed, because
  a reader scanning this file for what shipped was being shown versions
  that never existed.


## [0.19.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.9...xtctx-v0.19.0) (2026-08-28)


### Features

* switch the embedding model to quantized mpnet ([#199](https://github.com/fstubner/xtctx/issues/199)) ([6214542](https://github.com/fstubner/xtctx/commit/62145425c675f8baed98af9d56ccb91759dfb5f9))

## [0.18.9](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.8...xtctx-v0.18.9) (2026-08-28)


### Bug Fixes

* retune the semantic confidence threshold against the eval ([#197](https://github.com/fstubner/xtctx/issues/197)) ([a75b7d9](https://github.com/fstubner/xtctx/commit/a75b7d931db7e0616780f465aba49460fd922450))

## [0.18.8](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.7...xtctx-v0.18.8) (2026-08-28)


### Bug Fixes

* decay keyword rank linearly instead of reciprocally ([#195](https://github.com/fstubner/xtctx/issues/195)) ([e84727b](https://github.com/fstubner/xtctx/commit/e84727b5037c6713dbb6e4a86981503254c884f1))

## [0.18.7](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.6...xtctx-v0.18.7) (2026-08-28)


### Tests

* **eval:** separate unanswerable queries from merely absent ones ([#192](https://github.com/fstubner/xtctx/issues/192)) ([d5cfd75](https://github.com/fstubner/xtctx/commit/d5cfd75b6574df229a831bca3870c8995cac320d))

## [0.18.6](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.5...xtctx-v0.18.6) (2026-08-27)


### Bug Fixes

* rebalance the hybrid blend, which ranked worse than keyword alone ([#191](https://github.com/fstubner/xtctx/issues/191)) ([efddbc3](https://github.com/fstubner/xtctx/commit/efddbc30cc510ebe6b2424da71aa1e387eaaa097))


### Tests

* **eval:** triple the ranking corpus and measure false positives ([#189](https://github.com/fstubner/xtctx/issues/189)) ([ba0b0fb](https://github.com/fstubner/xtctx/commit/ba0b0fbda1686ba932cd1aedb5b736353e8913dc))

## [0.18.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.4...xtctx-v0.18.5) (2026-08-27)


### Bug Fixes

* acceptance round 9 — a cross-project leak, and drift tests that tested nothing ([#182](https://github.com/fstubner/xtctx/issues/182)) ([8cb7392](https://github.com/fstubner/xtctx/commit/8cb7392b30ac13382c3de5a8d04e20e9cceb5439))

## [0.18.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.3...xtctx-v0.18.4) (2026-08-24)


### Bug Fixes

* stop an unreadable globalStorage failing the whole cursor scrape ([#180](https://github.com/fstubner/xtctx/issues/180)) ([9f066db](https://github.com/fstubner/xtctx/commit/9f066db22d6e6a47d700fa44f2b09fd4c669641a))

## [0.18.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.2...xtctx-v0.18.3) (2026-08-24)


### Bug Fixes

* acceptance round 8 — both new readers were inert against real data ([#178](https://github.com/fstubner/xtctx/issues/178)) ([72c95cc](https://github.com/fstubner/xtctx/commit/72c95ccddd99b38f13b3f08125dd158f41c32234))

## [0.18.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.1...xtctx-v0.18.2) (2026-08-24)


### Bug Fixes

* report a degraded antigravity scan instead of losing it silently ([#174](https://github.com/fstubner/xtctx/issues/174)) ([911ecad](https://github.com/fstubner/xtctx/commit/911ecadbabdc7899e5f6e5f2f0853f51ebd006e2))

## [0.18.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.18.0...xtctx-v0.18.1) (2026-08-24)


### Bug Fixes

* acceptance round 7 — all eight findings ([#171](https://github.com/fstubner/xtctx/issues/171)) ([bc828df](https://github.com/fstubner/xtctx/commit/bc828df0aad9e6b5249bbb5e578ee8483830f7c0))

## [0.18.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.17.0...xtctx-v0.18.0) (2026-08-23)


### Features

* extract ask-question, subagent and MCP steps from antigravity ([#169](https://github.com/fstubner/xtctx/issues/169)) ([0648fc3](https://github.com/fstubner/xtctx/commit/0648fc34c3be4d22a82296e02e39b922aeac2f86))

## [0.17.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.16.1...xtctx-v0.17.0) (2026-08-23)


### Features

* report format drift from the antigravity reader ([#167](https://github.com/fstubner/xtctx/issues/167)) ([5841e52](https://github.com/fstubner/xtctx/commit/5841e5215a0242f7058a7133082a394d1a408a33))

## [0.16.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.16.0...xtctx-v0.16.1) (2026-08-23)


### Bug Fixes

* acceptance round 6 — all nine findings ([#165](https://github.com/fstubner/xtctx/issues/165)) ([47710c5](https://github.com/fstubner/xtctx/commit/47710c5e476c1fb852d5e928303811f7c57dd0e7))

## [0.16.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.10...xtctx-v0.16.0) (2026-08-23)


### Features

* keep scraper drift warnings after the scan that found them ([#163](https://github.com/fstubner/xtctx/issues/163)) ([5c1ff09](https://github.com/fstubner/xtctx/commit/5c1ff095054239e05c00652b757681c119969fd3))

## [0.15.10](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.9...xtctx-v0.15.10) (2026-08-23)


### Miscellaneous

* ignore IMPLEMENTATION_PLAN.md ([#161](https://github.com/fstubner/xtctx/issues/161)) ([b40648e](https://github.com/fstubner/xtctx/commit/b40648e42aacd2a4141a4c86e15d20cbfb610c28))

## [0.15.9](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.8...xtctx-v0.15.9) (2026-08-23)


### Miscellaneous

* commit the .xtctx ignore file setup writes ([#159](https://github.com/fstubner/xtctx/issues/159)) ([9eb8452](https://github.com/fstubner/xtctx/commit/9eb84527df2c9b953b7c7d3b2352d7071e146a88))

## [0.15.8](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.7...xtctx-v0.15.8) (2026-08-23)


### Miscellaneous

* regenerate the managed handoff blocks ([#157](https://github.com/fstubner/xtctx/issues/157)) ([b44c3b8](https://github.com/fstubner/xtctx/commit/b44c3b87167325239410340d1f4f364b617d0300))

## [0.15.7](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.6...xtctx-v0.15.7) (2026-08-23)


### Bug Fixes

* acceptance round 5 — all five findings ([#155](https://github.com/fstubner/xtctx/issues/155)) ([93224a1](https://github.com/fstubner/xtctx/commit/93224a140c84549bddd3e2313ceef6e0e805cbd9))

## [0.15.6](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.5...xtctx-v0.15.6) (2026-08-23)


### Bug Fixes

* acceptance round 4 — all eight findings ([#153](https://github.com/fstubner/xtctx/issues/153)) ([d50afb7](https://github.com/fstubner/xtctx/commit/d50afb7d4a7da6361436b0ae110e09392745347d))

## [0.15.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.4...xtctx-v0.15.5) (2026-08-23)


### Bug Fixes

* **ci:** label the release-please pin with the version it actually is ([#151](https://github.com/fstubner/xtctx/issues/151)) ([1365c9d](https://github.com/fstubner/xtctx/commit/1365c9d04fcf692f3b38e301103811d380a6e2bf))

## [0.15.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.3...xtctx-v0.15.4) (2026-08-23)


### Dependencies

* **landing:** bump typescript to 7.0.2 ([#147](https://github.com/fstubner/xtctx/issues/147)) ([7671bfa](https://github.com/fstubner/xtctx/commit/7671bfa42dcbdda9388bd3810a14dd836a255901))

## [0.15.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.2...xtctx-v0.15.3) (2026-08-23)


### Dependencies

* take the dev-dependency updates that TypeScript 7 was blocking ([#146](https://github.com/fstubner/xtctx/issues/146)) ([bd99796](https://github.com/fstubner/xtctx/commit/bd99796370f644a09814209768131a6c25ff63ee))

## [0.15.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.1...xtctx-v0.15.2) (2026-08-23)


### Dependencies

* bump googleapis/release-please-action from 4.4.0 to 5.0.0 ([#86](https://github.com/fstubner/xtctx/issues/86)) ([0bbb125](https://github.com/fstubner/xtctx/commit/0bbb1253614a8499aef922aaa66c02f112596540))

## [0.15.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.15.0...xtctx-v0.15.1) (2026-08-23)


### Tests

* **drift:** check the smoke fixtures against the real formats ([#144](https://github.com/fstubner/xtctx/issues/144)) ([5f155c5](https://github.com/fstubner/xtctx/commit/5f155c51b272e90f4a805639555146f243c03b1a))

## [0.15.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.8...xtctx-v0.15.0) (2026-08-23)


### Features

* **ci:** typecheck the test tree ([#142](https://github.com/fstubner/xtctx/issues/142)) ([5afbb7b](https://github.com/fstubner/xtctx/commit/5afbb7b320336e105ec2dbfaf0a3c3e75edc2db0))

## [0.14.8](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.7...xtctx-v0.14.8) (2026-08-23)


### Bug Fixes

* acceptance round 3 — findings 7-9 ([#140](https://github.com/fstubner/xtctx/issues/140)) ([9befd83](https://github.com/fstubner/xtctx/commit/9befd836943054d941c8f55065fc08d00b1f3d30))

## [0.14.7](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.6...xtctx-v0.14.7) (2026-08-23)


### Miscellaneous

* **drift:** record new claude-code attachment and error fields ([#138](https://github.com/fstubner/xtctx/issues/138)) ([8b39a59](https://github.com/fstubner/xtctx/commit/8b39a5998421f8276a6b8b0f7a3530609e5a6d73))

## [0.14.6](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.5...xtctx-v0.14.6) (2026-08-23)


### Bug Fixes

* **drift:** stop the fingerprint reporting the sample as a change ([#136](https://github.com/fstubner/xtctx/issues/136)) ([c1cae16](https://github.com/fstubner/xtctx/commit/c1cae16c705b6f544d7933f6d089663a99508e92))

## [0.14.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.4...xtctx-v0.14.5) (2026-08-23)


### Bug Fixes

* **scrapers:** recognise three more bookkeeping record types ([#134](https://github.com/fstubner/xtctx/issues/134)) ([564976b](https://github.com/fstubner/xtctx/commit/564976b4de96795d5feff91ff440c2f1db9d4b3d))

## [0.14.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.3...xtctx-v0.14.4) (2026-08-23)


### Bug Fixes

* acceptance round 6 — findings 1-5 ([#132](https://github.com/fstubner/xtctx/issues/132)) ([87b6578](https://github.com/fstubner/xtctx/commit/87b6578912a08528ef38369025ed3109d495bc1a))

## [0.14.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.2...xtctx-v0.14.3) (2026-08-21)


### Bug Fixes

* acceptance round 5 — all nine findings ([#130](https://github.com/fstubner/xtctx/issues/130)) ([2f7ee53](https://github.com/fstubner/xtctx/commit/2f7ee534e244eb59c38014c0f6f259028ad08607))

## [0.14.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.1...xtctx-v0.14.2) (2026-08-21)


### Bug Fixes

* **claude-code:** treat atis-latch as bookkeeping, not drift ([#128](https://github.com/fstubner/xtctx/issues/128)) ([4ee257a](https://github.com/fstubner/xtctx/commit/4ee257a82358ef52be6c05a31cca754dc11aee50))

## [0.14.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.14.0...xtctx-v0.14.1) (2026-08-21)


### Performance

* **antigravity:** decide before fetching, not after ([#126](https://github.com/fstubner/xtctx/issues/126)) ([42c6bbf](https://github.com/fstubner/xtctx/commit/42c6bbf28be1840383c5d2d124c0959303212ea2))

## [0.14.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.13.1...xtctx-v0.14.0) (2026-08-21)


### Features

* git provenance and turn-0 context priming ([#123](https://github.com/fstubner/xtctx/issues/123)) ([2aa0536](https://github.com/fstubner/xtctx/commit/2aa053658b5d715fd4e30e80ad95d1f6690bbfe8))


### Bug Fixes

* acceptance round 4 — eight findings from the independent review ([#122](https://github.com/fstubner/xtctx/issues/122)) ([b8ef164](https://github.com/fstubner/xtctx/commit/b8ef164a35cf3142afdf05260f9edad75774f721))

## [0.13.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.13.0...xtctx-v0.13.1) (2026-08-20)


### Bug Fixes

* **antigravity:** read sessions from the migrated SQLite store ([#120](https://github.com/fstubner/xtctx/issues/120)) ([7e5c661](https://github.com/fstubner/xtctx/commit/7e5c6619aaae47a4495a979960792f0b0ea11517))

## [0.13.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.12.0...xtctx-v0.13.0) (2026-08-20)


### Features

* **drift:** fingerprint the Antigravity store layout ([#119](https://github.com/fstubner/xtctx/issues/119)) ([8f1541a](https://github.com/fstubner/xtctx/commit/8f1541a13e0089bf33bd0c6b99ac3668a85308f2))


### Bug Fixes

* opencode transcripts were invisible; harden format fingerprints ([#117](https://github.com/fstubner/xtctx/issues/117)) ([eb5305a](https://github.com/fstubner/xtctx/commit/eb5305a5251b69e4a383ab99546840cd7c45150b))

## [0.12.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.7...xtctx-v0.12.0) (2026-08-20)


### Features

* **drift:** watch upstream releases and fingerprint real formats, without API spend ([f6bc848](https://github.com/fstubner/xtctx/commit/f6bc848d8ad6d9842c4ce427bf7eef4f9230d6f9))
* **drift:** watch upstream releases and fingerprint real formats, without API spend ([994d111](https://github.com/fstubner/xtctx/commit/994d111e387374b7305add28ff8044da016a9dad))

## [0.11.7](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.6...xtctx-v0.11.7) (2026-08-20)


### Bug Fixes

* **canary:** distinguish "could not run" from "scraper is broken" ([3e5f13d](https://github.com/fstubner/xtctx/commit/3e5f13dd58d230397b79cec46c3c426444fb38cd))
* **canary:** distinguish "could not run" from "scraper is broken" ([406e6bf](https://github.com/fstubner/xtctx/commit/406e6bff1d5f89669419a5f58ab1f2e78e791524))
* **handoff:** rescale semantic scores per query so relevance outranks recency ([6a0a3a7](https://github.com/fstubner/xtctx/commit/6a0a3a7619379140899e5a53e2685cf790cd1b0f))
* **handoff:** rescale semantic scores per query so relevance outranks recency ([8452ffd](https://github.com/fstubner/xtctx/commit/8452ffd2891a788dddbdd809944d9c94eff1caae))

## [0.11.6](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.5...xtctx-v0.11.6) (2026-08-20)


### Tests

* add a retrieval ranking eval and a cross-tool pickup smoke ([7709330](https://github.com/fstubner/xtctx/commit/77093303c6c0f610fd72ff32da87aaaca9e98b80))
* add retrieval ranking eval and cross-tool pickup smoke ([1a006bd](https://github.com/fstubner/xtctx/commit/1a006bdf02b9a284be523a3b41f1138d29bf2160))
* **smoke:** canonicalise the sandbox root before seeding ([73a4600](https://github.com/fstubner/xtctx/commit/73a4600ff53308c8fb7e907c7f26610ae100dfac))

## [0.11.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.4...xtctx-v0.11.5) (2026-08-20)


### Dependencies

* update runtime and dev dependencies, holding back TypeScript 7 ([b347cfd](https://github.com/fstubner/xtctx/commit/b347cfd79073f90782d58a0e9ff500f1da349e3e))

## [0.11.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.3...xtctx-v0.11.4) (2026-08-20)


### Bug Fixes

* **ci:** smoke the published package outside the repo checkout ([93a5df6](https://github.com/fstubner/xtctx/commit/93a5df6037ff8192d3ad215381d2203f9a529cf8))
* **ci:** smoke the published package outside the repo checkout ([9843937](https://github.com/fstubner/xtctx/commit/98439370170a85bb1d8f1924a2b321b2d4739fa1))

## [0.11.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.2...xtctx-v0.11.3) (2026-08-20)


### Bug Fixes

* **ci:** enable auto-merge with the PAT so the release chain continues ([a057317](https://github.com/fstubner/xtctx/commit/a057317a9ecb4a7f6435989b13b328fdc9c35480))
* **demo:** keep embedding verification in-process, not through the spawned server ([4cc2365](https://github.com/fstubner/xtctx/commit/4cc236510e351aa5b12a7ccbe62f521f2ebecd14))
* **demo:** use the real path encoder instead of a drifted copy ([b261f60](https://github.com/fstubner/xtctx/commit/b261f609ca82559408a096b860c7fe8b5719c1d5))
* **runtime:** resolve the project root through symlinks ([8d48637](https://github.com/fstubner/xtctx/commit/8d486376a2509c2070482b6da5bf722bfb8cf132))


### Tests

* canonicalise temp roots and raise the suite timeout for CI runners ([eb9def3](https://github.com/fstubner/xtctx/commit/eb9def3446d90016441d5096efb5b346299074fe))

## [0.11.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.1...xtctx-v0.11.2) (2026-08-19)


### Bug Fixes

* **antigravity:** attribute conversations by path, never by project name ([9ba1ac7](https://github.com/fstubner/xtctx/commit/9ba1ac782c7c25caaaee4466c4f1bf65edee4ab6))
* **antigravity:** match the listening PID exactly and complete the barrel exports ([b9c3ad5](https://github.com/fstubner/xtctx/commit/b9c3ad5daea2cf370b1d425f02e851a2ec392a34))
* **ci:** check RELEASE_PLEASE_TOKEN in run, not in a step-level if ([ec736b7](https://github.com/fstubner/xtctx/commit/ec736b7cbd6f958c7910a0f9c3dcd69bae784541))
* **ci:** repair the release-please token guard ([52f6a73](https://github.com/fstubner/xtctx/commit/52f6a739f5211901fd6b398f155d68e3a61a7838))
* **cli:** fail open in the session hook and release the index handle ([b536cf1](https://github.com/fstubner/xtctx/commit/b536cf1fcb0cad74403ba6f55a3a38135a57467f))
* **config:** preserve line endings on disconnect and stop leaving litter ([6f800d2](https://github.com/fstubner/xtctx/commit/6f800d2dce99aa2413fb9ec8939979cc789c32b9))
* **config:** report disconnect accurately and remove the stubs it leaves ([9dfab9b](https://github.com/fstubner/xtctx/commit/9dfab9b4fbdb92fc2c628e7b555c75320f70ebfc))
* **config:** write other tools' config files safely ([6f48086](https://github.com/fstubner/xtctx/commit/6f480866fb79020cb1034709202b7d76f4779b13))
* **deps:** bump transitive postcss out of the path-traversal advisories ([51e3d58](https://github.com/fstubner/xtctx/commit/51e3d580bf6f9bc0fe76a60fe1c2019ff9feab3e))
* **handoff:** make the index crash-safe, correct, and cheap to refresh ([269fefb](https://github.com/fstubner/xtctx/commit/269fefbaa3a8b1cb491175fc2b2c69cea292c1f3))
* **handoff:** repair the embedding pipeline and stop it failing silently ([6ee6255](https://github.com/fstubner/xtctx/commit/6ee62551d55f2fd91af8a23282a52c380e3060f1))
* **handoff:** require real evidence for a semantic match ([7c4bf8b](https://github.com/fstubner/xtctx/commit/7c4bf8b8fd8379a3e75fd7b484437b89a70571d9))
* **handoff:** reset cursors whenever the index is empty, and stop indexing scaffolding ([0a1aa76](https://github.com/fstubner/xtctx/commit/0a1aa768dabb077f6ab898cf8627b8974de88d6e))
* **landing:** upgrade Astro to 7 and pin the published version ([73a20e9](https://github.com/fstubner/xtctx/commit/73a20e973f70ca8398a0ac967e0f32525a405c5a))
* **mcp:** fence untrusted transcript content and validate tool arguments ([a662805](https://github.com/fstubner/xtctx/commit/a662805bf65a521aac992233ea35aafbda202007))
* **mcp:** keep session previews from forging response structure ([799d7ff](https://github.com/fstubner/xtctx/commit/799d7ff1ba5c4417550350cbb810de9fe77f5c3c))
* **mcp:** redact paths in reported errors and always end status with a next step ([626e2bf](https://github.com/fstubner/xtctx/commit/626e2bf8f6837414b8ebd817bfa8513583d10367))
* **opencode:** report a corrupt store instead of an empty one ([83d8872](https://github.com/fstubner/xtctx/commit/83d88721857e1b47c3724b73b950df0e438ddb87))
* remediate the full-product audit findings ([5198690](https://github.com/fstubner/xtctx/commit/5198690a425399b94d6cd234e3b8ffa87e79c38c))
* **scrapers:** attribute Claude Code sessions by cwd, not by encoded name ([9b5a6ad](https://github.com/fstubner/xtctx/commit/9b5a6ada818464f28532677fb94e0e2a8f0fa400))
* **scrapers:** contain read errors and stabilise chunk identity ([31f5ecb](https://github.com/fstubner/xtctx/commit/31f5ecb9c0d7ff8bb4dec766c286ec315210690d))
* **scrapers:** parse current Copilot CLI events and scope sessions to the project ([6a387f8](https://github.com/fstubner/xtctx/commit/6a387f80679bec1ca5e472b98953bcdec82deaa5))
* stop reporting false drift and close the prefix-sibling leak ([6dc4e68](https://github.com/fstubner/xtctx/commit/6dc4e68a9c2bdea098df7dda1d165de2ac950943))


### Documentation

* add the product, architecture, and design contracts ([147d2af](https://github.com/fstubner/xtctx/commit/147d2aff4e8d5e9afbbe3936c33fa0886fe24548))
* correct the session-hook failure wording ([d31ac2f](https://github.com/fstubner/xtctx/commit/d31ac2f68ddb253e6debbdc745b05d43e15a5ef4))

## [0.11.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.11.0...xtctx-v0.11.1) (2026-08-05)


### Bug Fixes

* expect handoff_manifest in public demo smoke ([29de7b9](https://github.com/fstubner/xtctx/commit/29de7b9721a92354f3892762febb55042fbe2499))
* expect handoff_manifest in public demo smoke ([3041cc3](https://github.com/fstubner/xtctx/commit/3041cc39853c2935e838962c5a0b264c799fac53))

## [0.11.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.10.0...xtctx-v0.11.0) (2026-08-05)


### Features

* ship local handoff pivot (Antigravity-only Google support) ([#69](https://github.com/fstubner/xtctx/issues/69)) ([971d745](https://github.com/fstubner/xtctx/commit/971d7451ffbcf0628949822d238939f966b9da41))

## [0.10.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.9.1...xtctx-v0.10.0) (2026-05-07)


### Features

* **cli:** add `xtctx onboard` interactive first-run wizard ([#68](https://github.com/fstubner/xtctx/issues/68)) ([0ecae34](https://github.com/fstubner/xtctx/commit/0ecae343803df86dd98c8ecf76e6bc8d33836d9c))

## [0.9.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.9.0...xtctx-v0.9.1) (2026-05-02)


### Bug Fixes

* **canary:** drop shebang from drift-canary.mjs so the orchestrator test can import it ([45f14a4](https://github.com/fstubner/xtctx/commit/45f14a458f923fd43c95d1fa34aa1bf30e8c0d52))
* **canary:** drop shebang from drift-canary.mjs so the orchestrator test passes ([42eb566](https://github.com/fstubner/xtctx/commit/42eb566a5cf2e6672cc233b8680a2acd1b0d897b))

## [0.9.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.8.0...xtctx-v0.9.0) (2026-05-02)


### Features

* **scrapers:** add opencode and Copilot CLI scrapers ([99c464e](https://github.com/fstubner/xtctx/commit/99c464e818e6387c3ea95a29b9dbee0bda96689b))
* **scrapers:** add opencode and GitHub Copilot CLI scrapers ([7b93bcc](https://github.com/fstubner/xtctx/commit/7b93bccaf9b6290ae3735bf151cf41a819a38bc3))

## [0.8.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.7.1...xtctx-v0.8.0) (2026-05-02)


### Features

* **mcp:** pluggable format adapters + native MCP rendering for all 7 tools ([c16abdf](https://github.com/fstubner/xtctx/commit/c16abdf0124a6a5d10c0bafcd760f0d6ec00bd86))
* **mcp:** pluggable format adapters + native MCP rendering for all 7 tools ([7e08c07](https://github.com/fstubner/xtctx/commit/7e08c07894d5b7d40b9623f8faf3de6890a6fb87))

## [0.7.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.7.0...xtctx-v0.7.1) (2026-04-27)


### Miscellaneous

* **web:** drop runtime SPA in favor of CLI-only introspection ([b07b379](https://github.com/fstubner/xtctx/commit/b07b379b0a05fda2310f95ac6c95f9018d570c6a))
* **web:** drop runtime SPA in favor of CLI-only introspection ([a06f17b](https://github.com/fstubner/xtctx/commit/a06f17bbf335a98038940308f46655535b98471a))

## [0.7.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.6.0...xtctx-v0.7.0) (2026-04-26)


### Features

* **landing:** replace Vite+Vue landing with Astro 5 site adopted from netscli ([a6eb335](https://github.com/fstubner/xtctx/commit/a6eb335c3bb2e10166447a41692f699f5625943b))
* **landing:** replace Vite+Vue landing with Astro 5 site adopted from netscli ([6a75bd0](https://github.com/fstubner/xtctx/commit/6a75bd022d50077a289fbf358335452117565151))

## [0.6.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.5.0...xtctx-v0.6.0) (2026-04-21)


### Features

* **compact:** index compacted sessions into hybrid search (M2) ([63fdc44](https://github.com/fstubner/xtctx/commit/63fdc445935e81a9b26ec5662aff44d35efbb0c9))
* **compact:** index compacted sessions into hybrid search (M2) ([7cfe4cf](https://github.com/fstubner/xtctx/commit/7cfe4cf826a7f0356b313380d9911ff01b0623d8))

## [0.5.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.6...xtctx-v0.5.0) (2026-04-21)


### Features

* **canary:** nightly drift check against real Claude Code / Codex / Gemini CLIs ([9edbdcb](https://github.com/fstubner/xtctx/commit/9edbdcba2f6f1545a87c82d7930d462b5cf81daa))


### Bug Fixes

* **scrapers:** platform-gate Cursor default path (same P1 class as Copilot) ([4d62948](https://github.com/fstubner/xtctx/commit/4d6294832f432a406a1b51f02c5fb5a1a492e576))

## [0.4.6](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.5...xtctx-v0.4.6) (2026-04-21)


### Miscellaneous

* **deps:** resolve all 33 Dependabot vulnerabilities (1 critical, 11 high, 21 moderate) ([a510727](https://github.com/fstubner/xtctx/commit/a510727d8cdc1566e319553c107bbbdd0dd47a1e))
* **deps:** resolve all 33 Dependabot vulnerabilities (1 critical, 11 high, 21 moderate) ([c306644](https://github.com/fstubner/xtctx/commit/c30664478227808d567a042c5fc35a1d831865c9))

## [0.4.5](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.4...xtctx-v0.4.5) (2026-04-21)


### Bug Fixes

* **scrapers:** close drift gaps + 3 Copilot bugs — graceful-degradation whitelists, Linux path, incremental scrape, chunk-ID collision ([50c9bfd](https://github.com/fstubner/xtctx/commit/50c9bfdafb718c42907ee7a8e1ac253c0f8a3676))
* **scrapers:** close drift gaps with graceful-degradation whitelists + fix three Copilot bugs ([c352b8f](https://github.com/fstubner/xtctx/commit/c352b8f9fc034601bcbee9b7e90db2bf99a2ea31))

## [0.4.4](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.3...xtctx-v0.4.4) (2026-04-21)


### Bug Fixes

* **config:** gracefully degrade on legacy shared.yaml instead of throwing ([650c4b8](https://github.com/fstubner/xtctx/commit/650c4b831ee641276cbf4726888fed8d30d93ba9))
* **config:** gracefully degrade on legacy shared.yaml instead of throwing ([eded78a](https://github.com/fstubner/xtctx/commit/eded78aeb7980c9ca2ea21dd18751f231ac9d6ab))

## [0.4.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.2...xtctx-v0.4.3) (2026-04-21)


### Miscellaneous

* testing rigor — ranking eval, drift mutations, golden snapshots, bench stub ([689e497](https://github.com/fstubner/xtctx/commit/689e497e80cecd2d9e5b418a873b33521f4dfee6))
* testing rigor — ranking eval, drift mutations, golden snapshots, bench stub ([1f4e23c](https://github.com/fstubner/xtctx/commit/1f4e23c78cd5094052111d8da0ff1b126c8d85d4))

## [0.4.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.1...xtctx-v0.4.2) (2026-04-21)


### Miscellaneous

* sweeping cleanup — cross-tool smoke suite, package-info fix, dead-code removal ([be471bb](https://github.com/fstubner/xtctx/commit/be471bbafb6412241ea82f5c3053eace9007f876))
* sweeping cleanup — cross-tool smoke suite, package-info fix, dead-code removal ([4889d9d](https://github.com/fstubner/xtctx/commit/4889d9d0581ec24c97d2cfdc2534248a09efa638))

## [0.4.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.4.0...xtctx-v0.4.1) (2026-04-15)


### Bug Fixes

* MCP dedupe, ingest reliability, scratch gitignore ([#32](https://github.com/fstubner/xtctx/issues/32)) ([0b168ea](https://github.com/fstubner/xtctx/commit/0b168eadb6a756c69e406c707cfee94839c1125b))

## [0.4.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.3.3...xtctx-v0.4.0) (2026-04-14)


### Features

* full skill/MCP/hook handoff across all five coding tools ([#26](https://github.com/fstubner/xtctx/issues/26)) ([1026fec](https://github.com/fstubner/xtctx/commit/1026fec1c81e546ebacfe3e17c70ee32cb4977bf))

## [0.3.3](https://github.com/fstubner/xtctx/compare/xtctx-v0.3.2...xtctx-v0.3.3) (2026-02-26)


### Documentation

* clarify api token and github pages behavior ([c23f317](https://github.com/fstubner/xtctx/commit/c23f317deb666039b1b365a0150e61cc4dd6f5b6))
* clarify optional API token behavior ([d95575e](https://github.com/fstubner/xtctx/commit/d95575e6d707f5ce30d22ec0dff0a3657b4ff319))
* keep readme focused on api token behavior ([79b78f9](https://github.com/fstubner/xtctx/commit/79b78f9d2c8e65b8924cb10bdb6b3c4a959ca1ec))

## [0.3.2](https://github.com/fstubner/xtctx/compare/xtctx-v0.3.1...xtctx-v0.3.2) (2026-02-26)


### Documentation

* add root AGENTS guide for repository automation ([1439030](https://github.com/fstubner/xtctx/commit/1439030dfc458cf88f9a7e3abf7f925d678aa1ab))


### Miscellaneous

* deploy landing site to github pages ([6ddecd1](https://github.com/fstubner/xtctx/commit/6ddecd1828e6f3e2ba60200ba8a4dc659e629e73))
* deploy landing site to GitHub Pages ([4fbbfdc](https://github.com/fstubner/xtctx/commit/4fbbfdc1ffadd615e444ab865afa8196ee2f6466))

## [0.3.1](https://github.com/fstubner/xtctx/compare/xtctx-v0.3.0...xtctx-v0.3.1) (2026-02-26)


### Miscellaneous

* auto-enable merge for release-please prs ([8028118](https://github.com/fstubner/xtctx/commit/80281187525971817d238d8c6c93e67309e01d69))
* auto-enable merge for release-please PRs ([7c8535f](https://github.com/fstubner/xtctx/commit/7c8535ff7858111fa570bc528c457e29e99c5098))

## [0.3.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.2.0...xtctx-v0.3.0) (2026-02-26)


### Features

* make API security config file first and refresh README ([bac9c3b](https://github.com/fstubner/xtctx/commit/bac9c3bfa44e0b0c4a080f2fcf42550c1e21ef29))
* make API security config file first and refresh README ([8625dba](https://github.com/fstubner/xtctx/commit/8625dba6383cd416ae6d45790bfe67e5eac0eaad))

## [0.2.0](https://github.com/fstubner/xtctx/compare/xtctx-v0.1.0...xtctx-v0.2.0) (2026-02-25)


### Features

* add api security hardening and owasp checklist ([5660c52](https://github.com/fstubner/xtctx/commit/5660c52591cfcacd1611cfa914e31435d2747c80))
* add API server and Phase 9 Vue web UI ([775543e](https://github.com/fstubner/xtctx/commit/775543e93720c24786abbeb3089e0393eeffa904))
* add auto-tagging for file references and domain classification ([fc27a52](https://github.com/fstubner/xtctx/commit/fc27a52de6edad9cd1b29dd3ee6685d9eb3db4b5))
* add Claude Code conversation scraper ([ba01b58](https://github.com/fstubner/xtctx/commit/ba01b583bfe440e6c274024961dd3472908a923c))
* add CLI compaction provider ([e5f38f8](https://github.com/fstubner/xtctx/commit/e5f38f87a51d5352bf46e741694fa7a70933d8dd))
* add CLI entrypoints and MCP serve command ([866052c](https://github.com/fstubner/xtctx/commit/866052c79c5e2d85aa7f391dcb260e83cd765e5b))
* add core type definitions ([c8dba56](https://github.com/fstubner/xtctx/commit/c8dba5614b83c7521638da67d7c0e664fb4434d1))
* add deduplication with similarity-based supercession ([7023c92](https://github.com/fstubner/xtctx/commit/7023c920fa8b294e5cc9500a456748ecc5cc06bf))
* add hybrid search with reciprocal rank fusion ([830dbe7](https://github.com/fstubner/xtctx/commit/830dbe78ea30dd3c5679e1b9c998150861d57a93))
* add ingestion coordinator, watcher, and daemon ([92a4553](https://github.com/fstubner/xtctx/commit/92a455311683f28b1a4cbdfbef6a8662cbb04faa))
* add knowledge repository with YAML file persistence ([52c2e5c](https://github.com/fstubner/xtctx/commit/52c2e5cbf8100364a17036daad9e24dd090a38b6))
* add LanceDB vector store wrapper ([4f10d46](https://github.com/fstubner/xtctx/commit/4f10d463c48dc916fe5ad8ca1eb2bea73c736927))
* add local embedding service using MiniLM ([dc66f51](https://github.com/fstubner/xtctx/commit/dc66f51b48200b5fb6a42c42be246edd311b7464))
* add MCP server scaffold with all tool definitions ([fa3554f](https://github.com/fstubner/xtctx/commit/fa3554fa5f424448eb3cab339e6a6c23707cb21e))
* add phase 12 landing page ([791f535](https://github.com/fstubner/xtctx/commit/791f53561146f5858ea7de458b084e9d14d6ce5b))
* add phase 13 multi-tool scrapers ([f81c2fb](https://github.com/fstubner/xtctx/commit/f81c2fb2406a98e554ae2246cbd96ffdd4571a78))
* add rule-based compaction pipeline ([7e5d58d](https://github.com/fstubner/xtctx/commit/7e5d58d4fd86cb5eb777021a5e6943b86c07cee8))
* add scraper registry and state management ([9859e2d](https://github.com/fstubner/xtctx/commit/9859e2d49c1678c85e0d824cd87a372aeaae9f63))
* automate releases and bundle web ui in npm package ([3d6ecac](https://github.com/fstubner/xtctx/commit/3d6ecac4db0e88d594e6d5c4e17d9c245d74999b))
* implement MCP tool handlers ([71c6ab5](https://github.com/fstubner/xtctx/commit/71c6ab5f97dde0d0dc63759d4b7014adc0ef78f3))
* implement phase 10 config sync ([dc2661a](https://github.com/fstubner/xtctx/commit/dc2661a58af83f4fafaa008bf8f0b796631341da))
* implement phase 14 hardening and release tooling ([4590f38](https://github.com/fstubner/xtctx/commit/4590f38d26d6ad80fb4737cf721796df68fae307))
* wire ingestion runtime into serve and ingest commands ([89dd876](https://github.com/fstubner/xtctx/commit/89dd876cd8de12617220e7a2e1167dd4bce8c1b5))


### Bug Fixes

* allow release-please prs to trigger ci ([fc00a77](https://github.com/fstubner/xtctx/commit/fc00a77145dbecee8f1a4f80fa3f60b635647738))
* allow release-please PRs to trigger ci ([c398b12](https://github.com/fstubner/xtctx/commit/c398b12b9273baf13136c16ee7cadca6129a0d10))
* normalize npm package metadata ([c6cf81f](https://github.com/fstubner/xtctx/commit/c6cf81f45c737d59629b48e850a9c13b6b97566e))
* normalize npm package metadata ([5553c78](https://github.com/fstubner/xtctx/commit/5553c78f9cf65d4f90d72604b2608d9d5eef40b7))
* run ci for release-please branches ([97e5111](https://github.com/fstubner/xtctx/commit/97e5111ee098faaaa8dc4f31338183c3b5fb610a))
* run ci for release-please branches ([90bf917](https://github.com/fstubner/xtctx/commit/90bf9179d05fb103e52036c55648cde422317752))


### Documentation

* add open source governance and release docs ([a9e18f5](https://github.com/fstubner/xtctx/commit/a9e18f51c1c87c2a6d6da241a37d7bf28e058ea3))
* add phase 14 integration hardening follow-up ([56e7a6e](https://github.com/fstubner/xtctx/commit/56e7a6ee45c0e32fc48940cb319929224a657fb2))
* add xtctx usage skill guide ([e247258](https://github.com/fstubner/xtctx/commit/e247258de8284297af869a22fb44f1f897001d5b))


### Miscellaneous

* ignore codex local workspace directory ([33af3cb](https://github.com/fstubner/xtctx/commit/33af3cbb99f88a9666c0858922d7984fc18b2408))
* ignore runtime state directory ([3a8911d](https://github.com/fstubner/xtctx/commit/3a8911dca76787ef8f6724642a85474de566815e))

## [0.1.0] - 2026-02-25

### Added

- Core TypeScript project scaffold, tests, and CLI entrypoint.
- MCP server scaffold and tool handlers:
  - `xtctx_search`
  - `xtctx_recent_sessions`
  - `xtctx_session_detail`
  - `xtctx_project_knowledge`
  - `xtctx_save_*`
  - `xtctx_*_config` handlers
- Knowledge repository with autotagging and dedup/supersession behaviors.
- LanceDB-backed vector store + embedding service + hybrid search.
- Ingestion coordinator, watcher, daemon, and CLI ingestion commands.
- Rule-based compaction pipeline and external CLI compaction provider.
- API server and Vue web UI (dashboard/search/knowledge/sources/config pages).
- Config sync engine generating tool-native managed sections:
  - `.cursorrules`
  - `CLAUDE.md`
  - `AGENTS.md`
  - `.github/copilot-instructions.md`
- Additional scraper implementations:
  - Claude Code
  - Cursor (SQLite)
  - Codex CLI (JSONL)
  - GitHub Copilot (JSON)
  - Gemini CLI (JSON)
- Integration hardening:
  - Integration tests for MCP/API/web parity paths
  - Retry and coordinated shutdown utilities
  - CI workflow (Node 20/22)
  - Release verification scripts and packaging allowlist
  - Operator/runbook docs in `README.md`
