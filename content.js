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
    accountTitle: 'RAQBO',
    bank: '',        // e.g. 'Meezan Bank'
    iban: '',        // e.g. 'PK00MEZN0000000000000000'
    jazzcash: '',    // e.g. '0300 1234567'
    easypaisa: '',
    sadapay: ''
  },

  about: {
    sample: true,

    intro: "RAQBO is a Pakistan-based property, land and investment company. We help families and investors buy, sell and rent with clear information, verified documents and honest advice — and we build and deliver our own residential and commercial projects.",

    // [number, label] — shown in the top banner
    stats: [
      [
        "12+",
        "Years of experience"
      ],
      [
        "25+",
        "Projects delivered"
      ],
      [
        "3,000+",
        "Families served"
      ],
      [
        "6",
        "Cities across Pakistan"
      ]
    ],

    mission: "To make every property decision in Pakistan clear, safe and fair — from the first search to the final registry.",
    vision: "To be the most trusted name in Pakistani real estate, known for transparent dealing and projects delivered on time.",

    founder: {
      name: "Founder name",
      title: "Founder & Chief Executive, RAQBO",
      photo: 'images/founder.jpg',
      // one line per paragraph
      message: [
        "When I started RAQBO, I saw how hard it was for ordinary families in Pakistan to buy property with confidence. Unclear documents, hidden charges and promises that were never kept made the biggest investment of people’s lives feel like a gamble.",
        "We built RAQBO to change that. Every project we deliver and every listing we publish is backed by checked documents, honest pricing and a team that picks up the phone after the deal is done.",
        "Thank you for trusting us with your home, your land and your investment. Our promise is simple: clarity at every step."
      ]
    },

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
