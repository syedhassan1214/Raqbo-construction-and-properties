# RAQBO setup: email code + Google sign-in (Supabase only)

Sign-in no longer uses SMS or Firebase.
- **Create account:** name, email and mobile number, then a code sent **by email**, then the account is created.
- **Google:** choose a Google account, then a code is emailed to that Gmail, then the user adds a mobile number and the account is created.
- **Sign in later:** email, then the emailed code.

You **don't need** Firebase, the Blaze plan, a card or the Cloud Function anymore. Everything runs on Supabase's free plan.

Files:
| File | What it is |
|---|---|
| `index.html` | The website, already connected to your Supabase project |
| `supabase/schema.sql` | Database setup |
| `supabase/reset_old_setup.sql` | Run once **only if** you already ran an older RAQBO `schema.sql` |

---

## Step 1: Database (5 min)
Supabase Dashboard → **SQL Editor → New query**.
1. **If you ran an earlier RAQBO schema.sql before:** paste `reset_old_setup.sql` and click **Run**.
2. Paste all of `schema.sql` and click **Run**. It should say *Success*.
3. If you added Firebase under **Authentication → Third-Party Auth**, you can delete it. It's no longer used.

## Step 2: Let Supabase send emails (custom SMTP), 10 min
Supabase's built-in email only sends to your own team's addresses, so customers won't get codes until you add an email sender.

**Easiest: use the RAQBO Gmail**
1. Sign in to **raqbo.official@gmail.com**, then go to **myaccount.google.com → Security** and turn on **2-Step Verification**.
2. In the same Security page, search for **App passwords**. Create one named "RAQBO Supabase" and copy the 16-letter password.
3. Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   - Sender email: `raqbo.official@gmail.com`, sender name: `RAQBO`
   - Host: `smtp.gmail.com`, port: `465`
   - Username: `raqbo.official@gmail.com`, password: the 16-letter app password
   - Click **Save**.
4. Go to **Authentication → Rate Limits** and raise *emails per hour* to, for example, `100`.

Gmail allows roughly 500 emails a day. For more, use a free email service such as Brevo or Resend and enter its SMTP details instead.

## Step 3: Put the code in the email (3 min)
Supabase → **Authentication → Emails → Templates**. Edit **both** "Magic Link" and "Confirm signup".

Subject: `Your RAQBO code: {{ .Token }}`

Body:
```html
<h2>Your RAQBO verification code</h2>
<p>Enter this code on the RAQBO website:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>This code expires soon. If you didn’t request it, you can ignore this email.</p>
<p>— RAQBO · Properties • Land • Investment · raqbo.pk</p>
```
Click **Save** on each template.

## Step 4: Google sign-in (10 min)
1. Go to **console.cloud.google.com**. Select a project; you can reuse **raqbo-cff5e** or create a new one.
2. **APIs & Services → OAuth consent screen** (shown as "Google Auth Platform" on newer screens):
   - App name **RAQBO**, support email **raqbo.official@gmail.com**, user type **External**.
   - When finished, click **Publish app** so anyone with a Google account can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins:** `http://localhost:5500` and `https://raqbo.pk`
   - **Authorized redirect URIs:** `https://usamujceckeghagaller.supabase.co/auth/v1/callback`
   - Click **Create** and copy the **Client ID** and **Client secret**.
4. Supabase → **Authentication → Sign In / Providers → Google** → enable it, paste the Client ID and secret, and click **Save**.
5. Supabase → **Authentication → URL Configuration**:
   - **Site URL:** `https://raqbo.pk` (use `http://localhost:5500` while testing)
   - **Redirect URLs:** add `http://localhost:5500/**` and `https://raqbo.pk/**`

## Step 5: Test on your PC
In Command Prompt:
```
cd /d C:\Users\bombaytraders\Projects\raqbo-repo
npx serve -l 5500
```
Open **http://localhost:5500/index.html**.
1. The sign-in screen appears. Choose **Create account** and enter your name, email and mobile number.
2. Check your email (and Spam) for the code, then enter it. You're now in the website.
3. Sign out from **My account**, then try **Continue with Google**. You'll get an emailed code, add your mobile number, and you're in.

## Step 6: Make yourself admin
1. Supabase → **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
2. **SQL Editor**, run (change the email):
   ```sql
   update public.profiles set role = 'admin', full_name = 'RAQBO Admin'
   where email = 'raqbo.official@gmail.com';
   ```
3. Open **http://localhost:5500/index.html#admin** and sign in with that email and password.

## Step 7: Go live
Upload `index.html` and the `icons` folder to your raqbo.pk hosting (or Netlify/Vercel). Check that Steps 4 and 5 list `https://raqbo.pk`.

## Troubleshooting
| Message | Fix |
|---|---|
| "Email sending is not set up yet" | Finish Step 2 (custom SMTP) |
| The email arrives without a code (just a link) | Finish Step 3 (templates with `{{ .Token }}`) |
| "Google sign-in is not enabled yet" | Finish Step 4, part 4 |
| Google shows `redirect_uri_mismatch` | Check the redirect URI in Step 4, part 3, character by character |
| Google returns to the wrong page | Add the address to the Redirect URLs in Step 4, part 5 |
| "Couldn't load properties" | Run `schema.sql` (Step 1) |
| "No account found with this email" | Use **Create account** first |
