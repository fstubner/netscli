/** Where the hero's stars and download count come from. */
export interface SocialProof {
  /** GitHub repo in "owner/name" format. Used to fetch stars + download counts. */
  repo: string;
  /**
   * crates.io crate name, when the product is installable with `cargo install`.
   * Its all-time downloads are added to the GitHub release-asset total, because
   * a cargo install never touches a release asset and the label says "total".
   * Omit for a product that is not on crates.io: the fetch is then skipped and
   * the total comes from GitHub alone.
   *
   * Name only the crate people install. Library crates alongside it are
   * dependency resolution and docs.rs builds rather than installs, and counting
   * them reports one `cargo install` several times.
   */
  cratesIoCrate?: string;
  /**
   * npm package name, when the product installs with `npm` or `npx`. Its
   * all-time downloads are added to the total, for the same reason as
   * crates.io: an npm install never touches a release asset, so a product
   * shipped only through npm otherwise shows no download count at all.
   * npm counts every tarball fetch, CI and mirrors included. Omit for a
   * product that is not on npm, and nothing is fetched.
   */
  npmPackage?: string;
}
