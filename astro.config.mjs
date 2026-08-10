// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://roger-egito.github.io',
  // Writes /games/hotel-77/index.html so the URL can be /games/hotel-77/.
  // GitHub Pages can't rewrite URLs, so the folders have to be real.
  build: { format: 'directory' },

  vite: {
    build: {
      // Minifying CSS rounds long decimals to 6 digits, so the theme's
      // line-height: 1.764705882em becomes 1.76471 and text shifts by a fraction of
      // a pixel. Costs about 10 KB to leave off and keeps the layout exactly as it was.
      cssMinify: false,
      rollupOptions: {
        output: {
          // Otherwise the CSS bundle gets named after whatever component happened to
          // import it first (Footer.<hash>.css), which is just confusing.
          assetFileNames: 'assets/styles.[hash].css',
        },
      },
    },
  },
});
