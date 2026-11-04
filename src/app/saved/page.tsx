"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SavedListing = {
  id: string;
  title: string;
  city: string;
  locality: string;
  size: string;
  dealType: string;
  pricePkr: number;
  category: string;
  coverImage: string | null;
};

const storageKey = "raqbo:favorites";

export default function SavedPage() {
  const [listings, setListings] = useState<SavedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const sessionResponse = await fetch("/api/auth/me", { cache: "no-store" });
        if (!sessionResponse.ok) throw new Error("Could not check your account.");
        const { user } = await sessionResponse.json() as { user: { id: string } | null };
        let ids: string[] = [];
        try {
          const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
          if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === "string");
        } catch (error) {
          throw new Error("Your saved properties could not be read from this browser.", { cause: error });
        }
        if (user) {
          setSignedIn(true);
          const response = await fetch("/api/me/favorites", { cache: "no-store" });
          const payload = await response.json() as { listings?: SavedListing[]; message?: string };
          if (!response.ok) throw new Error(payload.message ?? "Could not load saved properties.");
          const serverIds = new Set((payload.listings ?? []).map((listing) => listing.id));
          for (const id of ids.filter((value) => /^[0-9a-f-]{36}$/i.test(value) && !serverIds.has(value))) {
            const saveResponse = await fetch("/api/me/favorites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ listingId: id }),
            });
            if (!saveResponse.ok) {
              const result = await saveResponse.json() as { message?: string; error?: string };
              throw new Error(result.message ?? result.error ?? "Could not sync guest-saved properties.");
            }
          }
          window.localStorage.setItem(storageKey, JSON.stringify([...new Set([...serverIds, ...ids])]));
          if (active) setListings(payload.listings ?? []);
          if (active && ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
            setMessage("Some saved design-preview examples are not live listings and are not available on this page.");
          }
          return;
        }
        if (!ids.length) {
          if (active) setListings([]);
          return;
        }
        const liveIds = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
        if (liveIds.length) {
          const response = await fetch(`/api/listings?ids=${encodeURIComponent(liveIds.join(","))}&limit=100`, { cache: "no-store" });
          const payload = await response.json() as { listings?: SavedListing[]; message?: string };
          if (!response.ok) throw new Error(payload.message ?? "Could not load saved properties.");
          if (active) setListings(payload.listings ?? []);
        }
        if (active && ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
          setMessage("Some saved design-preview examples are not live listings and are not available on this page.");
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load saved properties.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function removeSaved(id: string) {
    try {
      if (signedIn && /^[0-9a-f-]{36}$/i.test(id)) {
        const response = await fetch(`/api/me/favorites?listing_id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const result = await response.json() as { message?: string; error?: string };
        if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not remove this saved property.");
      }
      const current = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
      const next = Array.isArray(current) ? current.filter((value) => value !== id) : [];
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event("raqbo:favorites-change"));
      setListings((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update saved properties.");
    }
  }

  return (
    <main className="account-page">
      <header className="account-topbar">
        <Link className="brand" href="/"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>PROPERTY, WITH CLARITY</small></span></Link>
        <nav><Link href="/">Home</Link><Link href="/account">My account</Link></nav>
      </header>
      <section className="account-content">
        <div className="eyebrow"><span /> YOUR SHORTLIST</div>
        <h1>Saved properties</h1>
        <p>Keep the places you want to come back to in one place.</p>
        {message && <p className="account-message" role="alert">{message}</p>}
        {loading ? <p className="account-empty">Loading saved properties…</p> : listings.length ? <div className="account-listings">
          {listings.map((listing) => <article className="account-listing" key={listing.id}>
            <div className="account-listing-photo" style={{ backgroundImage: listing.coverImage ? `url("${listing.coverImage}")` : "url('/property-placeholder.svg')" }} />
            <div className="account-listing-body">
              <span>{listing.category} · {listing.dealType === "rent" ? "For rent" : "For sale"}</span>
              <h2>{listing.title}</h2>
              <p>{listing.locality}, {listing.city} · {listing.size}</p>
              <b>PKR {new Intl.NumberFormat("en-PK").format(listing.pricePkr)}{listing.dealType === "rent" ? " / month" : ""}</b>
              <div className="account-actions"><Link href={`/?listing=${encodeURIComponent(listing.id)}`}>View listing</Link><button onClick={() => removeSaved(listing.id)}>Remove</button></div>
            </div>
          </article>)}
        </div> : <div className="account-empty"><h2>No saved properties yet</h2><p>Use the heart on a property to add it to your shortlist.</p><Link className="button button-primary" href="/#properties">Browse listings</Link></div>}
        <p className="account-note">Guest saves are stored in this browser. Sign in to view server-synced saved properties.</p>
      </section>
    </main>
  );
}
