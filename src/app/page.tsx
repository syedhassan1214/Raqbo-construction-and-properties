"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PanoramaViewer from "@/components/PanoramaViewer";

type Deal = "Buy" | "Rent";
type PropertyMedia = { id: string; assetType: "property_photo" | "property_video" | "model_glb" | "panorama"; url: string };
type Property = {
  id: string;
  title: string;
  type: string;
  city: string;
  area: string;
  size: string;
  price: number;
  beds: number;
  baths: number;
  image: string;
  owner: boolean;
  status: string;
  listingStatus: string;
  dealType: "buy" | "rent";
  isLive: boolean;
  description: string;
  media: PropertyMedia[];
  sizeValue: number;
  sizeUnit: string;
  createdAt: string | null;
  verificationDetails?: { checkType: string; status: string; scope: string; checkedAt: string | null; expiresAt: string | null; checkedBy: string }[];
};
type ListingSearch = {
  dealType: Deal;
  city: string;
  propertyType: string;
  budget: string;
  minPrice: string;
  maxPrice: string;
  bedrooms: string;
  minSize: string;
  maxSize: string;
  sizeUnit: string;
  ownerOnly: boolean;
  sort: string;
  listingId?: string;
};
type ListingDraftPayload = {
  dealType: string;
  category: string;
  ownershipType: string;
  title: string;
  description: string;
  province: string;
  city: string;
  locality: string;
  sizeValue: number;
  sizeUnit: string;
  pricePkr: number;
  negotiable: boolean;
  bedrooms?: number;
  bathrooms?: number;
};

const properties: Property[] = [
  {
    id: "demo-1",
    title: "Contemporary family home",
    type: "House",
    city: "Lahore",
    area: "DHA Phase 6",
    size: "1 Kanal",
    price: 78500000,
    beds: 5,
    baths: 6,
    image: "photo-1600596542815-ffad4c1539a9",
    owner: true,
    status: "Phone confirmed",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative design-preview content only.",
    media: [],
    sizeValue: 20,
    sizeUnit: "Marla",
    createdAt: null,
  },
  {
    id: "demo-2",
    title: "Sunlit apartment with a view",
    type: "Apartment",
    city: "Lahore",
    area: "Gulberg",
    size: "1,650 sq ft",
    price: 32500000,
    beds: 3,
    baths: 3,
    image: "photo-1600607687939-ce8a6c25118c",
    owner: true,
    status: "Authority checked",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative design-preview content only.",
    media: [],
    sizeValue: 1650,
    sizeUnit: "sq ft",
    createdAt: null,
  },
  {
    id: "demo-3",
    title: "A calm corner to call home",
    type: "House",
    city: "Islamabad",
    area: "Bahria Enclave",
    size: "10 Marla",
    price: 42500000,
    beds: 4,
    baths: 4,
    image: "photo-1600047509807-ba8f99d2cdde",
    owner: false,
    status: "Not verified",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative design-preview content only.",
    media: [],
    sizeValue: 10,
    sizeUnit: "Marla",
    createdAt: null,
  },
  {
    id: "demo-4",
    title: "Modern home, ready for move-in",
    type: "House",
    city: "Lahore",
    area: "Johar Town",
    size: "10 Marla",
    price: 165000,
    beds: 4,
    baths: 4,
    image: "photo-1600566753086-00f18fb6b3ea",
    owner: true,
    status: "Phone confirmed",
    listingStatus: "Sample listing",
    dealType: "rent",
    isLive: false,
    description: "Illustrative design-preview content only.",
    media: [],
    sizeValue: 10,
    sizeUnit: "Marla",
    createdAt: null,
  },
  {
    id: "demo-5",
    title: "Open-plan villa with garden",
    type: "House",
    city: "Karachi",
    area: "DHA Phase 8",
    size: "500 sq yd",
    price: 112000000,
    beds: 5,
    baths: 6,
    image: "photo-1600585154340-be6161a56a0c",
    owner: false,
    status: "Documents reviewed",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative design-preview content only.",
    media: [],
    sizeValue: 500,
    sizeUnit: "sq yd",
    createdAt: null,
  },
  {
    id: "demo-6",
    title: "A brighter kind of city living",
    type: "Apartment",
    city: "Islamabad",
    area: "F-11",
    size: "1,250 sq ft",
    price: 115000,
    beds: 2,
    baths: 2,
    image: "photo-1600607687920-4e2a09cf159d",
    owner: true,
    status: "Authority checked",
    listingStatus: "Sample listing",
    dealType: "rent",
    isLive: false,
    description: "Illustrative design-preview content only.",
    media: [],
    sizeValue: 1250,
    sizeUnit: "sq ft",
    createdAt: null,
  },
  {
    id: "demo-7",
    title: "Residential plot in a growing community",
    type: "Plot",
    city: "Islamabad",
    area: "B-17",
    size: "10 Marla",
    price: 18000000,
    beds: 0,
    baths: 0,
    image: "demo-property",
    owner: true,
    status: "Not verified",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative sample land listing. This example is not an offer or verified property information.",
    media: [],
    sizeValue: 10,
    sizeUnit: "Marla",
    createdAt: null,
  },
  {
    id: "demo-8",
    title: "Ground-floor retail space",
    type: "Commercial",
    city: "Karachi",
    area: "Gulshan-e-Iqbal",
    size: "1,200 sq ft",
    price: 24000000,
    beds: 0,
    baths: 1,
    image: "demo-property",
    owner: false,
    status: "Not verified",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative sample commercial listing. This example is not an offer or verified property information.",
    media: [],
    sizeValue: 1200,
    sizeUnit: "sq ft",
    createdAt: null,
  },
  {
    id: "demo-9",
    title: "Agricultural land near the city",
    type: "Agricultural",
    city: "Lahore",
    area: "Bedian Road",
    size: "2 Acres",
    price: 56000000,
    beds: 0,
    baths: 0,
    image: "demo-property",
    owner: true,
    status: "Not verified",
    listingStatus: "Sample listing",
    dealType: "buy",
    isLive: false,
    description: "Illustrative sample agricultural land listing. This example is not an offer or verified property information.",
    media: [],
    sizeValue: 2,
    sizeUnit: "Acres",
    createdAt: null,
  },
];

const categories = [
  { icon: "⌂", name: "Houses & villas", type: "House", count: "Family homes, villas and portions" },
  { icon: "▦", name: "Plots & land", type: "Plot", count: "Residential and agricultural land" },
  { icon: "▤", name: "Apartments", type: "Apartment", count: "Flats, studios and penthouses" },
  { icon: "▣", name: "Commercial", type: "Commercial", count: "Offices, shops and warehouses" },
  { icon: "⌖", name: "Agricultural", type: "Agricultural", count: "Farms and agricultural land" },
];

const services = [
  { icon: "✳", title: "Property verification", text: "Understand what was checked, when, and by whom." },
  { icon: "§", title: "Legal services", text: "Request property consultations with qualified professionals." },
  { icon: "▧", title: "Documents & drafting", text: "Get help preparing property agreements and paperwork." },
  { icon: "⌖", title: "Registry assistance", text: "Guidance for official records and transfer procedures." },
];

function Icon({
  name,
  size = 20,
}: {
  name: "search" | "pin" | "heart" | "arrow" | "menu" | "close" | "bed" | "bath" | "area" | "shield" | "chevron";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    heart: <path d="M20.8 8.6c0 4.7-8.8 10-8.8 10s-8.8-5.3-8.8-10a4.7 4.7 0 0 1 8.8-2.4 4.7 4.7 0 0 1 8.8 2.4Z" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    close: <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></>,
    bed: <><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" /><path d="M3 14h18" /><path d="M5 10V6h5v4" /><path d="M14 10V6h5v4" /><path d="M3 18v2" /><path d="M21 18v2" /></>,
    bath: <><path d="M9 6 7.5 4.5a2 2 0 0 0-3 2.5L6 9" /><path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2Z" /><path d="M7 19v2" /><path d="M17 19v2" /></>,
    area: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 4v3" /><path d="M15 4v3" /><path d="M4 9h3" /><path d="M4 15h3" /><path d="M20 9h-3" /><path d="M20 15h-3" /><path d="M9 20v-3" /><path d="M15 20v-3" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function money(value: number, deal: Deal) {
  if (deal === "Rent") return `PKR ${new Intl.NumberFormat("en-PK").format(value)} / month`;
  if (value >= 10000000) return `PKR ${(value / 10000000).toFixed(value % 10000000 ? 2 : 0)} Cr`;
  return `PKR ${new Intl.NumberFormat("en-PK").format(value)}`;
}

const favoriteStorageKey = "raqbo:favorites";
const favoriteChangeEvent = "raqbo:favorites-change";

function subscribeToFavorites(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(favoriteChangeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(favoriteChangeEvent, callback);
  };
}

function getFavoritesSnapshot() {
  try {
    return window.localStorage.getItem(favoriteStorageKey) ?? "[]";
  } catch {
    return "[]";
  }
}

function getServerFavoritesSnapshot() {
  return "[]";
}

export default function Home() {
  const router = useRouter();
  const [deal, setDeal] = useState<Deal>("Buy");
  const [city, setCity] = useState("");
  const [propertyType, setPropertyType] = useState("Any property");
  const [budget, setBudget] = useState("Any budget");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minBedrooms, setMinBedrooms] = useState("");
  const [minSize, setMinSize] = useState("");
  const [maxSize, setMaxSize] = useState("");
  const [sizeUnit, setSizeUnit] = useState("Marla");
  const [sort, setSort] = useState("newest");
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [searched, setSearched] = useState(false);
  const favoriteSnapshot = useSyncExternalStore(subscribeToFavorites, getFavoritesSnapshot, getServerFavoritesSnapshot);
  const favorites = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(favoriteSnapshot);
      return Array.isArray(parsed) && parsed.every((id) => typeof id === "number" || typeof id === "string")
        ? parsed.map(String)
        : [];
    } catch {
      return [];
    }
  }, [favoriteSnapshot]);
  const [liveProperties, setLiveProperties] = useState<Property[]>([]);
  const [listingPages, setListingPages] = useState(1);
  const [listingPage, setListingPage] = useState(1);
  const [listingTotal, setListingTotal] = useState(0);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);
  const listingRequestNumber = useRef(0);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [modal, setModal] = useState<"post" | "signin" | "service" | "property" | "inquiry" | "report" | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [pendingContact, setPendingContact] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [listingDraftId, setListingDraftId] = useState("");
  const [pendingListingDraft, setPendingListingDraft] = useState<ListingDraftPayload | null>(null);
  const [uploadedAssets, setUploadedAssets] = useState<{ id: string; assetType: PropertyMedia["assetType"]; reviewStatus: string; aiStatus: string }[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const currentSearch = useCallback((dealType = deal, category = propertyType): ListingSearch => ({
    dealType,
    city,
    propertyType: category,
    budget,
    minPrice,
    maxPrice,
    bedrooms: minBedrooms,
    minSize,
    maxSize,
    sizeUnit,
    ownerOnly,
    sort,
  }), [budget, city, deal, maxPrice, maxSize, minBedrooms, minPrice, minSize, ownerOnly, propertyType, sizeUnit, sort]);

  const fetchLiveListings = useCallback(async (page: number, append: boolean, filters: ListingSearch) => {
    const requestNumber = ++listingRequestNumber.current;
    const params = new URLSearchParams({ page: String(page), limit: "12", sort: filters.sort });
    params.set("deal_type", filters.dealType.toLowerCase());
    if (filters.city.trim()) params.set("q", filters.city.trim());
    if (filters.listingId) params.set("ids", filters.listingId);
    if (filters.propertyType !== "Any property") params.set("category", filters.propertyType);
    let budgetMin = "";
    let budgetMax = "";
    if (filters.dealType === "Rent") {
      if (filters.budget === "Under PKR 50,000") budgetMax = "49999";
      if (filters.budget === "PKR 50,000–100,000") { budgetMin = "50000"; budgetMax = "100000"; }
      if (filters.budget === "Above PKR 100,000") budgetMin = "100001";
    } else {
      if (filters.budget === "Under PKR 5 crore") budgetMax = "49999999";
      if (filters.budget === "PKR 5–10 crore") { budgetMin = "50000000"; budgetMax = "100000000"; }
      if (filters.budget === "Above PKR 10 crore") budgetMin = "100000001";
    }
    if (filters.minPrice || budgetMin) params.set("min_price", filters.minPrice || budgetMin);
    if (filters.maxPrice || budgetMax) params.set("max_price", filters.maxPrice || budgetMax);
    if (filters.bedrooms) params.set("bedrooms", filters.bedrooms);
    if (filters.minSize) params.set("min_size", filters.minSize);
    if (filters.maxSize) params.set("max_size", filters.maxSize);
    if (filters.minSize || filters.maxSize) params.set("size_unit", filters.sizeUnit);
    if (filters.ownerOnly) params.set("owner_only", "true");

    try {
      const response = await fetch(`/api/listings?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { listings?: unknown[]; pages?: number; total?: number; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Live properties could not be loaded.");
      if (requestNumber !== listingRequestNumber.current) return;
      const rows = Array.isArray(payload.listings) ? payload.listings : [];
      const mapped: Property[] = rows.flatMap((row) => {
        if (typeof row !== "object" || row === null) return [];
        const item = row as Record<string, unknown>;
        const required = ["id", "title", "category", "city", "locality", "size", "description", "dealType", "ownershipType", "verificationStatus"];
        if (required.some((key) => typeof item[key] !== "string") ||
          typeof item.pricePkr !== "number" || !Array.isArray(item.media)) return [];
        const media = item.media.filter((asset): asset is PropertyMedia =>
          typeof asset === "object" && asset !== null &&
          typeof (asset as PropertyMedia).id === "string" &&
          ["property_photo", "property_video", "model_glb", "panorama"].includes((asset as PropertyMedia).assetType) &&
          typeof (asset as PropertyMedia).url === "string");
        const dealType = item.dealType === "rent" ? "rent" : item.dealType === "buy" ? "buy" : null;
        if (!dealType) return [];
        return [{
          id: item.id as string,
          title: item.title as string,
          type: item.category as string,
          city: item.city as string,
          area: item.locality as string,
          size: item.size as string,
          price: item.pricePkr,
          beds: typeof item.bedrooms === "number" ? item.bedrooms : 0,
          baths: typeof item.bathrooms === "number" ? item.bathrooms : 0,
          image: media.find((asset) => asset.assetType === "property_photo")?.url ??
            media.find((asset) => asset.assetType === "panorama")?.url ?? "",
          owner: item.ownershipType === "owner" || item.ownershipType === "co_owner",
          status: String(item.verificationStatus).replaceAll("_", " "),
          listingStatus: String(item.status ?? "live").replaceAll("_", " "),
          dealType,
          isLive: true,
          description: item.description as string,
          media,
          sizeValue: typeof item.sizeValue === "number" ? item.sizeValue : 0,
          sizeUnit: typeof item.sizeUnit === "string" ? item.sizeUnit : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
        }];
      });
      setLiveProperties((previous) => append ? [...previous, ...mapped] : mapped);
      setListingPage(page);
      setListingPages(payload.pages ?? 1);
      setListingTotal(payload.total ?? mapped.length);
      if (filters.listingId && mapped[0]) {
        setDeal(filters.dealType);
        setSearched(true);
        setSelectedProperty(mapped[0]);
        setModal("property");
      }
      setLoadingMoreListings(false);
    } catch (error) {
      if (requestNumber !== listingRequestNumber.current) return;
      setLoadingMoreListings(false);
      showToast(error instanceof Error ? error.message : "Live properties could not be loaded.");
    }
  }, [showToast]);

  const syncAccountFavorites = useCallback(async () => {
    const response = await fetch("/api/me/favorites", { cache: "no-store" });
    const payload = await response.json() as { listings?: { id: string }[]; message?: string; error?: string };
    if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Could not load saved properties.");
    let localIds: string[] = [];
    try {
      const localValue: unknown = JSON.parse(window.localStorage.getItem(favoriteStorageKey) ?? "[]");
      if (!Array.isArray(localValue) || !localValue.every((id) => typeof id === "string")) {
        throw new Error("Saved properties in this browser have an invalid format.");
      }
      localIds = localValue;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Saved properties in this browser could not be read.");
      throw error;
    }
    const serverIds = (payload.listings ?? []).map((listing) => listing.id);
    const serverSet = new Set(serverIds);
    const guestLiveIds = localIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id) && !serverSet.has(id));
    for (const id of guestLiveIds) {
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
    const merged = [...new Set([...serverIds, ...localIds])];
    window.localStorage.setItem(favoriteStorageKey, JSON.stringify(merged));
    window.dispatchEvent(new Event(favoriteChangeEvent));
  }, []);

  const visibleProperties = useMemo(() => {
    const available = liveProperties.length ? liveProperties : properties;
    const data = available.filter((property) => property.dealType === deal.toLowerCase());
    const filtered = data.filter((property) => {
      const locationMatches = !city || property.city.toLowerCase().includes(city.toLowerCase()) ||
        property.area.toLowerCase().includes(city.toLowerCase()) || property.title.toLowerCase().includes(city.toLowerCase());
      const typeMatches = propertyType === "Any property" ||
        property.type.toLowerCase() === propertyType.toLowerCase();
      const budgetMatches = budget === "Any budget" || (deal === "Rent"
        ? (budget === "Under PKR 50,000" ? property.price < 50000 :
          budget === "PKR 50,000–100,000" ? property.price >= 50000 && property.price <= 100000 :
            budget === "Above PKR 100,000" ? property.price > 100000 : true)
        : (budget === "Under PKR 5 crore"         ? property.price < 50000000 :
        budget === "PKR 5–10 crore" ? property.price >= 50000000 && property.price <= 100000000 :
          budget === "Above PKR 10 crore" ? property.price > 100000000 : true));
      return locationMatches && typeMatches && budgetMatches &&
        (!minPrice || property.price >= Number(minPrice)) &&
        (!maxPrice || property.price <= Number(maxPrice)) &&
        (!minBedrooms || property.beds >= Number(minBedrooms)) &&
        (!(minSize || maxSize) || property.sizeUnit === sizeUnit) &&
        (!minSize || property.sizeValue >= Number(minSize)) &&
        (!maxSize || property.sizeValue <= Number(maxSize)) &&
        (!ownerOnly || property.owner);
    });
    if (sort === "price_asc") filtered.sort((a, b) => a.price - b.price);
    else if (sort === "price_desc") filtered.sort((a, b) => b.price - a.price);
    else if (sort === "area_desc") filtered.sort((a, b) => b.sizeValue - a.sizeValue);
    return searched ? filtered : filtered.slice(0, 3);
  }, [budget, city, deal, liveProperties, maxPrice, maxSize, minBedrooms, minPrice, minSize, ownerOnly, propertyType, searched, sizeUnit, sort]);

  useEffect(() => {
    void import("@google/model-viewer");
    const shared = new URLSearchParams(window.location.search);
    const sharedListingId = shared.get("listing");
    const sharedDeal = shared.get("deal") === "rent" ? "Rent" : "Buy";
    window.queueMicrotask(() => {
      void fetchLiveListings(1, false, {
        dealType: sharedListingId ? sharedDeal : "Buy",
        city: "",
        propertyType: "Any property",
        budget: "Any budget",
        minPrice: "",
        maxPrice: "",
        bedrooms: "",
        minSize: "",
        maxSize: "",
        sizeUnit: "Marla",
        ownerOnly: false,
        sort: "newest",
        ...(sharedListingId ? { listingId: sharedListingId } : {}),
      });
    });
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ user: unknown }>)
      .then(async ({ user }) => {
        setSignedIn(Boolean(user));
        if (user) await syncAccountFavorites();
      })
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : "Could not check your account."));
  }, [fetchLiveListings, showToast, syncAccountFavorites]);

  useEffect(() => {
    if (modal !== "property" || !selectedProperty?.isLive || selectedProperty.verificationDetails) return;
    let active = true;
    fetch(`/api/listings/${encodeURIComponent(selectedProperty.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          listing?: { passport?: { checkType: string; status: string; scope: string; checkedAt: string | null; expiresAt: string | null; checkedBy?: string }[] };
          message?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Could not load verification details.");
        if (active) {
          setSelectedProperty((current) => current?.id === selectedProperty.id
            ? { ...current, verificationDetails: (payload.listing?.passport ?? []).map((item) => ({
              ...item,
              checkedBy: item.checkedBy || "RAQBO verification team",
            })) }
            : current);
        }
      })
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : "Could not load verification details."))
      .finally(() => { active = false; });
    return () => { active = false; };
  }, [modal, selectedProperty, showToast]);

  function toggleFavorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((favorite) => favorite !== id)
      : [...favorites, id];
    try {
      if (signedIn && /^[0-9a-f-]{36}$/i.test(id)) {
        const method = favorites.includes(id) ? "DELETE" : "POST";
        const url = method === "DELETE" ? `/api/me/favorites?listing_id=${encodeURIComponent(id)}` : "/api/me/favorites";
        const request = fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify({ listingId: id }) } : {}),
        });
        void request.then(async (response) => {
          if (!response.ok) {
            const result = await response.json() as { message?: string; error?: string };
            throw new Error(result.message ?? result.error ?? "Could not sync this saved property.");
          }
          window.localStorage.setItem(favoriteStorageKey, JSON.stringify(next));
          window.dispatchEvent(new Event(favoriteChangeEvent));
          showToast(next.includes(id) ? "Saved to your account" : "Removed from saved properties");
        }).catch((error: unknown) => showToast(error instanceof Error ? error.message : "Could not sync this saved property."));
        return;
      }
      window.localStorage.setItem(favoriteStorageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(favoriteChangeEvent));
      showToast(next.includes(id) ? "Saved to your favorites" : "Removed from your favorites");
    } catch {
      showToast("Your browser could not save this favorite.");
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearched(true);
    setLoadingMoreListings(false);
    void fetchLiveListings(1, false, currentSearch());
    document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });
  }

  function chooseDeal(nextDeal: Deal, scrollToResults = false) {
    setDeal(nextDeal);
    setBudget("Any budget");
    setSearched(false);
    void fetchLiveListings(1, false, { ...currentSearch(nextDeal), budget: "Any budget" });
    if (scrollToResults) document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });
  }

  function chooseCategory(category: string) {
    setPropertyType(category);
    setCity("");
    setSearched(true);
    void fetchLiveListings(1, false, { ...currentSearch(deal, category), city: "" });
    document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" });
  }

  async function shareSelectedProperty() {
    if (!selectedProperty) return;
    if (!selectedProperty.isLive) {
      showToast("Design-preview examples are not shareable live listings.");
      return;
    }
    const url = `${window.location.origin}/?listing=${encodeURIComponent(selectedProperty.id)}&deal=${selectedProperty.dealType}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: selectedProperty.title, text: `${selectedProperty.title} · ${selectedProperty.area}, ${selectedProperty.city}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast("Listing link copied.");
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") showToast("Could not share this listing.");
    }
  }

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProperty?.isLive) return;
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: selectedProperty.id,
          message: String(form.get("message") ?? ""),
          consent: form.get("consent") === "on",
        }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not send this message.");
      setModal("property");
      showToast("Your message was sent. You can review it later from your account.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not send this message.");
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selectedProperty?.isLive ? { listingId: selectedProperty.id } : {}),
          category: String(form.get("category") ?? ""),
          message: String(form.get("message") ?? ""),
          consent: form.get("consent") === "on",
        }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not submit this report.");
      setModal("property");
      showToast("Thank you. Your report has been sent for review.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not submit this report.");
    }
  }

  async function submitPhoneAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otpBusy) return;
    setOtpBusy(true);
    const form = new FormData(event.currentTarget);
    const phone = otpRequested ? otpPhone : String(form.get("phone") ?? "");
    try {
      const response = await fetch(otpRequested ? "/api/auth/otp/verify" : "/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(otpRequested
          ? { phone, code: String(form.get("code") ?? "") }
          : { phone, consent: form.get("consent") === "on" }),
      });
      const result = await response.json() as { message?: string; error?: string; developmentCode?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Phone verification failed.");
      if (otpRequested) {
        setOtpRequested(false);
        setOtpPhone("");
        setSignedIn(true);
        void syncAccountFavorites().catch((error: unknown) => showToast(error instanceof Error ? error.message : "Could not sync saved properties."));
        if (pendingListingDraft) {
          const draftResponse = await fetch("/api/listings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pendingListingDraft),
          });
          const draftResult = await draftResponse.json() as { id?: string; message?: string; error?: string };
          if (!draftResponse.ok) {
            setModal("post");
            throw new Error(draftResult.message ?? draftResult.error ?? "Phone verified, but your listing draft could not be saved. Please try again.");
          }
          if (!draftResult.id) throw new Error("The server did not return a draft ID.");
          setListingDraftId(draftResult.id);
          setUploadedAssets([]);
          setPendingListingDraft(null);
          setModal("post");
          showToast("Phone verified. Your property details are saved—now add photos and videos.");
        } else {
          setModal(null);
          if (pendingContact) {
            setPendingContact(false);
            setModal("inquiry");
          } else {
            showToast("Your phone has been verified and you are signed in.");
          }
        }
      } else {
        setOtpPhone(phone);
        setOtpRequested(true);
        showToast(result.developmentCode
          ? `Development code: ${result.developmentCode}`
          : result.message ?? "A verification code has been requested.");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Phone verification failed.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function submitServiceRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      city: String(form.get("city") ?? ""),
      serviceType: String(form.get("serviceType") ?? ""),
      message: String(form.get("message") ?? ""),
      consent: form.get("consent") === "on",
    };
    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not send this request.");
      setModal(null);
      showToast("Your request has been securely recorded. The RAQBO team will follow up after service operations are configured.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not send this request.");
    }
  }

  async function saveListingDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const payload: ListingDraftPayload = {
      dealType: value("dealType"),
      category: value("category"),
      ownershipType: value("ownershipType"),
      title: value("title"),
      description: value("description"),
      province: value("province"),
      city: value("city"),
      locality: value("locality"),
      sizeValue: Number(value("sizeValue")),
      sizeUnit: value("sizeUnit"),
      pricePkr: Number(value("pricePkr")),
      negotiable: form.get("negotiable") === "on",
      ...(value("bedrooms") ? { bedrooms: Number(value("bedrooms")) } : {}),
      ...(value("bathrooms") ? { bathrooms: Number(value("bathrooms")) } : {}),
    };
    setPendingListingDraft(payload);
    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { id?: string; message?: string; error?: string };
      if (response.status === 401) {
        setModal("signin");
        showToast("Sign in with a verified phone before saving a property draft.");
        return;
      }
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not save your listing.");
      if (!result.id) throw new Error("The server did not return a draft ID.");
      setListingDraftId(result.id);
      setUploadedAssets([]);
      setPendingListingDraft(null);
      showToast("Private draft saved. Add property photos and videos for admin review.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save your listing.");
    }
  }

  async function uploadPropertyMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listingDraftId || uploadBusy) return;
    setUploadBusy(true);
    try {
      const response = await fetch(`/api/listings/${listingDraftId}/3d-assets`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const result = await response.json() as {
        message?: string; error?: string;
        asset?: { id: string; assetType: PropertyMedia["assetType"]; reviewStatus: string; aiStatus: string };
      };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Media upload failed.");
      if (!result.asset) throw new Error("The server did not return the uploaded media.");
      const asset = result.asset;
      setUploadedAssets((assets) => [...assets, asset]);
      showToast(result.message ?? "Media uploaded for staff review.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Media upload failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function refreshUploadedAssets() {
    if (!listingDraftId) return;
    try {
      const response = await fetch(`/api/listings/${listingDraftId}/3d-assets`, { cache: "no-store" });
      const result = await response.json() as { assets?: { id: string; asset_type: PropertyMedia["assetType"]; review_status: string; ai_status: string }[]; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not refresh upload status.");
      setUploadedAssets((result.assets ?? []).map((asset) => ({
        id: asset.id,
        assetType: asset.asset_type,
        reviewStatus: asset.review_status,
        aiStatus: asset.ai_status,
      })));
      showToast("Upload status refreshed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not refresh upload status.");
    }
  }

  async function submitListingForReview() {
    if (!listingDraftId) return;
    try {
      const response = await fetch(`/api/listings/${listingDraftId}/submit`, { method: "POST" });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not submit listing.");
      setModal(null);
      setListingDraftId("");
      showToast("Listing submitted for staff review.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not submit listing.");
    }
  }

  async function removePropertyMedia(assetId: string) {
    try {
      const response = await fetch(`/api/3d-assets/${assetId}`, { method: "DELETE" });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Could not remove this upload.");
      setUploadedAssets((assets) => assets.filter((asset) => asset.id !== assetId));
      showToast("Upload removed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not remove this upload.");
    }
  }

  return (
    <main id="main-content">
      <a className="skip-link" href="#properties">Skip to property listings</a>
      <div className="announcement">
        <div className="container announcement-inner">
          <span><span className="announcement-dot" /> A better way to find property in Pakistan</span>
          <span className="announcement-note">Browse freely. Connect directly.</span>
        </div>
      </div>

      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" aria-label="RAQBO homepage">
            <span className="brand-mark">r</span>
            <span className="brand-word">raqbo<span>.</span><small>PROPERTY, WITH CLARITY</small></span>
          </a>
          <button
            className="mobile-menu-button"
            aria-label={mobileMenu ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Icon name={mobileMenu ? "close" : "menu"} />
          </button>
          <nav className={`main-nav ${mobileMenu ? "is-open" : ""}`} aria-label="Main navigation">
            <a href="#properties" onClick={() => { chooseDeal("Buy"); setMobileMenu(false); }}>Buy</a>
            <a href="#properties" onClick={() => { chooseDeal("Rent"); setMobileMenu(false); }}>Rent</a>
            <a href="#direct" onClick={() => setMobileMenu(false)}>RAQBO Direct</a>
            <a href="#services" onClick={() => setMobileMenu(false)}>Services <Icon name="chevron" size={14} /></a>
            <a href="#about" onClick={() => setMobileMenu(false)}>About</a>
            <a href="/saved" onClick={() => setMobileMenu(false)}>Saved properties</a>
            <a href="/account" onClick={() => setMobileMenu(false)}>My account</a>
          </nav>
          <div className="nav-actions">
            <button className="sign-in-button" onClick={() => {
              if (signedIn) router.push("/account");
              else setModal("signin");
            }}>{signedIn ? "My account" : "Sign in"}</button>
            <button className="button button-dark nav-post" onClick={() => { setListingDraftId(""); setUploadedAssets([]); setModal("post"); }}>List your property <Icon name="arrow" size={16} /></button>
          </div>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="hero-image" aria-hidden="true" />
        <div className="hero-shade" />
        <div className="container hero-content">
          <div className="hero-copy">
            <div className="eyebrow eyebrow-light"><span /> PAKISTAN PROPERTY, MADE PERSONAL</div>
            <h1>Find a place<br />that feels like <em>yours.</em></h1>
            <p>Thoughtful property search, direct conversations and clearer information—so your next move feels more like your own.</p>
            <div className="hero-proof">
              <span><Icon name="shield" size={17} /> Clear listing status</span>
              <i />
              <span>Built around Pakistan</span>
            </div>
          </div>

          <form className="search-panel" onSubmit={search}>
            <div className="search-tabs" role="tablist" aria-label="Property deal type">
              {(["Buy", "Rent"] as Deal[]).map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={deal === item}
                  className={deal === item ? "active" : ""}
                  key={item}
                  onClick={() => chooseDeal(item, true)}
                >
                  {item}
                </button>
              ))}
              <button type="button" className="coming-tab" onClick={() => showToast("New projects are coming soon.")}>New projects</button>
            </div>
            <label className="search-location">
              <span><Icon name="pin" size={18} /> Location</span>
              <input aria-label="City or neighborhood" value={city} onChange={(event) => setCity(event.target.value)} placeholder="City, area, society or listing" />
            </label>
            <div className="search-selects">
              <label>
                <span>Property type</span>
                <select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}>
                  <option>Any property</option>
                  <option>House</option>
                  <option>Apartment</option>
                  <option>Plot</option>
                  <option>Commercial</option>
                  <option>Agricultural</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                <span>Budget</span>
                <select value={budget} onChange={(event) => setBudget(event.target.value)}>
                  <option>Any budget</option>
                  {deal === "Rent" ? <>
                    <option>Under PKR 50,000</option>
                    <option>PKR 50,000–100,000</option>
                    <option>Above PKR 100,000</option>
                  </> : <>
                    <option>Under PKR 5 crore</option>
                    <option>PKR 5–10 crore</option>
                    <option>Above PKR 10 crore</option>
                  </>}
                </select>
              </label>
            </div>
            <label className="owner-check">
              <input type="checkbox" checked={ownerOnly} onChange={(event) => setOwnerOnly(event.target.checked)} />
              <span className="checkmark" />
              Direct owner listings only
            </label>
            <div className="search-extra">
              <label>Minimum price (PKR)<input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="No minimum" /></label>
              <label>Maximum price (PKR)<input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="No maximum" /></label>
              <label>Bedrooms<select value={minBedrooms} onChange={(event) => setMinBedrooms(event.target.value)}><option value="">Any</option>{[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>{number}+ bedrooms</option>)}</select></label>
              <label>Size unit<select value={sizeUnit} onChange={(event) => setSizeUnit(event.target.value)}><option>Marla</option><option>Kanal</option><option>sq ft</option><option>sq yd</option><option>Acres</option></select></label>
              <label>Minimum size<input type="number" min="0" step="any" value={minSize} onChange={(event) => setMinSize(event.target.value)} placeholder="Any" /></label>
              <label>Maximum size<input type="number" min="0" step="any" value={maxSize} onChange={(event) => setMaxSize(event.target.value)} placeholder="Any" /></label>
            </div>
            <button className="button button-primary search-submit" type="submit"><Icon name="search" size={18} /> Find a property</button>
            <div className="search-caption"><span>⌖</span> Search live listings across Pakistan</div>
          </form>
        </div>
        <div className="hero-bottom">
          <div className="container hero-bottom-inner">
            <span>MADE FOR YOUR NEXT CHAPTER</span>
            <span className="hero-scroll">SCROLL TO EXPLORE <span>↓</span></span>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="RAQBO principles">
        <div className="container trust-strip-inner">
          <div><span className="trust-icon">01</span><span><b>Browse on your terms</b><small>No account needed to explore</small></span></div>
          <div><span className="trust-icon">02</span><span><b>Know what was checked</b><small>Statuses with clear meanings</small></span></div>
          <div><span className="trust-icon">03</span><span><b>Talk directly</b><small>Connect with the advertiser</small></span></div>
        </div>
      </section>

      <section className="section property-section" id="properties">
        <div className="container">
          <div className="section-heading heading-row">
            <div>
              <div className="eyebrow"><span /> A GOOD PLACE TO BEGIN</div>
                  <h2>{searched ? "Properties for your search" : "A few places worth a look."}</h2>
                  <p>{searched
                    ? `${liveProperties.length ? listingTotal : visibleProperties.length} ${deal.toLowerCase()} listing${(liveProperties.length ? listingTotal : visibleProperties.length) === 1 ? "" : "s"} found.`
                    : "A considered selection to help you picture what comes next."}</p>
            </div>
            <label className="sort-control">Sort by
              <select value={sort} onChange={(event) => {
                const nextSort = event.target.value;
                setSort(nextSort);
                const searchState = { ...currentSearch(), sort: nextSort, city: "", propertyType: "Any property", budget: "Any budget", minPrice: "", maxPrice: "", bedrooms: "", minSize: "", maxSize: "", ownerOnly: false };
                setCity(""); setPropertyType("Any property"); setBudget("Any budget"); setMinPrice(""); setMaxPrice(""); setMinBedrooms(""); setMinSize(""); setMaxSize(""); setOwnerOnly(false);
                setSearched(true);
                void fetchLiveListings(1, false, searchState);
              }}>
                <option value="newest">Newest first</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="area_desc">Largest area</option>
                <option value="recently_confirmed">Recently checked</option>
              </select>
            </label>
            <button className="text-link" onClick={() => {
              const filters = { ...currentSearch(), city: "", propertyType: "Any property", budget: "Any budget", minPrice: "", maxPrice: "", bedrooms: "", minSize: "", maxSize: "", ownerOnly: false };
              setSearched(true); setCity(""); setPropertyType("Any property"); setBudget("Any budget"); setOwnerOnly(false);
              setMinPrice(""); setMaxPrice(""); setMinBedrooms(""); setMinSize(""); setMaxSize("");
              void fetchLiveListings(1, false, filters);
            }}>
              Explore all properties <Icon name="arrow" size={17} />
            </button>
          </div>
          <div className="property-grid">
            {visibleProperties.map((property) => (
              <article
                className="property-card"
                key={property.id}
                id={`listing-${property.id}`}
                tabIndex={0}
                aria-label={`View ${property.title}`}
                onClick={() => { setSelectedProperty(property); setModal("property"); }}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    setSelectedProperty(property);
                    setModal("property");
                  }
                }}
              >
                <div className="property-image" style={{ backgroundImage: property.isLive
                  ? property.image ? `url("${property.image}")` : "linear-gradient(145deg, #274a55, #85b7a4)"
                  : "url('/property-placeholder.svg')" }}>
                  <span className="image-label">{property.dealType === "rent" ? "FOR RENT" : "FOR SALE"}</span>
                  <span className="verification-pill">{property.status}</span>
                  {property.owner && <span className="owner-label"><span /> DIRECT OWNER</span>}
                  {property.media.some((asset) => asset.assetType === "property_video")
                    ? <span className="tour-label">VIDEO TOUR</span>
                    : property.media.some((asset) => asset.assetType === "model_glb" || asset.assetType === "panorama")
                      ? <span className="tour-label">3D TOUR</span>
                      : null}
                  <button
                    className={`favorite-button ${favorites.includes(property.id) ? "is-favorite" : ""}`}
                    aria-label={favorites.includes(property.id) ? "Remove from saved properties" : "Save property"}
                    aria-pressed={favorites.includes(property.id)}
                    onClick={(event) => { event.stopPropagation(); toggleFavorite(property.id); }}
                  ><Icon name="heart" size={19} /></button>
                </div>
                <div className="property-info">
                  <div className="property-location"><Icon name="pin" size={14} /> {property.area}, {property.city}</div>
                  <h3>{property.title}</h3>
                  <small className="listing-status-line">{property.listingStatus}{property.createdAt ? ` · Listed ${new Date(property.createdAt).toLocaleDateString()}` : ""}</small>
                  <div className="property-specs">
                    {property.beds > 0 && <span><Icon name="bed" size={15} /> {property.beds} beds</span>}
                    {property.baths > 0 && <span><Icon name="bath" size={15} /> {property.baths} baths</span>}
                    <span><Icon name="area" size={15} /> {property.size}</span>
                  </div>
                  <div className="property-card-bottom">
                    <div className="property-price">{money(property.price, property.dealType === "rent" ? "Rent" : "Buy")}<small>{property.dealType === "rent" ? "RENTAL PRICE" : "ASKING PRICE"}</small></div>
                    <button className="details-button" onClick={(event) => { event.stopPropagation(); setSelectedProperty(property); setModal("property"); }}>View listing <Icon name="arrow" size={14} /></button>
                  </div>
                </div>
              </article>
            ))}
            {visibleProperties.length === 0 && (
              <div className="empty-results">
                <span>⌕</span>
                <h3>{liveProperties.length ? "No properties match those filters" : "No matching sample properties"}</h3>
                <p>{liveProperties.length ? "Try another location, property type or budget." : "Try another location or budget. These examples are for preview only."}</p>
                <button className="button button-dark" onClick={() => {
                  const filters = { ...currentSearch(), city: "", propertyType: "Any property", budget: "Any budget", minPrice: "", maxPrice: "", bedrooms: "", minSize: "", maxSize: "", ownerOnly: false };
                  setCity(""); setBudget("Any budget"); setOwnerOnly(false); setPropertyType("Any property");
                  setMinPrice(""); setMaxPrice(""); setMinBedrooms(""); setMinSize(""); setMaxSize("");
                  setSearched(true);
                  void fetchLiveListings(1, false, filters);
                }}>Clear filters</button>
              </div>
            )}
          </div>
          {!liveProperties.length && <p className="demo-disclaimer">Illustrative sample listings for design preview only. Not live inventory. Prices, locations and status are not offers or verified property information.</p>}
          {liveProperties.length > 0 && searched && listingPage < listingPages && <button
            className="button button-dark load-more-button"
            disabled={loadingMoreListings}
            onClick={() => {
              setLoadingMoreListings(true);
              void fetchLiveListings(listingPage + 1, true, currentSearch());
            }}
          >{loadingMoreListings ? "Loading…" : "Load more properties"}</button>}
        </div>
      </section>

      <section className="immersive-section">
        <div className="container immersive-layout">
          <div className="immersive-copy">
            <div className="eyebrow eyebrow-light"><span /> STEP INSIDE BEFORE YOU VISIT</div>
            <h2>Explore a property<br />from every angle.</h2>
            <p>Approved 3D models and 360° tours let you look around at your own pace, right from your screen.</p>
            <ul>
              <li><span>01</span> Rotate a 3D home model</li>
              <li><span>02</span> Look around a 360° panorama</li>
              <li><span>03</span> See which tours have passed review</li>
            </ul>
            <button className="button button-light" onClick={() => { setListingDraftId(""); setUploadedAssets([]); setModal("post"); }}>Add a 3D tour <Icon name="arrow" size={16} /></button>
            <small>AI tour generation and media suggestions stay off until RAQBO approves a provider and privacy terms.</small>
          </div>
          <div className="immersive-art" aria-label="Illustration of an interactive property tour">
            <div className="immersive-orbit immersive-orbit-one" />
            <div className="immersive-orbit immersive-orbit-two" />
            <div className="immersive-model"><span>360°</span><div className="model-roof" /><div className="model-house"><i /><i /><b /></div><div className="model-shadow" /></div>
            <div className="immersive-glass-card"><span>RAQBO IMMERSIVE</span><b>Explore before<br />you arrive.</b><small>Interactive property tours</small></div>
          </div>
        </div>
      </section>

      <section className="section category-section" id="categories">
        <div className="container">
          <div className="section-heading">
            <div className="eyebrow"><span /> FIND YOUR KIND OF PLACE</div>
            <h2>Start with what matters to you.</h2>
            <p>From a first apartment to a space for your next big idea.</p>
          </div>
          <div className="category-grid">
            {categories.map((category, index) => (
              <button className="category-card" key={category.name} onClick={() => chooseCategory(category.type)}>
                <span className="category-number">0{index + 1}</span>
                <span className="category-symbol">{category.icon}</span>
                <span className="category-name">{category.name}</span>
                <span className="category-count">{category.count}</span>
                <span className="category-arrow"><Icon name="arrow" size={18} /></span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="direct-section" id="direct">
        <div className="direct-photo" aria-hidden="true" />
        <div className="container direct-content">
          <div className="direct-card">
            <div className="eyebrow"><span /> A MORE PERSONAL WAY TO MOVE</div>
            <h2>Less middle.<br /><em>More conversation.</em></h2>
            <p>RAQBO Direct is designed for owners and appropriately authorized representatives. Ask a question, plan a viewing and have the conversation directly.</p>
            <ul>
              <li><span>✓</span> Advertiser role shown clearly</li>
              <li><span>✓</span> Freshness and check status displayed separately</li>
              <li><span>✓</span> No transaction commission on direct-owner deals</li>
            </ul>
            <button className="button button-dark" onClick={() => { setOwnerOnly(true); setSearched(true); document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" }); }}>
              Explore direct listings <Icon name="arrow" size={16} />
            </button>
            <small className="direct-note">A direct-owner label is not a guarantee of legal title.</small>
          </div>
          <div className="passport-card">
            <div className="passport-top"><span className="passport-symbol"><Icon name="shield" size={20} /></span><span>PROPERTY PASSPORT</span></div>
            <h3>Clear about what<br />we know—and don’t.</h3>
            <div className="passport-row"><span>Phone confirmed</span><b>Contact only</b></div>
            <div className="passport-row"><span>Authority checked</span><b>Evidence reviewed</b></div>
            <div className="passport-row"><span>Title guarantee</span><b className="not-checked">Not provided</b></div>
            <p>Each check has its own scope, date and limitations. No single badge tells the whole story.</p>
          </div>
        </div>
      </section>

      <section className="section service-section" id="services">
        <div className="container">
          <div className="section-heading heading-row">
            <div>
              <div className="eyebrow"><span /> SUPPORT BEYOND THE SEARCH</div>
              <h2>Property help, when you need it.</h2>
              <p>Explore professional assistance for the steps that come after finding a place.</p>
            </div>
            <button className="text-link" onClick={() => setModal("service")}>Explore all services <Icon name="arrow" size={17} /></button>
          </div>
          <div className="service-grid">
            {services.map((service, index) => (
              <button className="service-card" key={service.title} onClick={() => setModal("service")}>
                <span className="service-card-top"><span className="service-icon">{service.icon}</span><span>0{index + 1}</span></span>
                <h3>{service.title}</h3>
                <p>{service.text}</p>
                <span className="service-link">Make an enquiry <Icon name="arrow" size={15} /></span>
              </button>
            ))}
          </div>
          <p className="service-disclaimer">Services depend on location, professional availability and required approvals. RAQBO is not a government authority; legal work is handled by appropriately qualified professionals.</p>
        </div>
      </section>

      <section className="how-section" id="about">
        <div className="container how-inner">
          <div className="how-intro">
            <div className="eyebrow eyebrow-light"><span /> GOOD DECISIONS TAKE CLARITY</div>
            <h2>From the first search<br />to the next step.</h2>
            <p>Property is personal. We believe the experience should feel informed, human and clear at every turn.</p>
            <button className="button button-light" onClick={() => setModal("service")}>Talk to our team <Icon name="arrow" size={16} /></button>
          </div>
          <div className="steps-list">
            <div><span>01</span><div><h3>Explore</h3><p>Browse without an account and find the details that matter.</p></div></div>
            <div><span>02</span><div><h3>Connect</h3><p>Start a conversation with the owner or authorized advertiser.</p></div></div>
            <div><span>03</span><div><h3>Understand</h3><p>See what has been checked and ask for help when you need it.</p></div></div>
            <div><span>04</span><div><h3>Move forward</h3><p>Make your decisions directly with the relevant people and professionals.</p></div></div>
          </div>
        </div>
      </section>

      <section className="section faq-section" id="faq">
        <div className="container faq-layout">
          <div className="section-heading">
            <div className="eyebrow"><span /> THE IMPORTANT DETAILS</div>
            <h2>Good questions<br />deserve clear answers.</h2>
            <p>Property decisions are big. Here are a few things worth knowing.</p>
          </div>
          <div className="faq-list">
            <details><summary>Does RAQBO guarantee a property&apos;s legal title?<Icon name="chevron" size={18} /></summary><p>No. Any check should describe its scope and limits. Identity, authority, document reviews and an independent legal opinion are distinct things.</p></details>
            <details><summary>Can I browse without creating an account?<Icon name="chevron" size={18} /></summary><p>Yes. The intended website allows visitors to explore public listings without signing in. Contacting an advertiser may require a verified account.</p></details>
            <details><summary>Does RAQBO charge commission on direct-owner deals?<Icon name="chevron" size={18} /></summary><p>The supplied project brief proposes no transaction commission for direct-owner deals. Optional advertising and professional services may have separate disclosed fees.</p></details>
            <details><summary>Does RAQBO handle property deposits or token money?<Icon name="chevron" size={18} /></summary><p>No. The proposed MVP does not collect buyer deposits, hold transaction money or provide property escrow.</p></details>
          </div>
        </div>
      </section>

      <section className="closing-cta">
        <div className="container closing-inner">
          <div><div className="eyebrow eyebrow-light"><span /> YOUR NEXT MOVE STARTS HERE</div><h2>Have a place in mind?</h2><p>Start looking. Your next chapter might be closer than you think.</p></div>
          <button className="button button-light" onClick={() => { document.getElementById("home")?.scrollIntoView({ behavior: "smooth" }); }}>Find your place <Icon name="arrow" size={16} /></button>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-main">
            <div className="footer-brand-block">
              <a className="brand footer-brand" href="#home"><span className="brand-mark">r</span><span className="brand-word">raqbo<span>.</span><small>PROPERTY, WITH CLARITY</small></span></a>
              <p>A more thoughtful way to find property and take your next step.</p>
            </div>
            <div className="footer-column"><h3>Explore</h3><a href="#properties">Buy property</a><a href="#properties" onClick={() => setDeal("Rent")}>Rent property</a><a href="#direct">RAQBO Direct</a><a href="#categories">Property types</a></div>
            <div className="footer-column"><h3>Services</h3><a href="#services">Verification</a><a href="#services">Legal services</a><a href="#services">Document drafting</a><a href="#services">Registry assistance</a></div>
            <div className="footer-column"><h3>RAQBO</h3><a href="#about">About us</a><a href="#faq">FAQs</a><button onClick={() => setModal("service")}>Contact</button><Link href="/saved">Saved properties</Link><Link href="/account">My account</Link><Link href="/privacy">Privacy notice draft</Link><Link href="/terms">Terms draft</Link></div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 RAQBO. A private property marketplace.</span>
            <span>Property listings are advertiser content. RAQBO is not a government registry.</span>
            <span>Built for Pakistan <b>✳</b></span>
          </div>
        </div>
      </footer>

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <a href="#home"><span>⌂</span>Home</a>
        <a href="#properties"><span><Icon name="search" size={18} /></span>Search</a>
        <button onClick={() => { setListingDraftId(""); setUploadedAssets([]); setModal("post"); }}><span>＋</span>Post</button>
        <a href="/saved"><span><Icon name="heart" size={18} /></span>Saved</a>
        <button onClick={() => { if (signedIn) router.push("/account"); else setModal("signin"); }}><span>◉</span>Account</button>
      </nav>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setPendingContact(false);
            setModal(null);
          }
        }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" aria-label="Close dialog" onClick={() => { setPendingContact(false); setModal(null); }}><Icon name="close" /></button>
            <div className="eyebrow"><span /> RAQBO</div>
            {modal === "post" && (listingDraftId ? <>
              <h2 id="modal-title">Add property photos and videos.</h2>
              <p className="modal-lead">Your draft and uploads stay private until an admin reviews and approves the listing. Add at least one photo; videos and 3D tours are optional.</p>
              <form className="modal-form" onSubmit={uploadPropertyMedia}>
                <label>Media type<select name="assetType" defaultValue="property_photo"><option value="property_photo">Property photo (.jpg or .webp)</option><option value="property_video">Property video (.mp4)</option><option value="model_glb">3D model (.glb)</option><option value="panorama">360° panorama (.jpg or .webp)</option></select></label>
                <label>Choose a file<input name="asset" type="file" accept=".glb,.jpg,.jpeg,.mp4,.webp,model/gltf-binary,image/jpeg,image/webp,video/mp4" required /></label>
                <label className="consent-check"><input name="rightsConfirmed" type="checkbox" required value="true" /> I own or have permission to upload this media, and it contains no private documents or location details.</label>
                <button className="button button-primary modal-submit" type="submit" disabled={uploadBusy}>{uploadBusy ? "Uploading…" : "Upload for review"} <Icon name="arrow" size={16} /></button>
                <small>Photos: 10 MB. MP4 videos: 50 MB. 3D models: 25 MB. Panoramas: 20 MB and approximately 2:1. Image metadata is removed.</small>
              </form>
              {uploadedAssets.map((asset) => (
                <div className="uploaded-tour" key={asset.id}>
                  <div className="uploaded-tour-meta"><b>{asset.assetType === "model_glb" ? "Interactive 3D model" : asset.assetType === "panorama" ? "360° panorama" : asset.assetType === "property_video" ? "Property video" : "Property photo"}</b><span>{asset.reviewStatus.replaceAll("_", " ")}</span></div>
                  {asset.assetType === "model_glb"
                    ? <model-viewer src={`/api/3d-assets/${asset.id}/file`} camera-controls auto-rotate shadow-intensity="1" aria-label="Private 3D model preview" />
                    : asset.assetType === "panorama"
                      ? <PanoramaViewer src={`/api/3d-assets/${asset.id}/file`} label="Private panorama preview" />
                      : asset.assetType === "property_video"
                        ? <video className="uploaded-property-video" src={`/api/3d-assets/${asset.id}/file`} controls preload="metadata" aria-label="Private property video preview" />
                        : <Image className="uploaded-property-photo" src={`/api/3d-assets/${asset.id}/file`} alt="Private property photo preview" width={960} height={600} unoptimized />}
                  <small>Private preview for you and authorized reviewers only.</small>
                  {asset.reviewStatus !== "approved" && <button className="report-button" type="button" onClick={() => void removePropertyMedia(asset.id)}>Remove upload</button>}
                </div>
              ))}
              {uploadedAssets.length > 0 && <div className="listing-review-actions">
                <button className="report-button" type="button" onClick={() => void refreshUploadedAssets()}>Refresh review status</button>
                {uploadedAssets.some((asset) => asset.assetType === "property_photo" && asset.reviewStatus !== "rejected") && <button className="button button-primary" type="button" onClick={() => void submitListingForReview()}>Submit listing and media for review <Icon name="arrow" size={15} /></button>}
              </div>}
              <p className="ai-disabled-note">AI tour generation and listing suggestions are disabled. They will require a client-approved provider and explicit media-processing consent.</p>
            </> : <>
              <h2 id="modal-title">Start with your property.</h2>
              <p className="modal-lead">Save a private draft. It will not be published until photos, identity and moderation checks are complete.</p>
              <form className="modal-form" onSubmit={saveListingDraft}>
                <label>Listing title<input name="title" required minLength={10} maxLength={120} placeholder="A short, accurate property title" /></label>
                <label>Description<textarea name="description" required minLength={20} maxLength={4000} rows={3} placeholder="Describe the property and its condition. Do not include private documents." /></label>
                <div className="modal-form-row">
                  <label>For<select name="dealType" defaultValue="buy"><option value="buy">Sale</option><option value="rent">Rent</option></select></label>
                  <label>Property type<select name="category" defaultValue="House"><option>House</option><option>Apartment</option><option>Plot</option><option>Commercial</option><option>Agricultural</option><option>Other</option></select></label>
                </div>
                <div className="modal-form-row">
                  <label>Advertiser role<select name="ownershipType" defaultValue="owner"><option value="owner">Owner</option><option value="co_owner">Co-owner</option><option value="authorized_representative">Authorized representative</option></select></label>
                  <label>Province<input name="province" required minLength={2} defaultValue="Punjab" /></label>
                </div>
                <div className="modal-form-row"><label>City<input name="city" required minLength={2} placeholder="e.g. Lahore" /></label><label>Area / locality<input name="locality" required minLength={2} placeholder="e.g. DHA Phase 6" /></label></div>
                <div className="modal-form-row">
                  <label>Size<input name="sizeValue" required type="number" min="0.01" step="any" /></label>
                  <label>Size unit<select name="sizeUnit" defaultValue="Marla"><option>Marla</option><option>Kanal</option><option>sq ft</option><option>sq yd</option><option>Acres</option></select></label>
                </div>
                <label>Price (PKR)<input name="pricePkr" required type="number" min="1" step="1" /></label>
                <div className="modal-form-row"><label>Bedrooms (optional)<input name="bedrooms" type="number" min="0" max="50" /></label><label>Bathrooms (optional)<input name="bathrooms" type="number" min="0" max="50" /></label></div>
                <label className="consent-check"><input name="negotiable" type="checkbox" /> Price is negotiable</label>
                <button className="button button-primary modal-submit" type="submit">Save draft <Icon name="arrow" size={16} /></button>
                <small>Your draft is private. Add at least one property photo, then submit the listing and its photos/videos for admin review.</small>
              </form>
            </>)}
            {modal === "signin" && <>
              <h2 id="modal-title">Welcome to RAQBO.</h2>
              <p className="modal-lead">{pendingListingDraft
                ? "Verify your phone to save your property details. After verification, you will continue directly to photo and video uploads."
                : "Verify your phone to access account features. Live SMS delivery is not configured."}</p>
              <form className="modal-form" onSubmit={submitPhoneAuth}>
                <label>Mobile number<input name="phone" required type="tel" disabled={otpRequested} defaultValue={otpPhone} placeholder="+92 3XX XXXXXXX" /></label>
                {!otpRequested && <label className="consent-check"><input name="consent" type="checkbox" required /> I agree to receive a verification code by SMS.</label>}
                {otpRequested && <label>6-digit verification code<input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>}
                <button className="button button-primary modal-submit" type="submit" disabled={otpBusy}>{otpBusy ? "Please wait…" : otpRequested ? "Verify and sign in" : "Send verification code"} <Icon name="arrow" size={16} /></button>
                {otpRequested && <button className="report-button" type="button" onClick={() => { setOtpRequested(false); setOtpPhone(""); }}>Use another number</button>}
                <small>Development mode displays a test code in this browser. Production SMS requires an approved provider.</small>
              </form>
            </>}
            {modal === "service" && <>
              <h2 id="modal-title">How can we help?</h2>
              <p className="modal-lead">Share a few details and the right team can guide your next step.</p>
              <form className="modal-form" onSubmit={submitServiceRequest}>
                <label>Your name<input name="name" required minLength={2} maxLength={100} placeholder="Full name" /></label>
                <label>Mobile number<input name="phone" required type="tel" minLength={8} maxLength={24} placeholder="+92 3XX XXXXXXX" /></label>
                <label>City<input name="city" required minLength={2} maxLength={100} placeholder="e.g. Lahore" /></label>
                <label>What do you need help with?<select name="serviceType" defaultValue="" required><option value="" disabled>Select a service</option><option value="property_verification">Property verification</option><option value="legal_consultation">Legal consultation</option><option value="document_drafting">Document drafting</option><option value="registry_assistance">Registry assistance</option><option value="valuation_or_survey">Property valuation or survey</option><option value="other">Other</option></select></label>
                <label>Short message<textarea name="message" required minLength={10} maxLength={2000} rows={3} placeholder="Tell us what you need (please do not include sensitive documents)" /></label>
                <label className="consent-check"><input name="consent" type="checkbox" required /> I agree that RAQBO may use my details to respond to this request.</label>
                <button className="button button-primary modal-submit" type="submit">Send enquiry <Icon name="arrow" size={16} /></button>
                <small>Your contact number is encrypted at rest. Do not send sensitive identity or title documents here.</small>
              </form>
            </>}
            {modal === "property" && selectedProperty && <>
              <div className="detail-preview" style={{ backgroundImage: selectedProperty.isLive
                ? selectedProperty.image ? `url("${selectedProperty.image}")` : "linear-gradient(145deg, #274a55, #85b7a4)"
                : "url('/property-placeholder.svg')" }} />
              <div className="property-location"><Icon name="pin" size={14} /> {selectedProperty.area}, {selectedProperty.city}</div>
              <h2 id="modal-title">{selectedProperty.title}</h2>
              <div className="detail-price">{money(selectedProperty.price, selectedProperty.dealType === "rent" ? "Rent" : "Buy")}</div>
              {selectedProperty.sizeValue > 0 && <p className="price-per-unit">PKR {new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(selectedProperty.price / selectedProperty.sizeValue)} per {selectedProperty.sizeUnit}</p>}
              <p className="listing-status-line">Listing: {selectedProperty.listingStatus}{selectedProperty.createdAt ? ` · Listed ${new Date(selectedProperty.createdAt).toLocaleDateString()}` : ""}</p>
              <div className="detail-specs">
                {selectedProperty.beds > 0 && <span><Icon name="bed" size={16} /> {selectedProperty.beds} bedrooms</span>}
                {selectedProperty.baths > 0 && <span><Icon name="bath" size={16} /> {selectedProperty.baths} bathrooms</span>}
                <span><Icon name="area" size={16} /> {selectedProperty.size}</span>
              </div>
              <div className="detail-status"><Icon name="shield" size={17} /><span><b>Check status: {selectedProperty.status}</b><small>{selectedProperty.isLive ? "This reports the latest recorded verification stage only; it is not a title guarantee." : "This is an illustrative sample status, not a real check."}</small></span></div>
              {selectedProperty.verificationDetails?.map((check, index) => <div className="verification-detail" key={`${check.checkType}-${index}`}>
                <b>{check.checkType.replaceAll("_", " ")} · {check.status.replaceAll("_", " ")}</b>
                <span>{check.scope}</span>
                <small>Checked by {check.checkedBy}{check.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleDateString()}` : ""}{check.expiresAt ? ` · Expires ${new Date(check.expiresAt).toLocaleDateString()}` : ""}</small>
              </div>)}
              <p className="modal-lead">{selectedProperty.description}</p>
              {selectedProperty.media.length > 0 ? <div className="property-tour-viewers">
                <h3>Explore this property</h3>
                {selectedProperty.media.map((asset) => asset.assetType === "model_glb"
                  ? <model-viewer key={asset.id} src={asset.url} camera-controls auto-rotate aria-label="Interactive 3D property model" />
                  : asset.assetType === "panorama"
                    ? <PanoramaViewer key={asset.id} src={asset.url} label="Interactive 360 degree property panorama" />
                    : asset.assetType === "property_video"
                      ? <video key={asset.id} className="public-tour-video" src={asset.url} controls preload="metadata" aria-label="Property video" />
                      : <Image key={asset.id} className="public-tour-photo" src={asset.url} alt="Property" width={960} height={600} unoptimized />)}
              </div> : selectedProperty.isLive
                ? <p className="no-tour-note">No additional property photos, videos, or tours are available for this listing yet.</p>
                : <p className="detail-disclaimer">Illustrative sample listing only. Property, price and checks are not live or independently verified.</p>}
              <div className="detail-actions">
                {selectedProperty.isLive
                  ? <button className="button button-primary" onClick={() => {
                    if (signedIn) setModal("inquiry");
                    else { setPendingContact(true); setModal("signin"); }
                  }}>Message advertiser <Icon name="arrow" size={15} /></button>
                  : <button className="button button-primary" onClick={() => showToast("Messaging is available on live listings only.")}>Message advertiser <Icon name="arrow" size={15} /></button>}
                <button className="report-button" onClick={() => setModal("report")}>Report listing</button>
                <button className="report-button" onClick={() => void shareSelectedProperty()}>Share</button>
                <a className="report-button" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedProperty.area}, ${selectedProperty.city}`)}`} target="_blank" rel="noreferrer">Open map</a>
                <button className="report-button" onClick={() => {
                  if (!selectedProperty) return;
                  const filters = { ...currentSearch(selectedProperty.dealType === "rent" ? "Rent" : "Buy", selectedProperty.type), city: selectedProperty.city, budget: "Any budget", minPrice: "", maxPrice: "", bedrooms: "", minSize: "", maxSize: "", ownerOnly: false };
                  setDeal(filters.dealType); setCity(filters.city); setPropertyType(filters.propertyType); setBudget("Any budget"); setMinPrice(""); setMaxPrice(""); setMinBedrooms(""); setMinSize(""); setMaxSize(""); setOwnerOnly(false); setSearched(true); setModal(null);
                  void fetchLiveListings(1, false, filters);
                  window.setTimeout(() => document.getElementById("properties")?.scrollIntoView({ behavior: "smooth" }), 0);
                }}>More in {selectedProperty.city}</button>
              </div>
            </>}
            {modal === "inquiry" && selectedProperty && <form className="modal-form" onSubmit={submitInquiry}>
              <h2 id="modal-title">Message the advertiser</h2>
              <p className="modal-lead">Your message will be attached to “{selectedProperty.title}”. Your phone number is not shown publicly.</p>
              <label>Message<textarea name="message" required minLength={10} maxLength={2000} rows={5} placeholder="Ask a question or request a viewing." /></label>
              <label className="consent-check"><input name="consent" type="checkbox" required /> I agree that RAQBO may share this message with the listing advertiser so they can respond.</label>
              <button className="button button-primary modal-submit" type="submit">Send message <Icon name="arrow" size={16} /></button>
            </form>}
            {modal === "report" && <form className="modal-form" onSubmit={submitReport}>
              <h2 id="modal-title">Report this listing</h2>
              <p className="modal-lead">Reports are reviewed by the RAQBO moderation team.</p>
              <label>Reason<select name="category" defaultValue="" required><option value="" disabled>Choose a reason</option><option value="suspected_fraud">Suspected fraud</option><option value="agent_impersonating_owner">Advertiser misrepresents their role</option><option value="sold_or_unavailable">Sold or unavailable</option><option value="misleading_price">Misleading price</option><option value="stolen_photos">Stolen photos</option><option value="harassment">Harassment</option><option value="other">Other</option></select></label>
              <label>Details<textarea name="message" required minLength={10} maxLength={2000} rows={4} placeholder="Tell us what should be reviewed." /></label>
              <label className="consent-check"><input name="consent" type="checkbox" required /> I confirm this report is accurate to the best of my knowledge.</label>
              <button className="button button-primary modal-submit" type="submit">Submit report <Icon name="arrow" size={16} /></button>
            </form>}
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
