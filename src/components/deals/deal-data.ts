export type DealMessage = {
  id: string;
  sender: "you" | "coordinator";
  text: string;
  time: string;
};

export type OfferStatus = "sent" | "countered" | "accepted" | "declined";

export type DealOffer = {
  id: string;
  amount: number;
  status: OfferStatus;
  note: string;
  by: "buyer" | "seller";
};

export type DealProperty = {
  id: string;
  title: string;
  city: string;
  area: string;
  category: string;
  size: string;
  price: number;
  beds: number;
  baths: number;
  image: string;
  seller: string;
  initials: string;
  verified: string[];
  description: string;
};

export const properties: DealProperty[] = [
  {
    id: "dha-home",
    title: "A quieter kind of family home",
    city: "Lahore",
    area: "DHA Phase 6",
    category: "House",
    size: "1 Kanal",
    price: 78500000,
    beds: 5,
    baths: 6,
    image: "/property-placeholder.svg",
    seller: "Sara Ahmed",
    initials: "SA",
    verified: ["Seller ID checked", "Title documents uploaded"],
    description:
      "A bright family home with generous living spaces, a private garden and easy access to local schools. Viewing requests and offers are coordinated by RAQBO.",
  },
  {
    id: "gulberg-flat",
    title: "Sunlit apartment with a view",
    city: "Lahore",
    area: "Gulberg III",
    category: "Apartment",
    size: "1,650 sq ft",
    price: 32500000,
    beds: 3,
    baths: 3,
    image: "/property-placeholder.svg",
    seller: "Hamza Malik",
    initials: "HM",
    verified: ["Seller ID checked"],
    description:
      "Well-kept apartment close to shops and transit. Ask questions, request a viewing or submit an offer through the RAQBO deal room.",
  },
  {
    id: "islamabad-plot",
    title: "Residential plot in a growing community",
    city: "Islamabad",
    area: "B-17",
    category: "Plot",
    size: "10 Marla",
    price: 18000000,
    beds: 0,
    baths: 0,
    image: "/property-placeholder.svg",
    seller: "Usman Tariq",
    initials: "UT",
    verified: ["Seller ID checked", "Authority check requested"],
    description:
      "A sample plot listing for exploring the document review and offer workflow. Exact plot references are intentionally omitted from this preview.",
  },
  {
    id: "karachi-villa",
    title: "Open-plan villa with a garden",
    city: "Karachi",
    area: "DHA Phase 8",
    category: "House",
    size: "500 sq yd",
    price: 112000000,
    beds: 5,
    baths: 6,
    image: "/property-placeholder.svg",
    seller: "Mariam Khan",
    initials: "MK",
    verified: ["Seller ID checked", "Title documents reviewed"],
    description:
      "Spacious sample villa with a sunny garden and room for entertaining. Check status and scope before arranging an in-person visit.",
  },
];

export const initialMessages: DealMessage[] = [
  { id: "m1", sender: "coordinator", text: "Welcome. I am your RAQBO coordinator for this property. What would you like us to check with the owner?", time: "10:18" },
  { id: "m2", sender: "you", text: "Can you confirm the document-check status and arrange a viewing this weekend?", time: "10:22" },
  { id: "m3", sender: "coordinator", text: "Your request is with our team. We will update your account after coordinating with the owner.", time: "10:25" },
];

export function formatPkr(amount: number) {
  return `PKR ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(amount)}`;
}
