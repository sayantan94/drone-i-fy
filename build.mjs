/* bundle the Three.js stage into a single static file (committed, so the
   Vercel deploy stays a plain static site + one function) */
import { build } from 'esbuild';

await build({
  entryPoints: ['stage-src/stage.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  outfile: 'js/stage.bundle.js',
  logLevel: 'info',
});
