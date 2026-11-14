"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import styles from "./deal-room.module.css";
import {
  formatPkr,
  initialMessages,
  properties,
  type DealMessage,
  type DealOffer,
} from "./deal-data";

type View = "discover" | "deal" | "checks";
type Persona = "buyer" | "seller";

const icons = {
  arrow: "↗",
  check: "✓",
  chat: "▤",
  clock: "◷",
  home: "⌂",
  pin: "⌖",
  shield: "⬡",
};

export default function DealRoomDemo() {
  const [view, setView] = useState<View>("discover");
  const [persona, setPersona] = useState<Persona>("buyer");
  const [selectedId, setSelectedId] = useState(properties[0].id);
  const [city, setCity] = useState("All cities");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<DealMessage[]>(initialMessages);
  const [offers, setOffers] = useState<DealOffer[]>([
    { id: "o1", amount: 74000000, status: "countered", note: "I can be flexible for a quick close.", by: "seller" },
  ]);
  const [messageText, setMessageText] = useState("");
  const [offerAmount, setOfferAmount] = useState("75000000");
  const [viewing, setViewing] = useState("");
  const [viewingRequested, setViewingRequested] = useState(false);
  const [checkRequested, setCheckRequested] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = properties.find((property) => property.id === selectedId) ?? properties[0];
  const filteredProperties = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return properties.filter((property) => {
      const matchesCity = city === "All cities" || property.city === city;
      const matchesText = !needle || `${property.title} ${property.city} ${property.area} ${property.category}`
        .toLocaleLowerCase()
        .includes(needle);
      return matchesCity && matchesText;
    });
  }, [city, query]);

  function showView(nextView: View) {
    setView(nextView);
    setNotice("");
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = messageText.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        sender: "you",
        text,
        time: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date()),
      },
    ]);
    setMessageText("");
    setNotice("Demo request sent to the RAQBO coordinator.");
  }

  function submitOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(offerAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setNotice("Enter a valid offer amount in PKR.");
      return;
    }
    setOffers((current) => [
      ...current,
      { id: crypto.randomUUID(), amount, status: "sent", note: "New offer", by: persona },
    ]);
    setNotice("Demo offer sent to the RAQBO coordinator to relay to the owner.");
    setView("deal");
  }

  function respondToOffer(id: string, action: "accepted" | "declined" | "countered") {
    setOffers((current) => current.map((offer) => offer.id === id ? {
      ...offer,
      status: action,
      by: persona,
      amount: action === "countered" ? Math.round((offer.amount + selected.price) / 2) : offer.amount,
      note: action === "countered" ? "Seller counter-offer" : action === "accepted" ? "Offer accepted" : "Offer declined",
    } : offer));
    setNotice(action === "accepted" ? "Demo response recorded and relayed by RAQBO." : action === "declined" ? "Demo response recorded and relayed by RAQBO." : "Demo counter-offer sent to the RAQBO coordinator.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="RAQBO home">
          <span className={styles.brandMark}>r</span>
          <span>raqbo<span className={styles.brandDot}>.</span><small>PROPERTY, WITH CLARITY</small></span>
        </Link>
        <nav className={styles.topLinks} aria-label="Main navigation">
          <Link href="/">Home</Link>
          <a href="#marketplace" onClick={() => showView("discover")}>Browse</a>
          <a href="#deal-room" onClick={() => showView("deal")}>Deal room</a>
        </nav>
        <span className={styles.demoBadge}><span /> Interactive demo · Sample data</span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>A clearer way to close</p>
          <h1>Find the place.<br /><em>We coordinate.</em></h1>
          <p className={styles.heroLead}>Send questions, viewing requests and offers to your RAQBO coordinator. Buyer and owner contact details stay private while every next step is tracked in one place.</p>
          <div className={styles.heroActions}>
            <button className={styles.primaryButton} onClick={() => showView("discover")}>Explore properties <span>{icons.arrow}</span></button>
            <span className={styles.heroProof}><span>{icons.shield}</span> Clear check status, no false guarantees</span>
          </div>
        </div>
        <div className={styles.heroCard} aria-label="Example property deal summary">
          <div className={styles.heroImage}><span className={styles.imageTag}>RAQBO coordinated</span><span className={styles.imageMark}>RAQBO <b>DEMO</b></span></div>
          <div className={styles.heroCardBody}>
            <span className={styles.location}>{icons.pin} DHA Phase 6 · Lahore</span>
            <h2>A quieter kind of family home</h2>
            <div className={styles.heroCardBottom}><b>{formatPkr(78500000)}</b><span>1 Kanal · 5 beds</span></div>
          </div>
          <div className={styles.heroCardFoot}><span className={styles.liveDot} /> Updates arrive through your coordinator</div>
        </div>
        <div className={styles.heroGlow} />
      </section>

      <section className={styles.trustStrip} aria-label="How the process works">
        <div><span>01</span><b>Browse real listings</b><small>Filter by city, area and property type.</small></div>
        <div><span>02</span><b>Request through RAQBO</b><small>Your coordinator contacts the owner.</small></div>
        <div><span>03</span><b>Track every response</b><small>Offers and viewing requests stay in-app.</small></div>
        <div><span>04</span><b>Check before you commit</b><small>See exactly what was—and wasn&apos;t—checked.</small></div>
      </section>

      <section className={styles.workspace} id="marketplace">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>Your property journey</p><h2>One place for every next step.</h2></div>
          <label className={styles.persona}>
            <span>Preview as</span>
            <select value={persona} onChange={(event) => setPersona(event.target.value as Persona)} aria-label="Preview as">
              <option value="buyer">Buyer · Ali</option>
              <option value="seller">Seller · Sara</option>
            </select>
          </label>
        </div>

        <div className={styles.workspaceGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sideTitle}><span>WORKSPACE</span><small>Demo account</small></div>
            <button className={`${styles.sideLink} ${view === "discover" ? styles.sideLinkActive : ""}`} onClick={() => showView("discover")}><span>{icons.home}</span>Discover homes</button>
            <button className={`${styles.sideLink} ${view === "deal" ? styles.sideLinkActive : ""}`} onClick={() => showView("deal")}><span>{icons.chat}</span>My deal room <i>{messages.length}</i></button>
            <button className={`${styles.sideLink} ${view === "checks" ? styles.sideLinkActive : ""}`} onClick={() => showView("checks")}><span>{icons.shield}</span>Document checks</button>
            <div className={styles.sideDivider} />
            <div className={styles.safetyNote}><span>{icons.shield}</span><b>RAQBO coordinates every step.</b><p>Buyer and owner do not contact each other directly. Requests and updates go through the RAQBO team.</p></div>
          </aside>

          <div className={styles.mainPanel}>
            <div className={styles.panelTabs} role="tablist" aria-label="Deal room sections">
              <button role="tab" aria-selected={view === "discover"} className={view === "discover" ? styles.tabActive : ""} onClick={() => showView("discover")}>Discover <span>04</span></button>
              <button role="tab" aria-selected={view === "deal"} className={view === "deal" ? styles.tabActive : ""} onClick={() => showView("deal")}>Deal room <span>{messages.length}</span></button>
              <button role="tab" aria-selected={view === "checks"} className={view === "checks" ? styles.tabActive : ""} onClick={() => showView("checks")}>Checks</button>
            </div>

            {notice && <p className={styles.notice} role="status">{notice}</p>}

            {view === "discover" && <div className={styles.discoverView}>
              <div className={styles.discoverIntro}><div><h3>Homes with a clear path to a deal.</h3><p>Sample listings only—use the filters to explore this demo.</p></div><span className={styles.sampleLabel}>DEMO INVENTORY</span></div>
              <div className={styles.filters}>
                <label className={styles.searchBox}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city, area or property" aria-label="Search demo properties" /></label>
                <label className={styles.cityFilter}><span className={styles.visuallyHidden}>Filter by city</span><select value={city} onChange={(event) => setCity(event.target.value)}><option>All cities</option><option>Lahore</option><option>Islamabad</option><option>Karachi</option></select></label>
              </div>
              <div className={styles.propertyList}>
                {filteredProperties.map((property) => <article key={property.id} className={`${styles.propertyCard} ${selected.id === property.id ? styles.propertySelected : ""}`}>
                  <button className={styles.propertyImage} onClick={() => { setSelectedId(property.id); setView("deal"); }} aria-label={`Open ${property.title}`} style={{ backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(12,32,31,.38)), url("${property.image}")` }}>
                    <span>{property.category}</span><i>{property.city}</i>
                  </button>
                  <div className={styles.propertyBody}>
                    <div className={styles.propertyLocation}>{icons.pin} {property.area}, {property.city}</div>
                    <h4>{property.title}</h4>
                    <div className={styles.propertySpecs}><span>{property.size}</span>{property.beds > 0 && <span>{property.beds} beds</span>}{property.baths > 0 && <span>{property.baths} baths</span>}</div>
                    <div className={styles.propertyBottom}><b>{formatPkr(property.price)}</b><button onClick={() => { setSelectedId(property.id); setView("deal"); }}>Open deal room <span>{icons.arrow}</span></button></div>
                  </div>
                </article>)}
                {!filteredProperties.length && <div className={styles.emptyState}><b>No sample properties match those filters.</b><button onClick={() => { setQuery(""); setCity("All cities"); }}>Clear filters</button></div>}
              </div>
              <p className={styles.demoDisclaimer}>All properties and people shown here are fictional examples. No listing, seller, price, document check or offer is real.</p>
            </div>}

            {view === "deal" && <div className={styles.dealView} id="deal-room">
              <div className={styles.dealHeader}>
                <div className={styles.dealPropertyThumb} style={{ backgroundImage: `url("${selected.image}")` }} />
                <div className={styles.dealHeaderText}><span>DEAL ROOM · SAMPLE</span><h3>{selected.title}</h3><p>{selected.area}, {selected.city} · {formatPkr(selected.price)}</p></div>
                <button className={styles.checkButton} onClick={() => showView("checks")}>{icons.shield} Check status</button>
              </div>
              <div className={styles.dealColumns}>
                <section className={styles.conversation} aria-label="RAQBO coordination updates">
                  <div className={styles.conversationHeading}><div className={styles.avatar}>RQ</div><div><b>RAQBO coordinator</b><small>Private updates for your property request</small></div><span className={styles.online}><i /> Demo</span></div>
                  <div className={styles.messages} aria-live="polite">
                    {messages.map((message) => <div key={message.id} className={`${styles.messageRow} ${message.sender === "you" ? styles.myMessage : ""}`}>
                      <div><span>{message.sender === "you" ? "You" : "RAQBO coordinator"}</span><p>{message.text}</p><small>{message.time}</small></div>
                    </div>)}
                  </div>
                  <form className={styles.messageForm} onSubmit={sendMessage}><label className={styles.visuallyHidden} htmlFor="demo-message">Message the RAQBO coordinator</label><input id="demo-message" value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Send a question to your RAQBO coordinator…" maxLength={1000} /><button aria-label="Send request to RAQBO" type="submit">{icons.arrow}</button></form>
                  <small className={styles.chatSafety}>Do not send payment details or original documents in chat. RAQBO will coordinate and update your account.</small>
                </section>

                <aside className={styles.dealActions}>
                  <div className={styles.actionCard}><div className={styles.actionTitle}><span>{icons.clock}</span><div><b>Arrange a viewing</b><small>Request a time through your coordinator.</small></div></div>
                    {viewingRequested ? <p className={styles.confirmedState}><span>{icons.check}</span> Request sent · {viewing}</p> : <form className={styles.viewingForm} onSubmit={(event) => { event.preventDefault(); if (!viewing) return; setViewingRequested(true); setNotice("Viewing request sent in this demo."); }}><label htmlFor="viewing-time">Choose a time</label><input id="viewing-time" type="datetime-local" value={viewing} onChange={(event) => setViewing(event.target.value)} required /><button className={styles.secondaryButton} type="submit">Request viewing</button></form>}
                  </div>
                  <div className={styles.actionCard}><div className={styles.actionTitle}><span>₨</span><div><b>Make an offer</b><small>RAQBO relays the offer and response.</small></div></div>
                    <form className={styles.offerForm} onSubmit={submitOffer}><label htmlFor="offer-amount">Your offer · PKR</label><div className={styles.amountInput}><span>₨</span><input id="offer-amount" inputMode="numeric" value={offerAmount} onChange={(event) => setOfferAmount(event.target.value.replace(/[^\d]/g, ""))} required /></div><button className={styles.primaryButton} type="submit">{persona === "buyer" ? "Send offer" : "Send counter-offer"} <span>{icons.arrow}</span></button></form>
                    <p className={styles.noEscrow}>Demo only. Offers are not legally binding; no payment is collected and no contract is created.</p>
                  </div>
                </aside>
              </div>
              <section className={styles.offerHistory}><div className={styles.offerHeading}><div><p className={styles.eyebrow}>Negotiation</p><h3>Offers & responses</h3></div><span>{offers.length} activity</span></div>
                {offers.length ? <div className={styles.offerList}>{offers.map((offer) => {
                  const sellerCanRespond = persona === "seller" && offer.by === "buyer" && ["sent", "countered"].includes(offer.status);
                  const buyerCanRespond = persona === "buyer" && offer.by === "seller" && offer.status === "countered";
                  return <article key={offer.id} className={styles.offerRow}>
                    <div className={styles.offerIcon}>{offer.status === "accepted" ? icons.check : "₨"}</div>
                    <div className={styles.offerDetails}><b>{offer.note}</b><small>{offer.by === persona ? "Submitted by you" : "Response relayed by RAQBO"} · {offer.status}</small></div>
                    <strong>{formatPkr(offer.amount)}</strong>
                    <span className={`${styles.offerStatus} ${styles[`status_${offer.status}`]}`}>{offer.status.replace("_", " ")}</span>
                    {(sellerCanRespond || buyerCanRespond) && <div className={styles.offerControls}>
                      <button onClick={() => respondToOffer(offer.id, "accepted")}>Accept</button>
                      <button onClick={() => respondToOffer(offer.id, "countered")}>Counter</button>
                      <button onClick={() => respondToOffer(offer.id, "declined")}>Decline</button>
                    </div>}
                  </article>;
                })}</div> : <p className={styles.emptyOffers}>No offers yet. Submit one to start a RAQBO-coordinated negotiation.</p>}
              </section>
            </div>}

            {view === "checks" && <div className={styles.checksView}>
              <div className={styles.checksIntro}><span className={styles.checksIcon}>{icons.shield}</span><p className={styles.eyebrow}>Know what was checked</p><h3>Verification is a record of checks—not a promise of ownership.</h3><p>Each check must show who performed it, what source they used, when it happened and what it covered.</p></div>
              <div className={styles.checksProperty}><div className={styles.checksThumb} style={{ backgroundImage: `url("${selected.image}")` }} /><div><span>DEMO PROPERTY</span><b>{selected.title}</b><small>{selected.area}, {selected.city} · Sample only</small></div><span className={styles.notGuarantee}>Not a title guarantee</span></div>
              <div className={styles.checkList}>
                {[
                  ["Identity checked", "ID name matched to seller profile", "Sample check · ID details hidden"],
                  ["Title documents", "Owner documents uploaded for review", "Sample status · Not independently verified"],
                  ["Authority record", "Land / society record check", "Not completed · Confirm with authority"],
                ].map(([title, detail, status], index) => <article key={title} className={styles.checkItem}><span className={`${styles.checkStep} ${index === 2 ? styles.checkPending : ""}`}>{index < 2 ? icons.check : "03"}</span><div><b>{title}</b><p>{detail}</p><small>{status}</small></div><span className={index === 2 ? styles.pendingPill : styles.checkedPill}>{index === 2 ? "Pending" : "Demo"}</span></article>)}
              </div>
              <div className={styles.checkActions}><p>Do not rely on a screenshot. Confirm ownership and encumbrances with the relevant land authority, registrar or housing society before paying or signing.</p><button className={styles.secondaryButton} onClick={() => { setCheckRequested(true); setNotice("Check request recorded in this demo only."); }}>{checkRequested ? "Request noted in demo" : "Request an independent check"}</button></div>
              <div className={styles.privacyCallout}><b>Privacy by design</b><p>This preview does not accept or store CNIC images, title deeds, exact plot references or payment details. Live escrow/payment and e-signing are not enabled until approved providers, secure storage and legal workflows are configured.</p></div>
            </div>}
          </div>
        </div>
      </section>

      <footer className={styles.footer}><Link href="/">← Back to RAQBO home</Link><span>Sample experience only · No live properties, contracts, payments or checks</span></footer>
    </main>
  );
}
