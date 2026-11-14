# RAQBO setup: Firebase Authentication + Supabase data

Firebase handles Google sign-in and email/password accounts with Firebase email-verification links. Supabase is used only for the marketplace database and listing media storage; Supabase Auth is not used. Phone-number sign-in and email OTP codes are not used.

The Firebase web configuration for project `raqbo-cff5e` is already in `index.html`. Web API keys are public identifiers; never add a Firebase service-account key or Supabase service-role key to the website.

## 1. Configure Firebase Authentication

In the [Firebase Console](https://console.firebase.google.com/project/raqbo-cff5e):

1. Open **Authentication → Sign-in method** and enable **Email/Password** and **Google**.
2. In **Authentication → Settings → Authorized domains**, add `localhost` and your production website hostname (for example, `raqbo.pk`).
3. Configure the email verification template under **Authentication → Templates** if you want to customize its sender or wording.
4. Google sign-in uses a redirect, so allow pop-ups/redirects and third-party sign-in for your website if your browser blocks them.

## 2. Connect Firebase identities to Supabase data

Supabase verifies Firebase ID tokens. A Firebase Function adds the required `role: "authenticated"` token claim after Firebase confirms the email. This does not create Supabase Auth users.

1. In Supabase, open **Authentication → Third-party Auth → Add provider → Firebase** and enter project ID `raqbo-cff5e`.
2. Firebase Cloud Functions require the **Blaze** plan. Link a Google Cloud billing account in Firebase **Usage and billing**. Firestore is not needed for this setup.
3. Install Node.js 22, then open PowerShell in the repository root and deploy the bridge:
   ```powershell
   npx firebase-tools login
   npx firebase-tools use raqbo-cff5e
   Set-Location firebase/functions
   npm install
   npx firebase-tools deploy --only functions:ensureSupabaseRole
   Set-Location ../..
   ```
   The function only grants the fixed `authenticated` claim to a signed-in user whose Firebase email is verified. RAQBO administrator access remains controlled by `profiles.role` in Supabase. Do not put SMTP passwords, Firebase service-account keys, or Supabase service-role keys in website files.

## 3. Apply the database schema

For an existing RAQBO database whose Firebase UID migration already succeeded, open **Supabase → SQL Editor** and run the updated `supabase/schema.sql`. Do not rerun `supabase/firebase_auth_migration.sql`; it is a one-time migration that preserves old records without linking them to Firebase users.

For a new empty database, run only `supabase/schema.sql`.

Do not run `supabase/reset_old_setup.sql` unless you intentionally want to delete existing RAQBO data.

## 4. Test

Run the website locally, for example:

```powershell
npx serve -l 5501
```

1. Create an account with name, email and password. Open Firebase's verification link, then return to RAQBO.
2. Sign in with email/password. A verified email is required.
3. Test Google sign-in. Google verifies the email as part of its sign-in flow.
4. After sign-in, save a favorite or start a listing to confirm Supabase accepts the Firebase token.

If Supabase returns an authorization/RLS error, verify the Firebase third-party integration and that `ensureSupabaseRole` is deployed.

## 5. Make a Firebase user an admin

Create and verify the staff account through Firebase email/password sign-in, and complete its RAQBO profile. Then run in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where email = 'staff@example.com';
```

Replace the email with the exact staff account email. Open the website with `#admin` and sign in using that verified Firebase email/password account.

## Troubleshooting

| Problem | Check |
|---|---|
| `auth/unauthorized-domain` | Add the current hostname under Firebase **Authentication → Settings → Authorized domains**. |
| `auth/operation-not-allowed` | Enable Email/Password and Google under Firebase **Authentication → Sign-in method**. |
| Email verification link does not return to RAQBO | Confirm the website hostname is authorized in Firebase and open the link in a browser where the site is accessible. |
| Firebase signs in, but listings/storage return an RLS error | Confirm Supabase Firebase third-party auth is configured, Blaze billing is enabled, and `ensureSupabaseRole` deployed successfully. Run the updated `schema.sql`. |
| New user cannot submit listings | Finish the RAQBO profile so the verified Firebase account has a `profiles` row with `verified = true`. |
