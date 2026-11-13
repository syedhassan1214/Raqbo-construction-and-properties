// RAQBO build: joins src/ into the files the website serves.
//
//   src/index.html   page markup with two markers: <!-- @css --> and <!-- @js -->
//   src/css/*.css    styles, joined in file-name order
//   src/js/*.js      the app, joined in file-name order (all parts share one scope)
//
// Output: index.html + hashed app assets and on-demand feature modules.
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
const ur = readFileSync('src/i18n/ur.js', 'utf8');
const outUr = dev ? ur : (await transform(ur, { loader: 'js', minify: true, target: 'es2020', format: 'esm', legalComments: 'none' })).code;
const urName = `assets/ur.${hash(outUr)}.js`;
const oaAdmin = readFileSync('src/features/official-auctions-admin.js', 'utf8');
const outOaAdmin = dev ? oaAdmin : (await transform(oaAdmin, { loader: 'js', minify: true, target: 'es2020', format: 'esm', legalComments: 'none' })).code;
const oaAdminName = `assets/oa-admin.${hash(outOaAdmin)}.js`;
const jsSource = join('src/js', '.js');
if (jsSource.split('__RAQBO_UR_ASSET__').length !== 2) throw new Error('Expected exactly one Urdu asset marker');
if (jsSource.split('__RAQBO_OA_ADMIN_ASSET__').length !== 2) throw new Error('Expected exactly one auction admin asset marker');
const js = jsSource.replace('__RAQBO_UR_ASSET__', `/${urName}`).replace('__RAQBO_OA_ADMIN_ASSET__', `/${oaAdminName}`);

const outCss = dev ? css : (await transform(css, { loader: 'css', minify: true })).code;
const outJs = dev ? js : (await transform(js, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' })).code;

const cssName = `assets/app.${hash(outCss)}.css`;
const jsName = `assets/app.${hash(outJs)}.js`;

for (const f of readdirSync('assets')) {
  if (/^(?:app\.[0-9a-f]{10}\.(css|js)|(?:ur|oa-admin)\.[0-9a-f]{10}\.js)$/.test(f)) unlinkSync(`assets/${f}`);
}
writeFileSync(cssName, outCss);
writeFileSync(jsName, outJs);
writeFileSync(urName, outUr);
writeFileSync(oaAdminName, outOaAdmin);

const shell = readFileSync('src/index.html', 'utf8');
if (!shell.includes('<!-- @css -->') || !shell.includes('<!-- @js -->')) throw new Error('src/index.html is missing a marker');
writeFileSync('index.html', shell
  .replace('<!-- @css -->', `<link rel="stylesheet" href="/${cssName}">`)
  .replace('<!-- @js -->', `<script src="/${jsName}"></script>`));

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`index.html ${kb(readFileSync('index.html', 'utf8'))} · ${cssName} ${kb(outCss)} · ${jsName} ${kb(outJs)} · ${urName} ${kb(outUr)} · ${oaAdminName} ${kb(outOaAdmin)} (on demand)`);
