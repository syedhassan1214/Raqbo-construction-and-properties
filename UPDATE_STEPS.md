# RAQBO update: Firebase authentication, spam protection, admin alerts, legal pages

Do these once, in order.

## 1. Set up Firebase Authentication and Supabase data
Follow `SETUP.md` in order. If the existing-database Firebase UID migration already succeeded, rerun only `supabase/schema.sql` to apply the optional profile-phone change. Run `supabase/firebase_auth_migration.sql` first only if you have not run it before.

Firebase handles Google sign-in or email/password with Firebase email-verification links. Phone sign-in and email OTP are removed. Follow `SETUP.md` to deploy the Firebase-to-Supabase bridge; Firestore and custom SMTP are not needed.

## 2. Spam protection
The database schema enforces per-account submission limits for listings, enquiries and reports.

## 3. Admin email alerts with n8n (10 min)
1. In n8n: **Workflows → Import from File** → `n8n/RAQBO_admin_alerts.n8n.json`.
2. Open the **Build alert** node and change `SECRET` to your own random text, e.g. `raqbo-7f3k9q2m`.
3. Open **Email admin (Gmail)** and connect your Gmail account. Alerts go to raqbo.official@gmail.com; change *To* if needed.
4. **Activate** the workflow, then copy the **Production URL** from the **Supabase webhook** node.
5. Supabase → **Database → Webhooks → Create a new hook**. Make 3 hooks:

| Name | Table | Events |
|---|---|---|
| raqbo_listings | listings | Insert, Update |
| raqbo_enquiries | enquiries | Insert |
| raqbo_reports | reports | Insert |

   For each one: Type **HTTP Request**, Method **POST**, URL = the n8n Production URL.
   Add two HTTP headers: `Content-Type: application/json` and `x-raqbo-secret: <the same secret as step 2>`.
6. Test: submit a listing or service request on the website. An email should arrive within seconds.

You'll get alerts for: new listings, listings edited by advertisers, service requests, and reports.
You won't get alerts for your own approvals or rejections.
For WhatsApp alerts, add a WhatsApp node after **Build alert** and send `{{ $json.text }}`. This needs a WhatsApp Business API account.

## 4. Privacy Policy & Terms pages
`privacy.html` and `terms.html` sit next to `index.html` and are linked from the footer and the sign-in screen.
- Read them and check every promise, such as **how long data is kept** (Privacy Policy section 7). Change anything RAQBO won't actually do.
- **Have a lawyer in Pakistan review both pages** before launch.
- Add `https://raqbo.pk/privacy.html` and `https://raqbo.pk/terms.html` to the Google OAuth consent screen (Google Cloud → Google Auth Platform → Branding).

## 5. Upload
Upload `index.html`, `privacy.html`, `terms.html` and the `icons` folder to your hosting, then push to GitHub (see the commands in the chat).
