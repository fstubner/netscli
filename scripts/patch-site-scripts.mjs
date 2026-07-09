import fs from 'node:fs';

const changelogReplacement = `<script define:vars={{ repo: social.repo, fallbackReleases, releaseSummaries }}>
    import { initChangelogPage } from '../scripts/changelog-page';
    initChangelogPage(repo, fallbackReleases, releaseSummaries);
  </script>`;

const changelogPath = 'site/src/pages/changelog.astro';
let changelog = fs.readFileSync(changelogPath, 'utf8');
changelog = changelog.replace(
  /<script is:inline define:vars=\{\{ repo: social\.repo, fallbackReleases, releaseSummaries \}\}>[\s\S]*?<\/script>/,
  changelogReplacement,
);
fs.writeFileSync(changelogPath, changelog);

const headerReplacement = `<script>
    import { initDocsHeader } from '../../scripts/docs-header';
    initDocsHeader();
  </script>`;

const headerPath = 'site/src/components/starlight/Header.astro';
let header = fs.readFileSync(headerPath, 'utf8');
header = header.replace(/<script is:inline>[\s\S]*?<\/script>/, headerReplacement);
fs.writeFileSync(headerPath, header);

console.log('patched changelog and header');
