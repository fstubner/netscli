import { defineEcConfig } from '@astrojs/starlight/expressive-code';

export default defineEcConfig({
  themes: ['github-dark-default', 'github-light-default'],
  styleOverrides: {
    borderRadius: '0.5rem',
  },
});
