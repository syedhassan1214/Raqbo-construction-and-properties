// RAQBO build: joins src/ into the files the website serves.
//
//   src/index.html   page markup with two markers: <!-- @css --> and <!-- @js -->
//   src/css/*.css    styles, joined in file-name order
//   src/js/*.js      the app, joined in file-name order (all parts share one scope)
//
// Output: index.html + assets/app.<hash>.css + assets/app.<hash>.js (minified).
// The hash changes whenever the code changes, so browsers always get the new
// version but can keep the old one cached for 30 days in between.
//
// Run:  npm install   (once)   then   npm run bundle
// Edit files in src/, never the generated index.html or assets/app.*.

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

const join = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort()
  .map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const dev = process.argv.includes('--dev'); // --dev: skip minifying, easier to debug

const css = join('src/css', '.css');
const js = join('src/js', '.js');

const outCss = dev ? css : (await transform(css, { loader: 'css', minify: true })).code;
const outJs = dev ? js : (await transform(js, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' })).code;

const cssName = `assets/app.${hash(outCss)}.css`;
const jsName = `assets/app.${hash(outJs)}.js`;

for (const f of readdirSync('assets')) {
  if (/^app\.[0-9a-f]{10}\.(css|js)$/.test(f)) unlinkSync(`assets/${f}`);
}
writeFileSync(cssName, outCss);
writeFileSync(jsName, outJs);

const shell = readFileSync('src/index.html', 'utf8');
if (!shell.includes('<!-- @css -->') || !shell.includes('<!-- @js -->')) throw new Error('src/index.html is missing a marker');
writeFileSync('index.html', shell
  .replace('<!-- @css -->', `<link rel="stylesheet" href="/${cssName}">`)
  .replace('<!-- @js -->', `<script src="/${jsName}"></script>`));

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`index.html ${kb(readFileSync('index.html', 'utf8'))} · ${cssName} ${kb(outCss)} · ${jsName} ${kb(outJs)}`);
