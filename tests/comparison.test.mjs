import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../src/js/70-app-bar-services-dropdown-welcome-back-n.js', import.meta.url), 'utf8');
const start = source.indexOf('    // 2. Compare up to 3 properties');
const end = source.indexOf('    // 3. Recently viewed properties', start);
assert(start >= 0 && end > start, 'Comparison feature not found');
const feature = source.slice(start, end);

function setup(saved, listings) {
  const state = { stored: saved, html: '', toast: '', visible: false };
  const count = { textContent: '' };
  const bar = { classList: {
    toggle(_name, show) { state.visible = show; },
    remove() { state.visible = false; }
  } };
  const grid = {};
  const context = {
    store: { get: () => saved, set(_key, value) { state.stored = [...value]; return true; } },
    document: {
      body: { insertAdjacentHTML() {} },
      addEventListener(_type, fn) { state.click = fn; }
    },
    db: { loaded: false }, loadError: '',
    byId: (id) => listings.find((l) => l.id === id),
    isPublicListing: (l) => (l.channel || 'public') === 'public',
    $: (selector) => selector === '.cmp-bar' ? bar : selector === '[data-cmp-n]' ? count : selector === '#property-grid' ? grid : null,
    $$: () => [],
    MutationObserver: class { constructor(fn) { state.observe = fn; } observe() {} },
    toast: (message) => { state.toast = message; },
    esc: (value) => String(value),
    ppm: (l) => l.purpose === 'sale' ? l.price / l.size : 0,
    marlaOf: (l) => l.size,
    fmtPrice: (value) => String(value),
    vfIsVerified: () => false,
    mediaAttr: () => '',
    openModal: (html) => { state.html = html; return null; },
    closeModal() {},
    openDetails() {}
  };
  runInNewContext(feature, context);
  state.fire = (selector, data = {}) => state.click({
    target: { closest: (candidate) => candidate === selector ? { dataset: data } : null },
    preventDefault() {}, stopPropagation() {}
  });
  return { state, context, count };
}

const listing = (id, purpose, price, extra = {}) => ({
  id, purpose, price, title: id, status: 'published', type: 'House',
  role: 'Owner', area: 'Area', city: 'City', size: 5, sizeUnit: 'Marla', photos: [], ...extra
});

test('comparison survives initial loading and removes unavailable or private listings only after loading', () => {
  const app = setup(['sale', 'rent', 'private'], [
    listing('sale', 'sale', 5000000),
    listing('rent', 'rent', 50000),
    listing('private', 'sale', 4000000, { channel: 'private' })
  ]);
  app.state.observe();
  assert.deepEqual(app.state.stored, ['sale', 'rent', 'private']);
  app.context.db.loaded = true;
  app.state.observe();
  assert.deepEqual(app.state.stored, ['sale', 'rent']);
  assert.equal(app.count.textContent, 2);
  assert.equal(app.state.visible, true);
});

test('a failed listing load does not discard the saved comparison', () => {
  const app = setup(['sale', 'rent'], []);
  app.context.db.loaded = true;
  app.context.loadError = 'Database unavailable';
  app.state.observe();
  assert.deepEqual(app.state.stored, ['sale', 'rent']);
  assert.equal(app.state.visible, false);
});

test('mixed sale and rental prices are not ranked against each other', () => {
  const app = setup(['sale', 'rent'], [listing('sale', 'sale', 5000000), listing('rent', 'rent', 50000)]);
  app.context.db.loaded = true;
  app.state.observe();
  app.state.fire('[data-cmp-open]');
  assert.match(app.state.html, /Sale prices and monthly rents are not ranked against each other/);
  const priceRow = app.state.html.match(/<tr><th scope="row">Price<\/th>[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(priceRow, /cmp-best/);
  assert.match(priceRow, /50000 \/ month/);
});

test('comparable sale prices still highlight the lowest price', () => {
  const app = setup(['one', 'two'], [listing('one', 'sale', 5000000), listing('two', 'sale', 6000000)]);
  app.context.db.loaded = true;
  app.state.observe();
  app.state.fire('[data-cmp-open]');
  const priceRow = app.state.html.match(/<tr><th scope="row">Price<\/th>[\s\S]*?<\/tr>/)[0];
  assert.match(priceRow, /class="cmp-best">5000000/);
});
