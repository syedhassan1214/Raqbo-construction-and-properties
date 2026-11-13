import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../src/js/10-live-features-notification-bell-messages.js', import.meta.url), 'utf8');
const start = source.indexOf('  function openInbox(convId, draft)');
const end = source.indexOf('\n  function closeInbox', start);
assert(start >= 0 && end > start, 'Inbox handler not found');

async function openWithDraft(initialValue, switchConversation = false) {
  const input = { value: initialValue };
  let pending;
  const context = {
    requireSignIn(next) { pending = next(); },
    closeModal() {}, closeNavMenus() {}, lvClosePanel() {}, lvWatchInbox() {},
    lvShell: () => ({}), document: { body: { classList: { add() {} } } },
    location: { hash: '#messages' }, history: { pushState() {} },
    lv: { conv: null, convs: [] },
    lvLoadConvs: async () => {},
    lvOpenThread: async (id) => { context.lv.conv = switchConversation ? 'other' : id; },
    $: (selector) => selector === '.lv-compose textarea' ? input : null
  };
  runInNewContext(source.slice(start, end) + '\nopenInbox("support", "Question about R1");', context);
  await pending;
  return input.value;
}

test('property support opens with an editable draft', async () => {
  assert.equal(await openWithDraft(''), 'Question about R1');
});

test('property draft does not overwrite typed text or a different conversation', async () => {
  assert.equal(await openWithDraft('Already typing'), 'Already typing');
  assert.equal(await openWithDraft('', true), '');
});
