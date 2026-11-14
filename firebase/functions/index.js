'use strict';

const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

admin.initializeApp();

const auth = getAuth();

exports.ensureSupabaseRole = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email address before accessing RAQBO account data.');
  }

  const user = await auth.getUser(request.auth.uid);
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    role: 'authenticated'
  });
  return { ok: true };
});
