# RAQBO update: edit/delete listings, spam protection, admin alerts, legal pages

Do these once, in order.

## 1. Update the database (2 min)
Supabase → **SQL Editor → + New query**. Paste all of `supabase/update_2_edit_spam.sql` and click **Run**.
It should say *Success*.

This adds:
- Advertisers can **edit** their listings (edits go back to review and are hidden until approved) and **delete** them.
- Spam limits: 10 new listings per day, and 10 service requests or reports per hour, per account.
- Only signed-in, email-verified users can send service requests or reports.

(`supabase/schema.sql` already includes all of this for brand-new projects.)

## 2. Spam protection with Cloudflare Turnstile (10 min, free)
1. Go to **dash.cloudflare.com** (create a free account) → **Turnstile → Add widget**.
   - Name: RAQBO. Hostnames: `raqbo.pk` and `localhost`. Mode: **Managed**.
   - Copy the **Site Key** and the **Secret Key**.
2. Supabase → **Authentication → Attack Protection → Enable Captcha protection**. Choose **Turnstile** and paste the **Secret Key**. Click **Save**.
3. In `index.html`, find **RAQBO SETTINGS** and paste the **Site Key**:
   ```js
   turnstileSiteKey: '0x4AAAAAAA...',
   ```
Do steps 2 and 3 together. If only one is done, sign-in codes and the admin login will fail.

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
