import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import {
  errorResponse,
  HttpError,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
} from "@/lib/server/http";
import { listingSchema } from "@/lib/server/schemas";
import { publicListing, type ListingRow } from "@/lib/server/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const conditions = ["status = 'live'", "is_demo = 0"];
    const values: (string | number)[] = [];
    const exactFilters: [string, string][] = [
      ["deal_type", "deal_type"],
      ["category", "category"],
      ["province", "province"],
      ["city", "city"],
      ["size_unit", "size_unit"],
      ["verification_status", "verification_status"],
    ];

    const ids = params.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
    if (ids.length > 0) {
      if (ids.length > 100 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
        throw new HttpError(400, "invalid_listing_ids", "Provide up to 100 valid listing IDs.");
      }
      conditions.push(`id IN (${ids.map(() => "?").join(", ")})`);
      values.push(...ids);
    }

    const query = params.get("q")?.trim();
    if (query && query.length > 200) {
      throw new HttpError(400, "query_too_long", "Search text must be 200 characters or fewer.");
    }
    if (query) {
      const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
      conditions.push("(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR city LIKE ? ESCAPE '\\' COLLATE NOCASE OR locality LIKE ? ESCAPE '\\' COLLATE NOCASE)");
      values.push(`%${escapedQuery}%`, `%${escapedQuery}%`, `%${escapedQuery}%`);
    }

    for (const [parameter, column] of exactFilters) {
      const value = params.get(parameter)?.trim();
      if (value) {
        conditions.push(`${column} = ? COLLATE NOCASE`);
        values.push(value);
      }
    }

    const locality = params.get("locality")?.trim();
    if (locality) {
      conditions.push("locality LIKE ? ESCAPE '\\' COLLATE NOCASE");
      values.push(`%${locality.replace(/[\\%_]/g, "\\$&")}%`);
    }
    function optionalNumber(name: string, integer: boolean) {
      if (!params.has(name)) return null;
      const raw = params.get(name)?.trim() ?? "";
      const number = Number(raw);
      if (!raw || !Number.isFinite(number) || number < 0 ||
        (integer && !Number.isSafeInteger(number))) {
        throw new HttpError(400, "invalid_search_filter", `${name} must be a non-negative ${integer ? "integer" : "number"}.`);
      }
      return number;
    }
    const minPrice = optionalNumber("min_price", true);
    if (minPrice !== null) {
      conditions.push("price_pkr >= ?");
      values.push(minPrice);
    }
    const maxPrice = optionalNumber("max_price", true);
    if (maxPrice !== null) {
      conditions.push("price_pkr <= ?");
      values.push(maxPrice);
    }
    const minBedrooms = optionalNumber("bedrooms", true);
    if (minBedrooms !== null) {
      conditions.push("bedrooms >= ?");
      values.push(minBedrooms);
    }
    const maxBedrooms = optionalNumber("max_bedrooms", true);
    if (maxBedrooms !== null) {
      conditions.push("bedrooms <= ?");
      values.push(maxBedrooms);
    }
    const minSize = optionalNumber("min_size", false);
    if (minSize !== null) {
      conditions.push("size_value >= ?");
      values.push(minSize);
    }
    const maxSize = optionalNumber("max_size", false);
    if (maxSize !== null) {
      conditions.push("size_value <= ?");
      values.push(maxSize);
    }
    if ((minPrice !== null && maxPrice !== null && minPrice > maxPrice) ||
      (minSize !== null && maxSize !== null && minSize > maxSize) ||
      (minBedrooms !== null && maxBedrooms !== null && minBedrooms > maxBedrooms)) {
      throw new HttpError(400, "invalid_search_range", "Minimum search values cannot exceed their maximum values.");
    }
    if (params.get("owner_only") === "true") {
      conditions.push("ownership_type IN ('owner', 'co_owner')");
    }

    const sorters: Record<string, string> = {
      newest: "created_at DESC",
      price_asc: "price_pkr ASC, created_at DESC",
      price_desc: "price_pkr DESC, created_at DESC",
      area_desc: "size_value DESC, created_at DESC",
      recently_confirmed: "confirmed_at DESC, created_at DESC",
    };
    const sort = sorters[params.get("sort") ?? "newest"];
    if (!sort) throw new HttpError(400, "invalid_sort", "Choose a supported listing sort.");

    const page = Math.max(1, Math.min(10_000, Number(params.get("page")) || 1));
    const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 12));
    const where = conditions.join(" AND ");
    const count = database
      .prepare(`SELECT COUNT(*) AS count FROM listings WHERE ${where}`)
      .get(...values) as { count: number };
    const items = database
      .prepare(`SELECT * FROM listings WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...values, limit, (page - 1) * limit) as ListingRow[];

    return json({
      listings: items.map((item) => {
        const media = database.prepare(`
          SELECT id, asset_type AS assetType
          FROM property_3d_assets
          WHERE listing_id = ? AND review_status = 'approved'
          ORDER BY created_at ASC
        `).all(item.id) as { id: string; assetType: string }[];
        return {
          ...publicListing(item),
          media: media.map((asset) => ({
          ...asset,
            url: `/api/3d-assets/${asset.id}/file`,
          })),
        };
      }),
      page,
      limit,
      total: count.count,
      pages: Math.ceil(count.count / limit),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["buyer", "owner"]);
    const body = await readJson(request, listingSchema);
    const id = randomUUID();
    database.prepare(`
      INSERT INTO listings (
        id, creator_id, deal_type, category, subtype, ownership_type, title, description,
        province, city, locality, size_value, size_unit, price_pkr, negotiable,
        bedrooms, bathrooms, attributes_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      id,
      user.id,
      body.dealType,
      body.category,
      body.subtype ?? null,
      body.ownershipType,
      body.title,
      body.description,
      body.province,
      body.city,
      body.locality,
      body.sizeValue,
      body.sizeUnit,
      body.pricePkr,
      body.negotiable ? 1 : 0,
      body.bedrooms ?? null,
      body.bathrooms ?? null,
      JSON.stringify(body.attributes),
    );
    if (user.role === "buyer") {
      database.prepare("UPDATE users SET role = 'owner', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
    }
    logAudit(user.id, "listing.draft_created", "listing", id);
    return json({ id, status: "draft", message: "Draft saved. Add approved photos before submitting for review." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
