// TypeScript 6 tightened side-effect imports and requires ambient
// declarations for non-TS modules imported for their side effects.
// Bundlers (Vite here) handle the actual CSS injection at build time;
// these declarations exist only to keep `tsc` happy.

declare module '*.css';
declare module '*.scss';
