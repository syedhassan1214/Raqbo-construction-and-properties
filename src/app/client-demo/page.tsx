"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type View = "browse" | "documents" | "dashboard" | "flow" | "seller";
type Journey = "buy" | "rent" | "sell";
type DocumentStatus = "unknown" | "available" | "missing" | "scan";
type DocumentItem = { id: string; label: string; service: string };
type Property = {
  id: string;
  title: string;
  location: string;
  city: string;
  type: string;
  subtype: string;
  size: string;
  price: string;
  deal: "buy" | "rent";
  seller: string;
  sellerId: string;
  verification: string;
};

const properties: Property[] = [
  { id: "p1", title: "A place to call home", location: "DHA Phase 6, Lahore", city: "Lahore", type: "House", subtype: "Family home", size: "1 Kanal", price: "PKR 7.85 crore", deal: "buy", seller: "Sara Ahmed", sellerId: "sara", verification: "Document review requested" },
  { id: "p2", title: "The sunlit residence", location: "Gulberg III, Lahore", city: "Lahore", type: "Apartment", subtype: "Apartment", size: "1,650 sq ft", price: "PKR 1.65 lac / month", deal: "rent", seller: "Sara Ahmed", sellerId: "sara", verification: "Re-verification due" },
  { id: "p3", title: "A fresh start in Islamabad", location: "B-17, Islamabad", city: "Islamabad", type: "Plot", subtype: "Residential plot", size: "10 Marla", price: "PKR 1.8 crore", deal: "buy", seller: "Usman Tariq", sellerId: "usman", verification: "Not verified" },
  { id: "p4", title: "The garden apartment", location: "F-11, Islamabad", city: "Islamabad", type: "Apartment", subtype: "Apartment", size: "1,250 sq ft", price: "PKR 1.15 lac / month", deal: "rent", seller: "Usman Tariq", sellerId: "usman", verification: "Review requested" },
];

const documents: Record<Journey, DocumentItem[]> = {
  buy: [
    { id: "identity", label: "Buyer identity document", service: "Identity verification" },
    { id: "title", label: "Property ownership record", service: "Title verification" },
    { id: "agreement", label: "Sale agreement", service: "Document drafting" },
    { id: "authority", label: "Authority / society record", service: "Authority verification" },
  ],
  rent: [
    { id: "identity", label: "Tenant identity document", service: "Identity verification" },
    { id: "ownership", label: "Owner authorization", service: "Ownership verification" },
    { id: "agreement", label: "Rental agreement", service: "Rental document drafting" },
  ],
  sell: [
    { id: "identity", label: "Seller identity document", service: "Identity verification" },
    { id: "title", label: "Ownership / title record", service: "Title verification" },
    { id: "authority", label: "Authority / society record", service: "Authority verification" },
    { id: "agreement", label: "Sale agreement", service: "Document drafting" },
  ],
};

const steps = [
  ["01", "Choose journey", "Buy, rent or sell"],
  ["02", "Browse / list", "Find or add a property"],
  ["03", "RAQBO agent", "Request and coordination"],
  ["04", "Documents", "Checklist and review"],
  ["05", "Services", "Resolve missing items"],
  ["06", "Agreement", "Legal review and next steps"],
  ["07", "Track & re-verify", "Follow progress in dashboard"],
];

const labels: Record<Journey, string> = { buy: "Buy", rent: "Rent", sell: "Sell" };

export default function ClientDemo() {
  const [view, setView] = useState<View>("browse");
  const [journey, setJourney] = useState<Journey>("buy");
  const [city, setCity] = useState("All cities");
  const [selected, setSelected] = useState<Property | null>(null);
  const [sellerId, setSellerId] = useState("sara");
  const [documentStatuses, setDocumentStatuses] = useState<Record<string, DocumentStatus>>({});
  const [reverificationOnly, setReverificationOnly] = useState(false);
  const [requests, setRequests] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ sender: "you" | "agent"; text: string }[]>([
    { sender: "agent", text: "Hello! I am your sample RAQBO agent. How can we help with your property journey?" },
  ]);

  const filteredProperties = useMemo(() => properties.filter((property) =>
    property.deal === (journey === "rent" ? "rent" : "buy") &&
    (city === "All cities" || property.city === city)), [city, journey]);
  const sellerProperties = properties.filter((property) => property.sellerId === sellerId);
  const sellerName = sellerProperties[0]?.seller ?? "Sample seller";
  const missingDocuments = documents[journey].filter((document) =>
    documentStatuses[`${journey}:${document.id}`] === "missing");

  function navigate(next: View) {
    setView(next);
    setSelected(null);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function chooseJourney(next: Journey) {
    setJourney(next);
    setCity("All cities");
    setSelected(null);
    setNotice("");
    setView(next === "sell" ? "documents" : "browse");
  }

  function setDocumentStatus(id: string, status: DocumentStatus) {
    setDocumentStatuses((current) => ({ ...current, [`${journey}:${id}`]: status }));
    setNotice(status === "scan"
      ? "Sample scan added to this preview. No camera opened and no file was uploaded."
      : "Checklist updated in this demo. Open the dashboard to see missing items.");
  }

  function requestProperty(property: Property, action: string) {
    setRequests((current) => [`${action}: ${property.title}`, ...current]);
    setNotice(`${action} added to the sample dashboard. Nothing was sent to an agent or seller.`);
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { sender: "you", text },
      { sender: "agent", text: "Demo reply: your request would go to a RAQBO agent. No real agent received this message." },
    ]);
    setChatInput("");
  }

  function submitSampleListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const subtype = String(data.get("subtype") ?? "").trim();
    if (!title || !subtype) {
      setNotice("Enter a sample property title and subtype before adding the preview listing.");
      return;
    }
    setRequests((current) => [`Listing review: ${title} (${subtype})`, ...current]);
    form.reset();
    setNotice("Sample listing added to the dashboard. It is not published or sent for review.");
  }

  return <main className={styles.page}>
    <div className={styles.demoBar}>INTERACTIVE CLIENT PREVIEW <span>Sample data only · No live transactions</span></div>
    <header className={styles.header}>
      <button className={styles.brand} onClick={() => navigate("browse")} aria-label="RAQBO demo home"><span className={styles.brandMark}>r</span><span>raqbo<span className={styles.brandDot}>.</span><small>PROPERTY, WITH CLARITY</small></span></button>
      <nav className={styles.nav} aria-label="Demo navigation">
        <button className={view === "browse" ? styles.navActive : ""} onClick={() => navigate("browse")}>Browse</button>
        <button className={view === "documents" ? styles.navActive : ""} onClick={() => navigate("documents")}>Documents</button>
        <button className={view === "dashboard" ? styles.navActive : ""} onClick={() => navigate("dashboard")}>Dashboard</button>
        <button className={view === "flow" ? styles.navActive : ""} onClick={() => navigate("flow")}>How it works</button>
      </nav>
      <button className={styles.headerButton} onClick={() => chooseJourney("sell")}>List a property <span>↗</span></button>
    </header>

    {view === "browse" && <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>PROPERTY, WITH A PERSONAL TOUCH</p>
            <h1>A better way<br />to <em>make your move.</em></h1>
            <p>Find your property, organise your documents and let RAQBO coordinate every step. One journey, all in one place.</p>
            <div className={styles.heroActions}><button className={styles.primary} onClick={() => document.getElementById("sample-listings")?.scrollIntoView({ behavior: "smooth" })}>Explore properties <span>↗</span></button><button className={styles.textButton} onClick={() => navigate("flow")}>See how it works <span>→</span></button></div>
          </div>
          <div className={styles.heroNote}><span className={styles.heroNoteIcon}>✦</span><div><b>Your property journey, simplified.</b><small>Buy · Rent · Sell with RAQBO</small></div></div>
        </div>
      </section>
      <div className={styles.container}>
        <section className={styles.searchPanel} aria-label="Browse sample properties">
          <div className={styles.journeyTabs} aria-label="Choose a property journey">{(["buy", "rent", "sell"] as const).map((item) => <button key={item} className={journey === item ? styles.tabSelected : ""} onClick={() => chooseJourney(item)}>{labels[item]}</button>)}</div>
          <div className={styles.searchRow}><div><small>YOUR NEXT MOVE</small><b>{journey === "rent" ? "Find a place to rent" : "Find a place to buy"}</b></div><label>City<select value={city} onChange={(event) => setCity(event.target.value)}><option>All cities</option><option>Lahore</option><option>Islamabad</option></select></label><button className={styles.primary} onClick={() => document.getElementById("sample-listings")?.scrollIntoView({ behavior: "smooth" })}>Browse properties <span>↗</span></button></div>
        </section>
        <section className={styles.section} id="sample-listings">
          <div className={styles.sectionTop}><div><p className={styles.eyebrow}>CURATED FOR YOUR NEXT CHAPTER</p><h2>Places worth exploring.</h2><p>Explore sample {journey === "rent" ? "rental" : "sale"} listings. RAQBO coordinates every request.</p></div><span className={styles.resultCount}>{filteredProperties.length} SAMPLE LISTINGS</span></div>
          <div className={styles.cards}>{filteredProperties.map((property, index) => <article className={styles.propertyCard} key={property.id}>
            <button className={`${styles.propertyImage} ${index % 2 ? styles.imageAlternate : ""}`} onClick={() => { setSelected(property); setNotice(""); }} aria-label={`View ${property.title}`}>
              <span className={styles.imageTag}>FOR {property.deal === "buy" ? "SALE" : "RENT"}</span><span className={styles.sampleTag}>SAMPLE</span>
            </button>
            <div className={styles.cardBody}><span className={styles.location}>⌖ {property.location}</span><h3>{property.title}</h3><div className={styles.specs}>{property.type} <span>·</span> {property.subtype} <span>·</span> {property.size}</div><div className={styles.cardBottom}><b>{property.price}</b><button onClick={() => { setSelected(property); setNotice(""); }}>View details ↗</button></div></div>
          </article>)}</div>
          {filteredProperties.length === 0 && <p className={styles.empty}>No sample properties in this city. Choose another city to continue.</p>}
        </section>
        <section className={styles.featureStrip}><div><span>01</span><b>Browse with clarity</b><small>Explore homes and property details.</small></div><div><span>02</span><b>We coordinate</b><small>RAQBO handles buyer and seller requests.</small></div><div><span>03</span><b>Stay on track</b><small>See documents and next steps in one place.</small></div></section>
        <section className={styles.reward}><span>✦</span><div><p className={styles.eyebrow}>MORE FROM RAQBO</p><h3>Rewards & benefits</h3><p>Explore future rewards as part of your property journey. Details are illustrative.</p></div><button className={styles.outline} onClick={() => setNotice("Rewards are a visual example only. No rewards are configured.")}>Learn more ↗</button></section>
      </div>
    </>}

    {view === "documents" && <div className={styles.container}>
      <section className={styles.pageIntro}><p className={styles.eyebrow}>YOUR DOCUMENT WORKSPACE</p><h1>Everything in its place.</h1><p>Choose your journey and tell us what you have. Your RAQBO team can identify the next service you may need.</p></section>
      <div className={styles.inlineTabs}>{(["buy", "rent", "sell"] as const).map((item) => <button key={item} className={journey === item ? styles.tabSelected : ""} onClick={() => { setJourney(item); setNotice(""); }}>{labels[item]}</button>)}</div>
      {journey === "sell" && <form className={`${styles.panel} ${styles.listingForm}`} onSubmit={submitSampleListing}>
        <div><p className={styles.eyebrow}>SELLER JOURNEY</p><h2>Preview your listing.</h2><p className={styles.helper}>Enter fictional details only. This preview does not publish or store a real listing.</p></div>
        <label>Sample property title<input name="title" placeholder="e.g. Family home" maxLength={100} required /></label>
        <label>Property subtype<input name="subtype" placeholder="e.g. House, apartment, plot" maxLength={80} required /></label>
        <button className={styles.primary} type="submit">Add sample listing ↗</button>
      </form>}
      <div className={styles.twoColumns}><section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>{labels[journey].toUpperCase()} CHECKLIST</p><h2>Your documents</h2></div><span className={styles.pill}>{documents[journey].length} SAMPLE ITEMS</span></div><p className={styles.helper}>Example checklist only. Actual requirements must be confirmed for each property and jurisdiction. Never upload real identity or legal documents here.</p>
        <div className={styles.documentList}>{documents[journey].map((document, index) => {
          const status = documentStatuses[`${journey}:${document.id}`] ?? "unknown";
          return <div className={styles.documentRow} key={document.id}><span className={styles.docIcon}>{String(index + 1).padStart(2, "0")}</span><div className={styles.documentMain}><b>{document.label}</b><small>{status === "unknown" ? "Choose your status" : status === "available" ? "Marked available" : status === "missing" ? "Marked missing" : "Sample scan added · not reviewed"}</small></div><div className={styles.docActions}><button className={status === "available" ? styles.chosen : ""} onClick={() => setDocumentStatus(document.id, "available")}>Have it</button><button className={status === "missing" ? styles.chosenMissing : ""} onClick={() => setDocumentStatus(document.id, "missing")}>Missing</button><button className={status === "scan" ? styles.chosen : ""} onClick={() => setDocumentStatus(document.id, "scan")}>▣ Demo scan</button></div></div>;
        })}</div>
      </section><aside className={styles.sidebarPanel}><span className={styles.sideIcon}>▣</span><p className={styles.eyebrow}>CAMERA SCAN PREVIEW</p><h3>Documents made simpler.</h3><p>In the planned experience, you can capture, crop and submit documents securely from your phone.</p><div className={styles.disclaimer}><b>Preview only</b><br />The demo scan buttons simulate the step. No camera, upload, document storage or verification is connected.</div><button className={styles.outline} onClick={() => navigate("dashboard")}>See dashboard ↗</button></aside></div>
    </div>}

    {view === "dashboard" && <div className={styles.container}>
      <section className={styles.pageIntro}><p className={styles.eyebrow}>YOUR RAQBO OVERVIEW</p><h1>Every next step, in view.</h1><p>A sample view of customer progress and what the RAQBO team needs to review.</p></section>
      <div className={styles.metrics}><article><small>ACTIVE JOURNEY</small><b>{labels[journey]}</b><span>Sample journey</span></article><article><small>MISSING DOCUMENTS</small><b>{String(missingDocuments.length).padStart(2, "0")}</b><span>For the selected journey</span></article><article><small>REQUESTS</small><b>{String(requests.length).padStart(2, "0")}</b><span>Made in this preview</span></article><article><small>RE-VERIFICATION</small><b>01</b><span>Sample case requires review</span></article></div>
      <div className={styles.twoColumns}><section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>DOCUMENT INTELLIGENCE</p><h2>Missing items & services</h2></div><button className={styles.smallLink} onClick={() => navigate("documents")}>Edit checklist ↗</button></div>
        {missingDocuments.length ? <div className={styles.dashboardList}>{missingDocuments.map((item) => <div key={item.id}><span className={styles.warningIcon}>!</span><div><b>{item.label}</b><small>Suggested service: {item.service}</small></div><span className={styles.missingPill}>Missing</span></div>)}</div> : <p className={styles.empty}>No missing items marked for {labels[journey]}. Go to Documents to try the checklist.</p>}
        <h3 className={styles.subheading}>Sample requests</h3>{requests.length ? <div className={styles.dashboardList}>{requests.map((request, index) => <div key={`${request}-${index}`}><span className={styles.docIcon}>↗</span><div><b>{request}</b><small>Awaiting RAQBO coordination · Demo</small></div></div>)}</div> : <p className={styles.helper}>No requests in this preview yet. Open a sample property to add one.</p>}
      </section><aside className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>STAFF REVIEW</p><h2>Verification queue</h2></div></div><label className={styles.filterCheck}><input type="checkbox" checked={reverificationOnly} onChange={(event) => setReverificationOnly(event.target.checked)} /> Re-verification required</label><div className={styles.queue}><div><span className={styles.warningIcon}>↻</span><div><b>Ownership record</b><small>Sample property · Review due</small></div><span className={styles.missingPill}>Re-verify</span></div>{!reverificationOnly && <div><span className={styles.docIcon}>◷</span><div><b>Identity review</b><small>Sample seller · Pending</small></div><span className={styles.pill}>Pending</span></div>}</div><p className={styles.helper}>Sample statuses only; this preview does not verify documents or represent an actual review queue.</p></aside></div>
    </div>}

    {view === "flow" && <div className={styles.container}>
      <section className={styles.pageIntro}><p className={styles.eyebrow}>THE COMPLETE JOURNEY</p><h1>From first look to next steps.</h1><p>One coordinated property journey for buyers, tenants and sellers.</p></section>
      <div className={styles.flowGrid}>{steps.map(([number, title, description], index) => <div className={styles.flowStep} key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div>{index < steps.length - 1 && <i aria-hidden="true">→</i>}</div>)}</div>
      <div className={styles.flowCallout}><span>✦</span><div><h2>RAQBO is there at every step.</h2><p>Buyers and sellers do not communicate directly in this concept. Requests go to a RAQBO coordinator. Payment, escrow, e-signatures and legal registration are not available in this preview.</p></div><button className={styles.primary} onClick={() => navigate("browse")}>Try the journey ↗</button></div>
    </div>}

    {view === "seller" && <div className={styles.container}>
      <section className={styles.profileHero}><div className={styles.profileAvatar}>{sellerName.split(" ").map((part) => part[0]).join("")}</div><div><p className={styles.eyebrow}>SAMPLE SELLER PROFILE</p><h1>{sellerName}</h1><p>Property advertiser · Illustrative profile</p><span className={styles.pill}>Verification status: example only</span></div><button className={styles.outline} onClick={() => setChatOpen(true)}>Ask RAQBO about seller ↗</button></section>
      <section className={styles.section}><div className={styles.sectionTop}><div><p className={styles.eyebrow}>LISTINGS & SUBTYPES</p><h2>Properties by {sellerName}.</h2><p>Seller contact details remain private. All requests go through RAQBO.</p></div><span className={styles.resultCount}>{sellerProperties.length} SAMPLE LISTINGS</span></div><div className={styles.cards}>{sellerProperties.map((property) => <article className={styles.propertyCard} key={property.id}><button className={styles.propertyImage} onClick={() => { setSelected(property); setNotice(""); }} aria-label={`View ${property.title}`}><span className={styles.imageTag}>FOR {property.deal === "buy" ? "SALE" : "RENT"}</span><span className={styles.sampleTag}>SAMPLE</span></button><div className={styles.cardBody}><span className={styles.location}>⌖ {property.location}</span><h3>{property.title}</h3><div className={styles.specs}>{property.type} · {property.subtype} · {property.size}</div><div className={styles.cardBottom}><b>{property.price}</b><button onClick={() => { setSelected(property); setNotice(""); }}>View details ↗</button></div></div></article>)}</div></section>
    </div>}

    {notice && <div className={styles.notice} role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

    <footer className={styles.footer}><div className={styles.footerGrid}><div><div className={styles.footerBrand}>raqbo<span>.</span></div><p>A more thoughtful way to find property and take your next step.</p><small>CLIENT PREVIEW · SAMPLE CONTENT</small></div><div><h3>Explore</h3><button onClick={() => chooseJourney("buy")}>Buy property</button><button onClick={() => chooseJourney("rent")}>Rent property</button><button onClick={() => chooseJourney("sell")}>Sell property</button></div><div><h3>RAQBO</h3><button onClick={() => navigate("documents")}>Document services</button><button onClick={() => navigate("flow")}>How it works</button><button onClick={() => navigate("dashboard")}>Dashboard</button></div><div><h3>Head Office</h3><p>Pakistan<br />raqbo.com</p><a href="https://wa.me/923123140622" target="_blank" rel="noreferrer">WhatsApp Business ↗</a></div></div><div className={styles.footerBottom}><span>© 2026 RAQBO · Client preview</span><Link href="/">Back to website ↗</Link></div></footer>

    <button className={styles.agentLauncher} onClick={() => setChatOpen((open) => !open)} aria-label={chatOpen ? "Close RAQBO agent demo" : "Open RAQBO agent demo"} aria-expanded={chatOpen}><span>r</span><i /></button>
    {chatOpen && <section className={styles.chat} aria-label="RAQBO agent chat demo"><div className={styles.chatHeader}><div className={styles.chatAvatar}>r</div><div><b>RAQBO agent</b><small>Demo only · No live agent connected</small></div><button onClick={() => setChatOpen(false)} aria-label="Close chat">×</button></div><div className={styles.chatBody}>{messages.map((message, index) => <div className={message.sender === "you" ? styles.chatMine : styles.chatAgent} key={index}><small>{message.sender === "you" ? "You" : "RAQBO demo"}</small><p>{message.text}</p></div>)}</div><form className={styles.chatForm} onSubmit={sendMessage}><label className={styles.srOnly} htmlFor="demo-agent-message">Message RAQBO demo</label><input id="demo-agent-message" placeholder="Type a sample message..." maxLength={500} value={chatInput} onChange={(event) => setChatInput(event.target.value)} /><button type="submit" aria-label="Send demo message">↗</button></form></section>}

    {selected && <div className={styles.modalBackdrop} onClick={() => setSelected(null)}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="property-title" onClick={(event) => event.stopPropagation()}><button className={styles.modalClose} onClick={() => setSelected(null)} aria-label="Close property details">×</button><div className={styles.modalImage}><span className={styles.imageTag}>SAMPLE PROPERTY</span></div><div className={styles.modalContent}><p className={styles.eyebrow}>{selected.location.toUpperCase()}</p><h2 id="property-title">{selected.title}</h2><b className={styles.modalPrice}>{selected.price}</b><p>{selected.type} · {selected.subtype} · {selected.size}</p><p><b>Verification:</b> {selected.verification} · Sample status only</p><div className={styles.sellerRow}><span className={styles.profileAvatarSmall}>{selected.seller.split(" ").map((part) => part[0]).join("")}</span><div><b>{selected.seller}</b><small>Sample seller profile</small></div><button className={styles.smallLink} onClick={() => { setSellerId(selected.sellerId); navigate("seller"); }}>View profile ↗</button></div><p className={styles.helper}>RAQBO coordinates between buyer and seller. No direct contact details are shown.</p><div className={styles.modalActions}><button className={styles.primary} onClick={() => requestProperty(selected, "Property request")}>Request through RAQBO ↗</button><button className={styles.outline} onClick={() => requestProperty(selected, "Viewing request")}>Request a viewing</button><button className={styles.outline} onClick={() => requestProperty(selected, "Offer discussion")}>Discuss an offer</button></div><p className={styles.helper}>Demo actions only. No request is sent, payment collected, or contract created.</p></div></section></div>}
  </main>;
}
