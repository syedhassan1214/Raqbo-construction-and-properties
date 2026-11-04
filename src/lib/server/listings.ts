import "server-only";

export type ListingRow = {
  id: string;
  creator_id: string | null;
  deal_type: string;
  category: string;
  subtype: string | null;
  ownership_type: string;
  title: string;
  description: string;
  province: string;
  city: string;
  locality: string;
  size_value: number;
  size_unit: string;
  price_pkr: number;
  negotiable: number;
  bedrooms: number | null;
  bathrooms: number | null;
  attributes_json: string;
  cover_image: string | null;
  status: string;
  verification_status: string;
  is_demo: number;
  confirmed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export function publicListing(row: ListingRow) {
  return {
    id: row.id,
    dealType: row.deal_type,
    category: row.category,
    subtype: row.subtype,
    ownershipType: row.ownership_type,
    title: row.title,
    description: row.description,
    province: row.province,
    city: row.city,
    locality: row.locality,
    sizeValue: row.size_value,
    sizeUnit: row.size_unit,
    size: `${new Intl.NumberFormat("en-PK").format(row.size_value)} ${row.size_unit}`,
    pricePkr: row.price_pkr,
    negotiable: Boolean(row.negotiable),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    attributes: JSON.parse(row.attributes_json) as Record<string, unknown>,
    coverImage: row.cover_image,
    status: row.status,
    verificationStatus: row.verification_status,
    isDemo: Boolean(row.is_demo),
    lastConfirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
