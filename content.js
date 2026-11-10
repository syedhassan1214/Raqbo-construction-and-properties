/* =====================================================================
   RAQBO — About us page content
   Edit the text between the quotes, save, and refresh the website.

   PHOTOS
   - Put photos in the "images" folder next to index.html.
   - Founder photo: save it as images/founder.jpg (portrait, about 800 x 1000 px).
   - Project photos: e.g. images/projects/residency-1.jpg, then write
       photos: ['images/projects/residency-1.jpg', 'images/projects/residency-2.jpg']
     Each photo becomes one slide in the slideshow. Wide photos (16:9) look best.
   - The https://images.unsplash.com/... links below are SAMPLE photos only.

   When everything is real, change  sample: true  to  sample: false
   (this removes the yellow "sample text" note at the top of the page).
   ===================================================================== */
window.RAQBO_CONTENT = {
  /* ---------------------------------------------------------------
     SELL WITH US & ORDER ONLINE — escrow account shown to buyers
     Fill in the account where buyers pay for escrow orders.
     Leave a line empty ('') to hide it. If ALL are empty, buyers get a
     WhatsApp button to ask RAQBO for payment details instead.
     --------------------------------------------------------------- */
  escrow: {
    accountTitle: 'RAQBO Properties',
    bank: 'Meezan Bank',
    iban: 'PK12MEZN0001234567890123',   // ⚠ check this is RAQBO's real IBAN
    jazzcash: '0300 1223344',
    easypaisa: '0300 1223344',
    sadapay: '0300 1223344',
    nayapay: '0300 1223344'
  },

  about: {
    sample: false,            // true shows a yellow "sample text" note at the top of the page
    projectsSample: true,     // change to false once the projects below are RAQBO's real projects

    // Big heading at the top: [white line, gold line]
    tagline: ['Every Property Solution.', 'One Place.'],

    // One line per paragraph
    intro: ["RAQBO is a next-generation property marketplace and digital community, created to transform Pakistan’s real estate experience.", "More than a property portal, RAQBO brings together property transactions, professional expertise and comprehensive property-related services on one innovative platform."],

    // [icon, text] — the three lines under the intro (icons: scale, shield, spark, hand, key)
    pillars: [['scale', 'Founded on Judicial Experience'], ['shield', 'Built on Trust'], ['spark', 'Driven by Innovation']],

    vision: "A property platform built not merely around advertisements, but around transparency, informed decisions and access to professional expertise.",
    ambition: "Our ambition is to make RAQBO Pakistan’s most trusted and connected property ecosystem — where property meets people, expertise and technology.",
    ambitionHighlight: 'where property meets people, expertise and technology',   // shown in gold inside the big quote

    // "More than a property portal" — [icon, title, line]  (icons: hand, scale, key, shield, spark)
    offer: [["hand", "Property transactions", "Buy, sell and rent with clear information on one platform."], ["scale", "Professional expertise", "Legal, verification and documentation professionals within easy reach."], ["key", "Property services", "Virtually every property-related service, in one place."]],

    // "How did it all begin?" — the story steps shown as a timeline (chips = small highlighted tags)
    story: [{"n": "01", "label": "The Bench", "icon": "scale", "text": "RAQBO is the vision of a District & Sessions Judge (R), whose extensive judicial career and first-hand understanding of property-related legal complexities inspired a new approach to Pakistan’s real estate sector."}, {"n": "02", "label": "The Problem", "icon": "shield", "text": "Years of judicial experience highlighted the serious challenges arising from disputed ownership, defective documentation, fraudulent transactions and complicated legal procedures.", "chips": ["Disputed ownership", "Defective documentation", "Fraudulent transactions", "Complicated legal procedures"]}, {"n": "03", "label": "The Vision", "icon": "key", "text": "This understanding gave rise to a powerful vision: a property platform built not merely around advertisements, but around transparency, informed decisions and access to professional expertise."}, {"n": "04", "label": "RAQBO", "icon": "spark", "text": "RAQBO was conceived to turn that vision into reality by connecting property owners, buyers, investors and professionals through technology, while bringing virtually every property-related service within easy reach."}],

    founder: {
      name: '',                  // founder's name (leave '' to show the title only)
      title: 'District & Sessions Judge (R)',
      role: 'Founder, RAQBO',
      photo: 'images/founder.jpg',                // if this file is missing, the RAQBO logo is shown instead
      heading: 'How did it all begin?',
      // one line per paragraph
      message: ["RAQBO is the vision of a District & Sessions Judge (R), whose extensive judicial career and first-hand understanding of property-related legal complexities inspired a new approach to Pakistan’s real estate sector.", "Years of judicial experience highlighted the serious challenges arising from disputed ownership, defective documentation, fraudulent transactions and complicated legal procedures. This understanding gave rise to a powerful vision: a property platform built not merely around advertisements, but around transparency, informed decisions and access to professional expertise.", "RAQBO was conceived to turn that vision into reality by connecting property owners, buyers, investors and professionals through technology, while bringing virtually every property-related service within easy reach."]
    },

    motto: ['Founded on Judicial Experience.', 'Built on Trust.', 'Driven by Innovation.'],

    // COMPLETED (previous) projects — slideshow
    completed: [
      {
        "title": "RAQBO Residency",
        "location": "DHA Phase 6, Lahore",
        "year": "2023",
        "text": "48 modern family homes, handed over on schedule.",
        "photos": [
          "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80",
          "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80"
        ]
      },
      {
        "title": "Gulberg Heights",
        "location": "Gulberg III, Lahore",
        "year": "2022",
        "text": "A 12-storey residential tower with 96 apartments.",
        "photos": [
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1600&q=80"
        ]
      },
      {
        "title": "Bahria Villas",
        "location": "Bahria Town, Rawalpindi",
        "year": "2021",
        "text": "24 luxury villas with landscaped streets.",
        "photos": [
          "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1600&q=80"
        ]
      },
      {
        "title": "Blue Area Business Centre",
        "location": "Blue Area, Islamabad",
        "year": "2020",
        "text": "Grade-A offices and ground-floor retail.",
        "photos": [
          "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80"
        ]
      }
    ],

    // ONGOING (existing) projects — slideshow with progress bar (0–100)
    ongoing: [
      {
        "title": "RAQBO Grand Apartments",
        "location": "Clifton, Karachi",
        "progress": 70,
        "handover": "Handover: June 2027",
        "text": "Structure complete — finishing works in progress.",
        "photos": [
          "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1600&q=80"
        ]
      },
      {
        "title": "Green Valley Farmhouses",
        "location": "Bedian Road, Lahore",
        "progress": 45,
        "handover": "Handover: Dec 2027",
        "text": "Boundary, roads and first 10 farmhouses under construction.",
        "photos": [
          "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1600&q=80"
        ]
      },
      {
        "title": "RAQBO Trade Centre",
        "location": "Faisalabad",
        "progress": 25,
        "handover": "Handover: 2028",
        "text": "Foundation and basement levels under way.",
        "photos": [
          "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1600&q=80"
        ]
      }
    ],

    // UPCOMING projects — cards with a Register interest (WhatsApp) button
    upcoming: [
      {
        "title": "RAQBO Skyline",
        "location": "Gulberg, Islamabad",
        "type": "Luxury apartments",
        "launch": "Launching early 2027",
        "text": "2 and 3 bedroom apartments with rooftop amenities.",
        "photo": "https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1600&q=80"
      },
      {
        "title": "RAQBO Enclave",
        "location": "Multan Road, Lahore",
        "type": "Gated community",
        "launch": "Launching mid 2027",
        "text": "5 and 10 marla plots with ready infrastructure.",
        "photo": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80"
      },
      {
        "title": "RAQBO Square",
        "location": "Peshawar",
        "type": "Commercial",
        "launch": "Launching 2028",
        "text": "Shops, offices and a food court on the main boulevard.",
        "photo": "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1600&q=80"
      }
    ]
  }
};
