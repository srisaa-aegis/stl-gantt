// Bundles demo/main.ts and the library into demo/gantt.js. Open demo/index.html afterwards.
const esbuild = require('esbuild');
esbuild.buildSync({ entryPoints: ['demo/main.ts'], bundle: true, format: 'iife', sourcemap: true, outfile: 'demo/gantt.js' });
console.log('demo/gantt.js built - open demo/index.html');
