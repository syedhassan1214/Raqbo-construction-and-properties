import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="account-page">
      <header className="account-topbar">
        <Link className="brand" href="/"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>PROPERTY, WITH CLARITY</small></span></Link>
        <nav><Link href="/">Home</Link><Link href="/privacy">Privacy</Link></nav>
      </header>
      <article className="account-content policy-content">
        <div className="eyebrow"><span /> CLIENT REVIEW REQUIRED</div>
        <h1>Terms — draft</h1>
        <p className="policy-warning">This is a product-scope draft, not binding terms or legal advice. RAQBO must approve it with local counsel before public launch.</p>
        <h2>Listings and user content</h2>
        <p>Advertisers are responsible for accurate listing details and for having permission to upload photos, videos, 3D models, and panoramas. RAQBO may hold submitted content for review and may reject or remove content under a client-approved moderation policy.</p>
        <h2>Verification limits</h2>
        <p>A displayed check describes only the specific evidence and scope recorded for that check. It is not a guarantee of ownership, title, legal status, condition, or transaction outcome. Buyers and renters should obtain independent professional advice.</p>
        <h2>Transactions and services</h2>
        <p>The current website does not collect deposits, token money, or transaction payments and does not provide escrow. Professional services depend on availability and must be agreed directly with the relevant professional under separately approved terms.</p>
        <h2>Launch requirements</h2>
        <p>Final terms still require RAQBO&apos;s approved legal entity and contact details, moderation/appeals process, prohibited-content rules, account and deletion policy, payment and service disclosures, dispute process, governing-law review, and effective date.</p>
        <Link className="button button-primary" href="/">Back to RAQBO</Link>
      </article>
    </main>
  );
}
