import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../src/js/16-core-upgrades-business-settings-property.js', import.meta.url), 'utf8');
const start = source.indexOf('  function requestPassportVerification(id)');
const end = source.indexOf('\n\n  // ---------- Home rails', start);
assert(start >= 0 && end > start, 'Passport request handler not found');
const handler = source.slice(start, end);

function setup(createEnquiry) {
  const listing = { id: 'listing-1', ref: 'R1', title: 'House', city: 'Lahore', status: 'published', channel: 'public' };
  const state = { errors: [], success: null, calls: [] };
  const form = {
    elements: { name: { value: 'Buyer' }, phone: { value: '03001234567' }, message: { value: 'Please check the documents.' } },
    addEventListener(type, fn) { if (type === 'submit') state.submit = fn; }
  };
  const card = {};
  const context = {
    closeModal() {},
    requireSignIn(next) { next(); },
    byId(id) { return id === listing.id ? listing : null; },
    isPublicListing(l) { return l.channel === 'public'; },
    toast(message) { state.toast = message; },
    openModal() { return card; },
    esc(value) { return String(value); },
    db: { session: { userId: 'buyer-1', name: 'Buyer', phone: '03001234567', email: 'buyer@example.invalid' } },
    $(selector) { return selector === 'form' ? form : {}; },
    normPhone(value) { return /^03\d{9}$/.test(value) ? value : ''; },
    PK_PHONE_HINT: 'Enter a valid phone number.',
    showErrors(_form, errors) { state.errors = errors; return errors.length > 0; },
    busy() { return () => {}; },
    backend: { async createEnquiry(enquiry) { state.calls.push(enquiry); return createEnquiry(enquiry); } },
    refreshAdmin() {},
    successHTML(title, body, ref) { return { title, body, ref }; },
    setBody(_card, value) { state.success = value; }
  };
  runInNewContext(handler + '\nrequestPassportVerification("listing-1");', context);
  return { state, form, listing, submit: () => state.submit({ preventDefault() {}, currentTarget: form }) };
}

test('passport request validates contact and handles persistence failures without success', async () => {
  const app = setup(async () => { throw new Error('Database unavailable'); });
  app.form.elements.phone.value = 'bad';
  await app.submit();
  assert.equal(app.state.calls.length, 0);
  assert.match(app.state.errors[0][1], /valid phone/);
  app.form.elements.phone.value = '03001234567';
  await app.submit();
  assert.match(app.state.errors[0][1], /Database unavailable/);
  assert.equal(app.state.success, null);
});

test('passport request tracks the public property and requester only after saving', async () => {
  const app = setup(async () => 'ENQ-1');
  await app.submit();
  const enquiry = app.state.calls[0];
  assert.equal(enquiry.property, 'R1');
  assert.equal(enquiry.service, 'verification');
  assert.equal(enquiry.userId, 'buyer-1');
  assert.equal(enquiry.via, null);
  assert.equal(app.state.success.ref, 'ENQ-1');
  app.listing.channel = 'investors';
  await app.submit();
  assert.equal(app.state.calls.length, 1);
  assert.match(app.state.errors[0][1], /no longer available/);
});
