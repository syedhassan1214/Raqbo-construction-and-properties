import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('review contact guard checks the comment before saving', async () => {
  const saved = [];
  const backend = { async saveReview(...args) { saved.push(args); } };
  const storage = new Map();
  const context = {
    backend,
    LV: {},
    GW: {},
    db: { isAdmin: false, session: { name: 'Member' } },
    window: {},
    document: { addEventListener() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    }
  };
  const source = await readFile(new URL('../src/js/75-raqbo-contact-guard.js', import.meta.url), 'utf8');
  runInNewContext(source, context);

  await assert.rejects(() => backend.saveReview('listing-id', 5, 'Call me 0300 1234567', null), /phone number/);
  assert.equal(saved.length, 0);
  await backend.saveReview('listing-id', 5, 'A good property', null);
  assert.equal(saved.length, 1);
});
