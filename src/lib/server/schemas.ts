import { z } from "zod";

const name = z.string().trim().min(2).max(100);
const phone = z.string().trim().min(8).max(24);

export const otpSendSchema = z.object({
  phone,
  consent: z.literal(true, { error: "Contact consent is required." }),
});

export const otpVerifySchema = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  displayName: name.optional(),
});

export const adminBootstrapSchema = z.object({
  bootstrapKey: z.string().min(32).max(512),
  email: z.string().trim().email().max(254),
  password: z.string().min(14).max(128),
  displayName: name,
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const listingSchema = z.object({
  dealType: z.enum(["buy", "rent"]),
  category: z.enum(["House", "Apartment", "Plot", "Commercial", "Agricultural", "Other"]),
  subtype: z.string().trim().max(80).optional(),
  ownershipType: z.enum(["owner", "co_owner", "authorized_representative"]),
  title: z.string().trim().min(10).max(120),
  description: z.string().trim().min(20).max(4000),
  province: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(100),
  locality: z.string().trim().min(2).max(120),
  sizeValue: z.number().positive().max(10_000_000),
  sizeUnit: z.enum(["Marla", "Kanal", "sq ft", "sq yd", "Acres"]),
  pricePkr: z.number().int().positive().max(100_000_000_000),
  negotiable: z.boolean().default(false),
  bedrooms: z.number().int().min(0).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export const inquirySchema = z.object({
  listingId: z.string().uuid(),
  message: z.string().trim().min(10).max(2000),
  consent: z.literal(true, { error: "Contact consent is required." }),
});

export const inquiryStatusSchema = z.object({
  status: z.enum(["new", "read", "replied", "closed", "flagged"]).optional(),
  buyerUpdate: z.string().trim().min(3).max(1000).nullable().optional(),
  ownerUpdate: z.string().trim().min(3).max(1000).nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
}).refine((value) => value.status !== undefined || value.buyerUpdate !== undefined ||
  value.ownerUpdate !== undefined || value.assignedTo !== undefined, {
  message: "Provide a status, update, or assignee change.",
});

export const reportSchema = z.object({
  listingId: z.string().uuid().optional(),
  category: z.enum([
    "suspected_fraud",
    "agent_impersonating_owner",
    "sold_or_unavailable",
    "misleading_price",
    "stolen_photos",
    "harassment",
    "other",
  ]),
  message: z.string().trim().min(10).max(2000),
  consent: z.literal(true, { error: "Report confirmation is required." }),
});

export const serviceRequestSchema = z.object({
  name,
  phone,
  city: z.string().trim().min(2).max(100),
  serviceType: z.enum([
    "property_verification",
    "legal_consultation",
    "document_drafting",
    "registry_assistance",
    "valuation_or_survey",
    "other",
  ]),
  message: z.string().trim().min(10).max(2000),
  consent: z.literal(true, { error: "Contact consent is required." }),
});

export const reviewSchema = z.object({
  decision: z.enum(["approve", "reject", "needs_changes", "restore"]),
  note: z.string().trim().min(5).max(2000),
});

export const serviceStatusSchema = z.object({
  status: z.enum([
    "under_review",
    "information_required",
    "quoted",
    "in_progress",
    "completed",
    "closed",
  ]).optional(),
  note: z.string().trim().min(3).max(1000),
  assignedTo: z.string().uuid().nullable().optional(),
}).refine((value) => value.status !== undefined || value.assignedTo !== undefined, {
  message: "Provide a status or assignee update.",
});

export const listingStatusSchema = z.object({
  status: z.enum(["paused", "under_offer", "sold", "rented", "archived"]),
});

export const reportStatusSchema = z.object({
  status: z.enum(["investigating", "resolved", "dismissed"]),
  note: z.string().trim().min(3).max(1000),
});
