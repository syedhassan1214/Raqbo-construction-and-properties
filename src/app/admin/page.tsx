"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import PanoramaViewer from "@/components/PanoramaViewer";

type User = { id: string; role: string; email: string | null; displayName?: string };
type Listing = {
  id: string; title: string; description: string; province: string; city: string; locality: string;
  category: string; dealType: string; ownershipType: string; size: string; bedrooms: number | null;
  bathrooms: number | null; negotiable: boolean; attributes: Record<string, unknown>;
  status: string; pricePkr: number; creatorId: string | null; media: ListingMedia[];
  reviewNote?: string | null;
};
type ListingMedia = {
  id: string; assetType: "property_photo" | "property_video" | "model_glb" | "panorama";
  fileSize: number; reviewStatus: string; reviewNote: string | null; fileUrl: string;
};
type VerificationCase = {
  id: string; listing_title: string; city: string; locality: string;
  check_type: string; status: string; scope: string; evidence_summary: string;
};
type ServiceRequest = {
  id: string; name: string; city: string; service_type: string; message: string; status: string;
  assigned_to: string | null; assignee_name: string | null;
};
type DealInquiry = {
  id: string; listing_title: string; city: string; locality: string; message: string; status: string;
  buyer_update: string | null; owner_update: string | null; assigned_to: string | null;
  assignee_name: string | null; buyer_name: string; owner_name: string | null; created_at: string;
};
type ServiceAssignee = { id: string; display_name: string; email: string | null };
type Report = {
  id: string; listing_id: string | null; listing_title: string | null; city: string | null;
  locality: string | null; listing_status: string | null; category: string; message: string; status: string;
};
type Account = { id: string; role: string; email: string | null; display_name: string; status: string };
type AuditEntry = {
  id: string; action: string; entity_type: string; entity_id: string | null;
  created_at: string; actor_email: string | null; actor_name: string | null;
  details: Record<string, unknown>;
};
type QueueData = Record<string, unknown>[];
type Tab = "overview" | "listings" | "inquiries" | "verification" | "services" | "reports" | "users" | "deletions" | "audit" | "media";
type MediaAsset = {
  id: string; listing_title: string; city: string; locality: string;
  asset_type: ListingMedia["assetType"]; file_size: number; fileUrl: string;
};

const tabs: { id: Tab; label: string; roles: string[] }[] = [
  { id: "overview", label: "Overview", roles: ["admin", "moderator", "verifier", "support", "finance"] },
  { id: "listings", label: "Listings", roles: ["admin", "moderator"] },
  { id: "inquiries", label: "Deal coordination", roles: ["admin", "support"] },
  { id: "verification", label: "Verification", roles: ["admin", "verifier"] },
  { id: "media", label: "Media assets", roles: ["admin", "moderator"] },
  { id: "services", label: "Service requests", roles: ["admin", "support"] },
  { id: "reports", label: "Reports", roles: ["admin", "moderator", "support"] },
  { id: "users", label: "Users", roles: ["admin", "support"] },
  { id: "deletions", label: "Deletion requests", roles: ["admin", "support"] },
  { id: "audit", label: "Audit log", roles: ["admin"] },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Request failed (${response.status}).`);
  return payload as T;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<QueueData>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "setup">("login");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [listingStatus, setListingStatus] = useState("submitted");
  const [queueSearch, setQueueSearch] = useState("");
  const [serviceAssignees, setServiceAssignees] = useState<ServiceAssignee[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const loadTab = useCallback(async (selected: Tab, selectedListingStatus = "submitted") => {
    setLoading(true);
    setMessage("");
    try {
      if (selected === "overview") {
        const result = await api<{ counts: Record<string, number> }>("/api/admin/summary");
        setSummary(result.counts);
        setData([]);
      } else {
        const routes: Record<Exclude<Tab, "overview">, string> = {
          listings: `/api/admin/listings?status=${encodeURIComponent(selectedListingStatus)}`,
          inquiries: "/api/admin/inquiries",
          verification: "/api/admin/verification",
          services: "/api/admin/service-requests",
          reports: "/api/admin/reports",
          users: "/api/admin/users",
          deletions: "/api/admin/deletion-requests",
          audit: "/api/admin/audit",
          media: "/api/admin/3d-assets",
        };
        const result = await api<Record<string, QueueData> & { assignees?: ServiceAssignee[] }>(routes[selected]);
        const key: Record<Exclude<Tab, "overview">, string> = {
          listings: "listings", inquiries: "inquiries", verification: "cases", services: "requests",
          reports: "reports", users: "users", deletions: "requests",
          audit: "logs",
          media: "assets",
        };
        const rows = result[key[selected]] ?? [];
        setData(rows);
        if (selected === "services" || selected === "inquiries") {
          setServiceAssignees(result.assignees ?? []);
          setAssignments(Object.fromEntries(rows.map((row) => [
            String(row.id),
            typeof row.assigned_to === "string" ? row.assigned_to : "",
          ])));
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load this section.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void import("@google/model-viewer");
    api<{ user: User | null }>("/api/auth/me")
      .then(({ user: current }) => {
        setUser(current);
        if (current) void loadTab("overview");
        else setLoading(false);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not check the session.");
        setLoading(false);
      });
  }, [loadTab]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body = authMode === "setup"
      ? {
          bootstrapKey: String(form.get("bootstrapKey") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          displayName: String(form.get("displayName") ?? ""),
        }
      : { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
    try {
      const result = await api<{ user: User }>(
        authMode === "setup" ? "/api/auth/admin/bootstrap" : "/api/auth/admin/login",
        { method: "POST", body: JSON.stringify(body) },
      );
      setUser(result.user);
      setTab("overview");
      await loadTab("overview");
      setMessage("Signed in successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function act(url: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await api(url, { method: "POST", body: JSON.stringify(body) });
      setMessage(success);
      if (user) await loadTab(tab, listingStatus);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function update(url: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await api(url, { method: "PATCH", body: JSON.stringify(body) });
      setMessage(success);
      if (user) await loadTab(tab, listingStatus);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setUser(null);
      setData([]);
      setMessage("You have signed out.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  if (!user) {
    return (
      <main className="admin-auth">
        <Link className="brand" href="/"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>ADMIN CONSOLE</small></span></Link>
        <form className="admin-auth-card" onSubmit={authenticate}>
          <div className="eyebrow"><span /> RESTRICTED ACCESS</div>
          <h1>{authMode === "setup" ? "Set up the first admin" : "Admin sign in"}</h1>
          <p>Access is limited to authorized RAQBO staff. Never share setup credentials.</p>
          {authMode === "setup" && <>
            <label>Setup key<input name="bootstrapKey" type="password" autoComplete="off" minLength={32} required /></label>
            <label>Your name<input name="displayName" autoComplete="name" minLength={2} required /></label>
          </>}
          <label>Email<input name="email" type="email" autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" autoComplete={authMode === "setup" ? "new-password" : "current-password"} minLength={authMode === "setup" ? 14 : 1} required /></label>
          <button className="button button-primary" disabled={busy}>{busy ? "Please wait…" : authMode === "setup" ? "Create admin account" : "Sign in"}</button>
          <button type="button" className="admin-mode-toggle" onClick={() => { setAuthMode(authMode === "setup" ? "login" : "setup"); setMessage(""); }}>
            {authMode === "setup" ? "Already set up? Sign in" : "Initial owner setup"}
          </button>
          {message && <p className="admin-message" role="status">{message}</p>}
        </form>
        <Link href="/" className="admin-back-link">← Back to RAQBO</Link>
      </main>
    );
  }

  const allowedTabs = tabs.filter((item) => item.roles.includes(user.role));
  const counts = Object.entries(summary);

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <Link className="brand" href="/"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>ADMIN CONSOLE</small></span></Link>
        <div className="admin-account"><span>{user.email} · {user.role}</span><button onClick={logout}>Sign out</button></div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar" aria-label="Admin sections">
          {allowedTabs.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); void loadTab(item.id, listingStatus); }}>{item.label}</button>
          ))}
          <p>Actions are role-restricted and recorded in the audit log.</p>
        </aside>
        <section className="admin-content">
          <div className="admin-heading">
            <div><div className="eyebrow"><span /> RAQBO OPERATIONS</div><h1>{tabs.find((item) => item.id === tab)?.label}</h1></div>
            <button className="admin-refresh" onClick={() => void loadTab(tab, listingStatus)} disabled={loading}>Refresh</button>
          </div>
          {tab === "listings" && <div className="admin-queue-filters">
            <label>Listing status<select value={listingStatus} onChange={(event) => {
              const status = event.target.value;
              setListingStatus(status);
              void loadTab("listings", status);
            }}>
              <option value="submitted">Awaiting review</option>
              <option value="needs_changes">Changes requested</option>
              <option value="rejected">Rejected</option>
              <option value="live">Published</option>
              <option value="paused">Paused</option>
              <option value="under_offer">Under offer</option>
              <option value="sold">Sold</option>
              <option value="rented">Rented</option>
            </select></label>
            <label>Search listings<input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Title, city or locality" /></label>
          </div>}
          {message && <div className="admin-message" role="status">{message}</div>}
          {loading ? <p className="admin-empty">Loading…</p> : tab === "overview" ? (
            <div className="admin-metrics">
              {counts.map(([key, value]) => <article key={key}><span>{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span><b>{value}</b></article>)}
            </div>
          ) : <AdminQueue
            tab={tab}
            data={tab === "listings" && queueSearch.trim()
              ? data.filter((row) => JSON.stringify(row).toLowerCase().includes(queueSearch.trim().toLowerCase()))
              : data}
            user={user}
            busy={busy}
            reviewNotes={reviewNotes}
            setReviewNotes={setReviewNotes}
            serviceAssignees={serviceAssignees}
            assignments={assignments}
            setAssignments={setAssignments}
            act={act}
            update={update}
          />}
        </section>
      </div>
    </main>
  );
}

function AdminQueue({
  tab, data, user, busy, reviewNotes, setReviewNotes, serviceAssignees, assignments,
  setAssignments, act, update,
}: {
  tab: Tab; data: QueueData; user: User; busy: boolean;
  reviewNotes: Record<string, string>;
  setReviewNotes: (notes: Record<string, string>) => void;
  serviceAssignees: ServiceAssignee[];
  assignments: Record<string, string>;
  setAssignments: (assignments: Record<string, string>) => void;
  act: (url: string, body: Record<string, unknown>, success: string) => Promise<void>;
  update: (url: string, body: Record<string, unknown>, success: string) => Promise<void>;
}) {
  if (data.length === 0) return <p className="admin-empty">Nothing in this queue right now.</p>;
  return <div className="admin-queue">
    {data.map((row) => {
      const id = String(row.id);
      const note = reviewNotes[id] ?? "";
      if (tab === "listings") {
        const listing = row as Listing;
        return <article className="admin-card" key={id}>
          <div className="admin-card-heading"><div><h2>{listing.title}</h2><p>{listing.locality}, {listing.city} · {listing.category} · PKR {listing.pricePkr.toLocaleString("en-PK")}</p></div><span className="admin-status">{listing.status}</span></div>
          <div className="admin-listing-review-details">
            <p>{listing.description}</p>
            <p><b>Transaction:</b> {listing.dealType === "rent" ? "Rent" : "Sale"} · <b>Advertiser:</b> {listing.ownershipType.replaceAll("_", " ")} · <b>Province:</b> {listing.province}</p>
            <p><b>Size:</b> {listing.size} · <b>Bedrooms:</b> {listing.bedrooms ?? "Not specified"} · <b>Bathrooms:</b> {listing.bathrooms ?? "Not specified"} · <b>Negotiable:</b> {listing.negotiable ? "Yes" : "No"}</p>
          </div>
          <div className="admin-listing-media">
            <h3>Submitted photos and media ({listing.media.length})</h3>
            {listing.media.length === 0
              ? <p>No media attached.</p>
              : listing.media.map((asset) => <div className="admin-listing-media-item" key={asset.id}>
                <p>{asset.assetType === "property_photo" ? "Property photo" : asset.assetType === "property_video" ? "Property video" : asset.assetType === "model_glb" ? "3D model" : "360° panorama"} · {asset.reviewStatus.replaceAll("_", " ")} · {(asset.fileSize / (1024 * 1024)).toFixed(1)} MB</p>
                {asset.assetType === "property_video"
                  ? <video className="admin-property-video" src={asset.fileUrl} controls preload="metadata" aria-label="Submitted property video" />
                  : asset.assetType === "model_glb"
                    ? <model-viewer src={asset.fileUrl} camera-controls auto-rotate aria-label="Submitted property 3D model" />
                    : asset.assetType === "panorama"
                      ? <PanoramaViewer src={asset.fileUrl} label="Submitted 360 degree panorama" />
                      : <Image className="uploaded-property-photo" src={asset.fileUrl} alt="Submitted property photo" width={960} height={600} unoptimized />}
                {asset.reviewNote && <small>Previous media review: {asset.reviewNote}</small>}
              </div>)}
          </div>
          <p>Approving this listing publishes its details and approves all pending attached media together.</p>
          {listing.status !== "submitted" && <p className="admin-review-feedback"><b>Previous staff feedback:</b> {listing.reviewNote || "No review note recorded."}</p>}
          <label>Review note<textarea value={note} onChange={(event) => setReviewNotes({ ...reviewNotes, [id]: event.target.value })} placeholder="Explain the moderation decision (at least 5 characters)." /></label>
          <div className="admin-actions">
            {listing.status === "submitted" && <>
              <button disabled={busy || note.trim().length < 5} onClick={() => void act(`/api/admin/listings/${id}/review`, { decision: "approve", note }, "Listing approved and published.")}>Approve</button>
              <button disabled={busy || note.trim().length < 5} onClick={() => void act(`/api/admin/listings/${id}/review`, { decision: "needs_changes", note }, "Changes requested.")}>Request changes</button>
              <button disabled={busy || note.trim().length < 5} onClick={() => void act(`/api/admin/listings/${id}/review`, { decision: "reject", note }, "Listing rejected.")}>Reject</button>
            </>}
            {["rejected", "needs_changes"].includes(listing.status) && <button disabled={busy || note.trim().length < 5} onClick={() => void act(`/api/admin/listings/${id}/review`, { decision: "restore", note }, "Listing returned to the review queue.")}>Return to review</button>}
            {listing.status === "live" && <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/listings/${id}`, { status: "paused", note }, "Listing unpublished.")}>Unpublish</button>}
            {listing.status === "paused" && <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/listings/${id}`, { status: "live", note }, "Listing republished.")}>Republish</button>}
            {["live", "paused"].includes(listing.status) && <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/listings/${id}`, { status: "archived", note }, "Listing archived.")}>Archive</button>}
          </div>
        </article>;
      }
      if (tab === "media") {
        const item = row as MediaAsset;
        return <article className="admin-card admin-media-card" key={id}>
          <div className="admin-card-heading"><div><h2>{item.listing_title}</h2><p>{item.locality}, {item.city} · {item.asset_type === "model_glb" ? "3D model" : item.asset_type === "panorama" ? "360° panorama" : item.asset_type === "property_video" ? "Property video" : "Property photo"} · {(item.file_size / (1024 * 1024)).toFixed(1)} MB</p></div></div>
          {item.asset_type === "model_glb"
            ? <model-viewer src={item.fileUrl} camera-controls auto-rotate aria-label="Pending 3D model review" />
            : item.asset_type === "panorama"
              ? <PanoramaViewer src={item.fileUrl} label="Pending panorama review" />
              : item.asset_type === "property_video"
                ? <video className="admin-property-video" src={item.fileUrl} controls preload="metadata" aria-label="Pending property video review" />
                : <Image className="uploaded-property-photo" src={item.fileUrl} alt="Pending property photo" width={960} height={600} unoptimized />}
          <label>Manual review note<textarea value={note} onChange={(event) => setReviewNotes({ ...reviewNotes, [id]: event.target.value })} placeholder="Record what you checked (at least 5 characters)." /></label>
          <div className="admin-actions">
            <button disabled={busy || note.trim().length < 5} onClick={() => void update(`/api/admin/3d-assets/${id}`, { decision: "approve", note }, "Media approved for display on its live listing.")}>Approve</button>
            <button disabled={busy || note.trim().length < 5} onClick={() => void update(`/api/admin/3d-assets/${id}`, { decision: "reject", note }, "Media rejected.")}>Reject</button>
          </div>
          <small>Manual review only—no malware scanning or automated AI analysis is configured.</small>
        </article>;
      }
      if (tab === "inquiries") {
        const item = row as DealInquiry;
        return <InquiryCoordinationCard
          key={id}
          item={item}
          busy={busy}
          assignees={serviceAssignees}
          assignee={assignments[id] ?? ""}
          setAssignee={(value) => setAssignments({ ...assignments, [id]: value })}
          update={update}
        />;
      }
      if (tab === "verification") {
        const item = row as VerificationCase;
        const pendingSecond = item.status === "pending_second_review";
        const review = (decision: string) => act(`/api/admin/verification/${id}/review`, {
          decision, evidenceSummary: note, ...(decision === "confirmed" ? { expiresAt: new Date(Date.now() + 180 * 86400000).toISOString() } : {}),
        }, "Verification decision recorded.");
        return <article className="admin-card" key={id}>
          <div className="admin-card-heading"><div><h2>{item.listing_title}</h2><p>{item.locality}, {item.city} · {item.check_type.replaceAll("_", " ")} · {item.status}</p></div></div>
          <p><b>Check scope:</b> {item.scope}</p><p><b>Previous evidence:</b> {item.evidence_summary || "None supplied"}</p>
          <label>Review evidence summary<textarea value={note} onChange={(event) => setReviewNotes({ ...reviewNotes, [id]: event.target.value })} placeholder="Describe the evidence reviewed and limitations (at least 10 characters)." /></label>
          <div className="admin-actions">
            <button disabled={busy || note.trim().length < 10} onClick={() => void review("confirmed")}>{pendingSecond ? "Second approval" : "Confirm check"}</button>
            <button disabled={busy || note.trim().length < 10} onClick={() => void review("unconfirmed")}>Mark unconfirmed</button>
            <button disabled={busy || note.trim().length < 10} onClick={() => void review(pendingSecond ? "revoke" : "issue_identified")}>{pendingSecond ? "Revoke" : "Identify issue"}</button>
          </div>
        </article>;
      }
      if (tab === "services") {
        const item = row as ServiceRequest;
        return <article className="admin-card" key={id}>
          <div className="admin-card-heading"><div><h2>{item.service_type.replaceAll("_", " ")}</h2><p>{item.name} · {item.city} · {item.status}</p></div></div>
          <p>Assigned to: {item.assignee_name || "Unassigned"}</p>
          <p>{item.message}</p>
          <label>Assignee<select value={assignments[id] ?? ""} onChange={(event) => setAssignments({ ...assignments, [id]: event.target.value })}>
            <option value="">Unassigned</option>
            {serviceAssignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.display_name || assignee.email || assignee.id}</option>)}
          </select></label>
          <label>Internal update<textarea value={note} onChange={(event) => setReviewNotes({ ...reviewNotes, [id]: event.target.value })} placeholder="Add a short case note (at least 3 characters)." /></label>
          <div className="admin-actions">
            <button disabled={busy} onClick={() => void update(`/api/admin/service-requests/${id}`, {
              note: note.trim().length >= 3 ? note : "Assignment updated",
              assignedTo: assignments[id] || null,
            }, "Service request assigned.")}>Save assignment</button>
            <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/service-requests/${id}`, { status: "under_review", note }, "Service request updated.")}>Mark under review</button>
            <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/service-requests/${id}`, { status: "information_required", note }, "Information requested.")}>Request information</button>
            <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/service-requests/${id}`, { status: "completed", note }, "Service request completed.")}>Complete</button>
          </div>
        </article>;
      }
      if (tab === "reports") {
        const item = row as Report;
        return <article className="admin-card" key={id}>
          <div className="admin-card-heading"><div><h2>{item.category.replaceAll("_", " ")}</h2><p>{item.listing_title ?? "Listing unavailable"}{item.city ? ` · ${item.locality}, ${item.city}` : ""} · {item.status}{item.listing_id ? ` · ${item.listing_id}` : ""}</p></div></div>
          <p>{item.message}</p>
          <label>Resolution note<textarea value={note} onChange={(event) => setReviewNotes({ ...reviewNotes, [id]: event.target.value })} placeholder="Explain this report's disposition." /></label>
          <div className="admin-actions">
            {(["investigating", "resolved", "dismissed"] as const).map((status) => <button key={status} disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/reports/${id}`, { status, note }, `Report marked ${status}.`)}>{status.replace("_", " ")}</button>)}
            {item.listing_id && item.listing_status === "live" && <button disabled={busy || note.trim().length < 3} onClick={() => void update(`/api/admin/listings/${item.listing_id}`, { status: "paused", note }, "Reported listing unpublished for review.")}>Unpublish linked listing</button>}
          </div>
        </article>;
      }
      if (tab === "users") {
        const account = row as Account;
        const status = account.status === "suspended" ? "active" : "suspended";
        return <article className="admin-card admin-user-card" key={id}>
          <div><h2>{account.display_name || account.email || "Phone-based user"}</h2><p>{account.email ?? "No email"} · {account.role} · {account.status}</p></div>
          {user.role === "admin" && account.role !== "admin" && <div className="admin-actions">
            <input aria-label="Reason for account status change" value={note} onChange={(event) => setReviewNotes({ ...reviewNotes, [id]: event.target.value })} placeholder="Reason (min 5 characters)" />
            <button disabled={busy || note.trim().length < 5} onClick={() => void update(`/api/admin/users/${id}`, { status, reason: note }, `Account ${status}.`)}>{status === "active" ? "Restore" : "Suspend"}</button>
          </div>}
        </article>;
      }
      if (tab === "deletions") {
        const item = row as { id: string; display_name: string; email: string | null; role: string; status: string };
        return <article className="admin-card" key={id}>
          <h2>{item.display_name || item.email || "Account deletion request"}</h2>
          <p>{item.email ?? "No email"} · {item.role} · {item.status}</p>
          <p>Deletion requests require manual review under the approved retention and legal policy. No automated erasure action is available yet.</p>
        </article>;
      }
      if (tab === "audit") {
        const entry = row as AuditEntry;
        return <article className="admin-card admin-audit-card" key={id}>
          <div className="admin-card-heading"><div><h2>{entry.action.replaceAll(".", " ")}</h2><p>{entry.actor_name || entry.actor_email || "System"} · {entry.entity_type}{entry.entity_id ? ` · ${entry.entity_id}` : ""}</p></div><time>{new Date(entry.created_at).toLocaleString()}</time></div>
          <pre>{JSON.stringify(entry.details, null, 2)}</pre>
        </article>;
      }
      return null;
    })}
  </div>;
}

function InquiryCoordinationCard({
  item,
  busy,
  assignees,
  assignee,
  setAssignee,
  update,
}: {
  item: DealInquiry;
  busy: boolean;
  assignees: ServiceAssignee[];
  assignee: string;
  setAssignee: (value: string) => void;
  update: (url: string, body: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [buyerUpdate, setBuyerUpdate] = useState(item.buyer_update ?? "");
  const [ownerUpdate, setOwnerUpdate] = useState(item.owner_update ?? "");
  const url = `/api/admin/inquiries/${item.id}`;
  const updatesValid = [buyerUpdate, ownerUpdate].every((value) =>
    !value.trim() || value.trim().length >= 3);

  return <article className="admin-card" key={item.id}>
    <div className="admin-card-heading">
      <div><h2>{item.listing_title}</h2><p>{item.locality}, {item.city} · {item.buyer_name} → {item.owner_name || "Owner account unavailable"} · {new Date(item.created_at).toLocaleString()}</p></div>
      <span className="admin-status">{item.status}</span>
    </div>
    <p><b>Private request from buyer:</b> {item.message}</p>
    <label>Coordinator assignment<select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
      <option value="">Unassigned</option>
      {assignees.map((staff) => <option key={staff.id} value={staff.id}>{staff.display_name || staff.email || staff.id}</option>)}
    </select></label>
    <label>Update for buyer<textarea value={buyerUpdate} onChange={(event) => setBuyerUpdate(event.target.value)} maxLength={1000} placeholder="Only the buyer will see this update." /></label>
    <label>Update for property owner<textarea value={ownerUpdate} onChange={(event) => setOwnerUpdate(event.target.value)} maxLength={1000} placeholder="Only the property owner will see this update." /></label>
    <p>These updates are private to each account. Do not include personal contact details; keep all coordination on RAQBO.</p>
    <div className="admin-actions">
      <button disabled={busy || !updatesValid} onClick={() => void update(url, {
        buyerUpdate: buyerUpdate.trim() || null,
        ownerUpdate: ownerUpdate.trim() || null,
        assignedTo: assignee || null,
      }, "Private coordination updates saved.")}>Save updates</button>
      {(["read", "replied", "closed", "flagged"] as const).map((status) => <button key={status} disabled={busy || item.status === status} onClick={() => void update(url, { status }, `Request marked ${status}.`)}>{status === "read" ? "Start coordination" : status.replaceAll("_", " ")}</button>)}
    </div>
  </article>;
}
