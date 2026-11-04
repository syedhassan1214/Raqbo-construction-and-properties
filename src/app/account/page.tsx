"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

type AccountUser = { id: string; role: string; displayName?: string; email?: string | null };
type Listing = {
  id: string;
  title: string;
  description: string;
  city: string;
  locality: string;
  category: string;
  dealType: string;
  status: string;
  pricePkr: number;
  reviewNote?: string | null;
};
type Inquiry = {
  id: string;
  listing_title: string;
  other_party_name: string;
  message: string;
  status: string;
  created_at: string;
  direction: "sent" | "received";
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Request failed (${response.status}).`);
  return payload;
}

export default function AccountPage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [phone, setPhone] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");
  const [editing, setEditing] = useState("");

  const loadAccount = useCallback(async () => {
    const result = await request<{ user: AccountUser | null }>("/api/auth/me");
    setUser(result.user);
    if (result.user?.role === "owner" || result.user?.role === "buyer") {
      const inquiryResultPromise = request<{ inquiries: Inquiry[] }>("/api/me/inquiries");
      if (result.user.role === "owner") {
        const [listingResult, inquiryResult] = await Promise.all([
          request<{ listings: Listing[] }>("/api/me/listings"),
          inquiryResultPromise,
        ]);
        setListings(listingResult.listings);
        setInquiries(inquiryResult.inquiries);
      } else {
        const inquiryResult = await inquiryResultPromise;
        setListings([]);
        setInquiries(inquiryResult.inquiries);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    request<{ user: AccountUser | null }>("/api/auth/me")
      .then(async ({ user: current }) => {
        if (!active) return;
        setUser(current);
        if (current?.role === "owner" || current?.role === "buyer") {
          const inquiryPromise = request<{ inquiries: Inquiry[] }>("/api/me/inquiries");
          if (current.role === "owner") {
            const [listingResult, inquiryResult] = await Promise.all([
              request<{ listings: Listing[] }>("/api/me/listings"),
              inquiryPromise,
            ]);
            if (!active) return;
            setListings(listingResult.listings);
            setInquiries(inquiryResult.inquiries);
          } else {
            const inquiryResult = await inquiryPromise;
            if (!active) return;
            setInquiries(inquiryResult.inquiries);
          }
        }
        if (active) setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : "Could not load your account.");
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (!otpRequested) {
        const result = await request<{ developmentCode?: string; message?: string }>("/api/auth/otp/send", {
          method: "POST",
          body: JSON.stringify({ phone, consent: true }),
        });
        setOtpRequested(true);
        setDevelopmentCode(result.developmentCode ?? "");
        setNotice(result.developmentCode ? `Development verification code: ${result.developmentCode}` : result.message ?? "Verification code sent.");
      } else {
        const form = new FormData(event.currentTarget);
        await request("/api/auth/otp/verify", {
          method: "POST",
          body: JSON.stringify({ phone, code: String(form.get("code") ?? "") }),
        });
        setOtpRequested(false);
        setDevelopmentCode("");
        await loadAccount();
        setNotice("You are signed in.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not verify your phone.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    setBusy(true);
    setNotice("");
    try {
      await request(`/api/me/listings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadAccount();
      setNotice(`Listing marked ${status.replaceAll("_", " ")}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update listing status.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      await request(`/api/listings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          city: String(form.get("city") ?? ""),
          locality: String(form.get("locality") ?? ""),
          pricePkr: Number(form.get("pricePkr")),
        }),
      });
      setEditing("");
      await loadAccount();
      setNotice("Listing changes saved. Material changes to a live listing return it to staff review.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save listing changes.");
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion() {
    setBusy(true);
    setNotice("");
    try {
      const result = await request<{ message?: string }>("/api/me/delete-request", { method: "POST", body: "{}" });
      setUser(null);
      setListings([]);
      setInquiries([]);
      setNotice(result.message ?? "Account deletion request submitted for review.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit the deletion request.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
      setUser(null);
      setListings([]);
      setInquiries([]);
      setNotice("You have signed out.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-page">
      <header className="account-topbar">
        <Link className="brand" href="/"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>PROPERTY, WITH CLARITY</small></span></Link>
        <nav><Link href="/">Home</Link><Link href="/saved">Saved properties</Link></nav>
      </header>
      <section className="account-content">
        <div className="eyebrow"><span /> YOUR RAQBO ACCOUNT</div>
        <h1>My account</h1>
        {notice && <p className="account-message" role="status">{notice}</p>}
        {loading ? <p className="account-empty">Loading account…</p> : user ? <>
          <div className="account-profile"><div><b>{user.displayName || "RAQBO member"}</b><span>{user.role}</span></div><button disabled={busy} onClick={() => void signOut()}>Sign out</button></div>
          <div className="account-heading-row"><div><h2>My listings</h2><p>Track moderation, edit your details, or update availability.</p></div><Link className="button button-primary" href="/">Create a listing</Link></div>
          {user.role !== "owner" ? <div className="account-empty"><p>You do not have any property listings yet.</p><Link href="/">List a property</Link></div> : listings.length ? <div className="account-listings">
            {listings.map((listing) => <article className="account-listing account-listing-block" key={listing.id}>
              <div className="account-listing-body">
                <span>{listing.category} · {listing.dealType === "rent" ? "Rent" : "Sale"} · {listing.city}, {listing.locality}</span>
                <h2>{listing.title}</h2>
                <b>PKR {new Intl.NumberFormat("en-PK").format(listing.pricePkr)} · {listing.status.replaceAll("_", " ")}</b>
                {listing.reviewNote && <p className="review-feedback"><b>Staff feedback:</b> {listing.reviewNote}</p>}
                <div className="account-actions">
                  <button disabled={busy} onClick={() => setEditing(editing === listing.id ? "" : listing.id)}>{editing === listing.id ? "Cancel edit" : "Edit details"}</button>
                  {listing.status === "live" && <button disabled={busy} onClick={() => void changeStatus(listing.id, "paused")}>Pause</button>}
                  {listing.status === "paused" && <button disabled={busy} onClick={() => void changeStatus(listing.id, "live")}>Republish</button>}
                  {["live", "paused"].includes(listing.status) && <button disabled={busy} onClick={() => void changeStatus(listing.id, "under_offer")}>Mark under offer</button>}
                  {["live", "paused", "under_offer"].includes(listing.status) && <button disabled={busy} onClick={() => void changeStatus(listing.id, listing.dealType === "rent" ? "rented" : "sold")}>Mark {listing.dealType === "rent" ? "rented" : "sold"}</button>}
                  {!["archived", "sold", "rented"].includes(listing.status) && <button disabled={busy} onClick={() => void changeStatus(listing.id, "archived")}>Archive</button>}
                </div>
                {editing === listing.id && <form className="account-edit-form" onSubmit={(event) => void saveEdit(event, listing.id)}>
                  <label>Title<input name="title" defaultValue={listing.title} required minLength={10} maxLength={120} /></label>
                  <label>Description<textarea name="description" defaultValue={listing.description} required minLength={20} maxLength={4000} rows={4} /></label>
                  <div className="modal-form-row"><label>City<input name="city" defaultValue={listing.city} required minLength={2} /></label><label>Area<input name="locality" defaultValue={listing.locality} required minLength={2} /></label></div>
                  <label>Price (PKR)<input name="pricePkr" type="number" min="1" defaultValue={listing.pricePkr} required /></label>
                  <button className="button button-primary" disabled={busy}>Save changes</button>
                </form>}
              </div>
            </article>)}
          </div> : <div className="account-empty"><h2>No listings yet</h2><p>Start a listing and you can manage drafts and review status here.</p><Link className="button button-primary" href="/">List your property</Link></div>}
          <section className="account-inquiries"><h2>Messages</h2>
            {inquiries.length ? inquiries.map((inquiry) => <article key={inquiry.id}><b>{inquiry.listing_title} · {inquiry.direction === "sent" ? "Sent" : "Received"}</b><span>{inquiry.other_party_name || "RAQBO member"} · {new Date(inquiry.created_at).toLocaleString()}</span><p>{inquiry.message}</p><small>Status: {inquiry.status}</small></article>) : <p>No messages yet.</p>}
          </section>
          <section className="account-danger"><div><h2>Account and privacy</h2><p>Request account deletion for manual review under RAQBO&apos;s retention policy.</p></div><button disabled={busy} onClick={() => void requestDeletion()}>Request account deletion</button></section>
        </> : <form className="account-auth-card" onSubmit={(event) => void authenticate(event)}>
          <h2>{otpRequested ? "Enter your code" : "Sign in with your phone"}</h2>
          <p>Use your verified phone to manage listings, messages, and account requests.</p>
          <label>Mobile number<input type="tel" value={phone} disabled={otpRequested} onChange={(event) => setPhone(event.target.value)} required minLength={8} maxLength={24} placeholder="+92 3XX XXXXXXX" /></label>
          {!otpRequested && <label className="account-consent"><input type="checkbox" required /> I agree to receive a verification code by SMS.</label>}
          {otpRequested && <label>6-digit code<input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>}
          <button className="button button-primary" disabled={busy}>{busy ? "Please wait…" : otpRequested ? "Verify and sign in" : "Send verification code"}</button>
          {otpRequested && <button className="account-link-button" type="button" onClick={() => { setOtpRequested(false); setDevelopmentCode(""); }}>Use another number</button>}
          {developmentCode && <small>Development-only code: {developmentCode}</small>}
          <small>Production SMS delivery requires an approved provider.</small>
        </form>}
      </section>
    </main>
  );
}
