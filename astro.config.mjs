// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://roger-egito.github.io',
  // Writes /games/hotel-77/index.html so the URL can be /games/hotel-77/.
  // GitHub Pages can't rewrite URLs, so the folders have to be real.
  build: { format: 'directory' },

  // Fonts get downloaded at build time and served from our own domain, so there's no
  // request to Google on page load and no flash of unstyled text.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Montserrat',
      cssVariable: '--font-heading',
      weights: [700],
    },
    {
      provider: fontProviders.google(),
      name: 'Lato',
      cssVariable: '--font-body',
      weights: [400, 700],
    },
  ],

  vite: {
    build: {
      rollupOptions: {
        output: {
          // Otherwise the CSS bundle gets named after whatever component happened to
          // import it first (Footer.<hash>.css), which is just confusing. Images keep
          // their own names so they stay recognizable in devtools.
          assetFileNames: (asset) =>
            (asset.names?.[0] ?? '').endsWith('.css')
              ? 'assets/styles.[hash][extname]'
              : 'assets/[name].[hash][extname]',
        },
      },
    },
  },
});
