# RAQBO — Growth features (Founding Members, Refer & Earn, Rewards)

This update adds the client's growth plan to the website:

| Feature | Where people see it |
|---|---|
| Founding Members Club | Home page banner with a live "places left" counter; numbered badge in the account menu, on My RAQBO Rewards and next to the advertiser's name on property pages |
| Founding discount | My RAQBO Rewards → "Use my discount" (first eligible paid service; the RAQBO team applies it) |
| Refer & Earn | My RAQBO Rewards → personal invite link (copy / WhatsApp) and invite code |
| My RAQBO Rewards | Account menu, side menu, home banner, link `#rewards` |
| Offers for member types | My RAQBO Rewards → "Offers for you" (owner, buyer, tenant, developer, agent, legal professional, service provider, overseas Pakistani) |
| Property alerts | "Alert me" button above the property results; notification when a matching property is approved |
| Price-drop alerts | Automatic for saved properties when the price goes down |
| Property Wanted | Side menu, account menu, footer, link `#wanted`; owners with a matching property are notified and can message the poster |
| 7-day featured trial | My account → "Feature free for 7 days" on an approved property; featured properties show first with ★ FEATURED |
| Free guides | Side menu, footer, link `#guides`: 4 checklists and 3 sample documents |
| Admin → Growth & rewards | Approve rewards and credit requests, change every amount and limit, offers, pilot cities, budget, feature a property, hide Wanted posts |

## 1. Put it online

```
cd C:\Users\bombaytraders\Projects\raqbo-repo
git add .
git commit -m "Growth: Founding Members, Refer & Earn, Rewards, alerts, Property Wanted"
git push
```

## 2. Update the database

Supabase → SQL Editor → paste and run `supabase/update_11_growth.sql` (safe to run more than once).

- Existing verified members get Founding Member numbers in the order they joined.
- Every member gets an invite code.
- Until it is run, the website works normally and the banner and rewards stay hidden.

## 3. Settings to review with the client (Admin → Growth & rewards)

| Setting | Starts at |
|---|---|
| Founding places | 10,000 |
| Founding discount | 20%, up to Rs 500 |
| Credit per active invited member | Rs 100 |
| Credit per approved listing by an invited owner | Rs 300 |
| Admin approves each reward | On (recommended) |
| Rewards per member per month | 20 |
| Credit expiry | 180 days |
| Featured trial | 7 days, once per member |
| Pilot cities | Lahore (clear it to open all of Pakistan) |
| Campaign budget for credit | Rs 500,000 (rewards wait for review once reached) |

All amounts are the client's preliminary suggestions and can be changed any time without code changes.

## How rewards work

- **Active member reward:** paid to the inviter when the invited person has a verified account, has set a city inside the pilot, and has done something real (saved a property, sent a message, listed a property, posted a request, saved an alert or placed an order).
- **Owner reward:** paid when a property listed by an invited person is approved, once per invited person.
- **Using credit:** credit is not cash. A member asks to use credit or the founding discount for a named service. The admin applies the discount to that service or order, then presses **Applied**; the member is notified.
- **Fraud checks:** one reward per invited person, a monthly limit, a budget limit, admin approval, and invite codes only within 14 days of joining.

## Before the public launch

- Have the rewards terms (shown on the Rewards page) and the sample documents in Free guides reviewed by the legal team.
- Android app: the website already installs as an app. A Play Store listing (Trusted Web Activity) and an iPhone app are separate next steps.
- Communities/discussions and property news are the next phase; they need a moderation plan first.

# RAQBO Verified listings (update_12)

- **Free listing:** anyone can list free. Approved listings show an **Unverified** badge.
- **RAQBO Verified:** the owner opens My account → **Get RAQBO Verified**, uploads ownership documents (registry, fard, allotment/transfer letter, CNIC, bill), pays the verification fee (default **Rs 2,000**) into RAQBO's account and uploads the payment screenshot.
- The admin checks the payment and documents in **Admin → RAQBO Verified requests** and presses **Approve** or **Reject** with a reason. The owner is notified either way.
- Verified listings show **✓ RAQBO Verified** on the card and property page, come right after featured listings in the list, and buyers can tap **Verified only**.
- If the owner later changes the type, city, area or size, the badge is removed until RAQBO checks again (price changes keep it).
- Documents are stored privately (bucket `verification-docs`); only the owner and admins can open them.
- Fee and on/off: Admin → Growth & rewards → Campaign settings → RAQBO Verified listings.

**Setup:** run `supabase/update_12_verification.sql` in Supabase (after update_11). Until then no badges show.
