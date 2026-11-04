import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="account-page">
      <header className="account-topbar">
        <Link className="brand" href="/"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>PROPERTY, WITH CLARITY</small></span></Link>
        <nav><Link href="/">Home</Link><Link href="/terms">Terms</Link></nav>
      </header>
      <article className="account-content policy-content">
        <div className="eyebrow"><span /> CLIENT REVIEW REQUIRED</div>
        <h1>Privacy notice — draft</h1>
        <p className="policy-warning">This is an implementation summary for review, not a final privacy policy or legal advice. RAQBO must approve it with local counsel before public launch.</p>
        <h2>Information this website handles</h2>
        <p>Depending on how you use the local website, it may store phone-verification records, account details, property listings and media, saved properties, listing messages, reports, and service requests. Service-request phone numbers and user phone numbers are encrypted at rest; normalized phone hashes are used to find accounts and verify codes.</p>
        <h2>Why information is used</h2>
        <p>The current app uses information to authenticate accounts, save and review listings, deliver property inquiries within account pages, process moderation reports, and record service requests. It does not configure production SMS, payment, analytics, or advertising providers.</p>
        <h2>Access, retention, and deletion</h2>
        <p>Private drafts and pending media are restricted to their owner and authorized staff. Staff actions are recorded in an audit log. Account deletion requests are queued for manual review; an approved retention and erasure policy is still required before launch.</p>
        <h2>Third parties and hosting</h2>
        <p>The current development setup uses local SQLite and local media storage. Production hosting, durable database, object storage, malware scanning, SMS delivery, and any analytics or map services must be selected and documented by RAQBO before deployment.</p>
        <p>For now, use the <Link href="/">contact form</Link> for questions. Replace this draft with RAQBO-approved contact details, purposes, legal bases, retention periods, and applicable rights before public use.</p>
        <Link className="button button-primary" href="/">Back to RAQBO</Link>
      </article>
    </main>
  );
}
