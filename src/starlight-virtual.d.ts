// Ambient declarations for the Starlight virtual modules this site imports.
//
// Starlight builds these at runtime through a Vite plugin, so nothing on disk
// corresponds to them and TypeScript needs to be told they exist. The package
// has never declared the per-component ones, which is why they are all listed
// here.
//
// `user-config` used to be the exception: Starlight shipped a root
// `virtual.d.ts` that declared it. 0.42 moved every type under `dist/` and
// dropped that file, so the only remaining declaration is
// `dist/integrations/vite-virtual-modules.d.ts` -- internal typing for the
// plugin itself, not an ambient declaration a consumer picks up. The upgrade
// therefore broke `astro check` on the one import that had been relying on
// the package to declare it, and it now sits with its neighbours.
//
// `any` throughout, matching the components above and below: the alternative
// is importing Starlight's own config type out of `dist/utils/`, which is a
// path the package does not export and is free to move again.

declare module 'virtual:starlight/components/EditLink' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/components/LastUpdated' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/components/MobileTableOfContents' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/components/Pagination' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/components/Search' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/components/TableOfContents' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/components/ThemeSelect' {
  const component: any;
  export default component;
}

declare module 'virtual:starlight/user-config' {
  const config: any;
  export default config;
}
