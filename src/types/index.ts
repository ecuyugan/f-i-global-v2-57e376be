import { z } from 'zod';

// ── Money & Image ────────────────────────────────────────────────────────────

export const MoneySchema = z.object({
  amount: z.string(),
  currencyCode: z.string(),
});
export type Money = z.infer<typeof MoneySchema>;

export const ImageSchema = z.object({
  url: z.string().url(),
  altText: z.string().nullable().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type Image = z.infer<typeof ImageSchema>;

// ── Product ──────────────────────────────────────────────────────────────────

export const ProductVariantSchema = z.object({
  id: z.string(),
  title: z.string(),
  availableForSale: z.boolean(),
  quantityAvailable: z.number().nullable().optional(),
  price: MoneySchema,
  selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
  image: ImageSchema.nullable().optional(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

export const ProductSchema = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  description: z.string(),
  descriptionHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).default([]),
  availableForSale: z.boolean(),
  priceRange: z.object({
    minVariantPrice: MoneySchema,
  }),
  images: z.array(ImageSchema).default([]),
  variants: z.array(ProductVariantSchema).default([]),
  featuredImage: ImageSchema.nullable().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CollectionSchema = z.object({
  id: z.string(),
  handle: z.string(),
  title: z.string(),
  description: z.string(),
  image: ImageSchema.nullable().optional(),
  products: z.array(ProductSchema).default([]),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const SearchResultSchema = z.object({
  products: z.array(ProductSchema),
  totalCount: z.number(),
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ── Cart ─────────────────────────────────────────────────────────────────────

export const CartLineSchema = z.object({
  id: z.string(),
  quantity: z.number().int().min(0),
  merchandise: z.object({
    id: z.string(),
    title: z.string(),
    product: z.object({
      title: z.string(),
      handle: z.string(),
    }),
    price: MoneySchema,
    image: ImageSchema.nullable().optional(),
    selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
  }),
  cost: z.object({
    totalAmount: MoneySchema,
    amountPerQuantity: MoneySchema,
    compareAtAmountPerQuantity: MoneySchema.nullable().optional(),
  }),
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z.object({
  id: z.string(),
  checkoutUrl: z.string().url(),
  totalQuantity: z.number().int(),
  cost: z.object({
    subtotalAmount: MoneySchema,
    totalAmount: MoneySchema,
    totalTaxAmount: MoneySchema.nullable().optional(),
  }),
  lines: z.array(CartLineSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Cart = z.infer<typeof CartSchema>;

export const UserErrorSchema = z.object({
  field: z.array(z.string()).nullable().optional(),
  message: z.string(),
  code: z.string().optional(),
});
export type UserError = z.infer<typeof UserErrorSchema>;

// ── Order ────────────────────────────────────────────────────────────────────

export const FulfillmentStatusSchema = z.enum([
  'UNFULFILLED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'RESTOCKED',
  'PENDING_FULFILLMENT',
  'OPEN',
  'IN_PROGRESS',
  'ON_HOLD',
  'SCHEDULED',
]);
export type FulfillmentStatus = z.infer<typeof FulfillmentStatusSchema>;

export const FinancialStatusSchema = z.enum([
  'PENDING',
  'AUTHORIZED',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'VOIDED',
]);
export type FinancialStatus = z.infer<typeof FinancialStatusSchema>;

export const OrderLineItemSchema = z.object({
  title: z.string(),
  quantity: z.number().int(),
  variant: z
    .object({
      title: z.string(),
      price: MoneySchema,
    })
    .nullable()
    .optional(),
});
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  name: z.string(),
  orderNumber: z.number().int(),
  email: z.string().email().optional(),
  processedAt: z.string(),
  fulfillmentStatus: FulfillmentStatusSchema,
  financialStatus: FinancialStatusSchema,
  totalPrice: MoneySchema,
  subtotalPrice: MoneySchema,
  totalShippingPrice: MoneySchema.optional(),
  totalTax: MoneySchema.optional(),
  lineItems: z.array(OrderLineItemSchema).default([]),
  statusUrl: z.string().url().optional(),
  cancelledAt: z.string().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
});
export type Order = z.infer<typeof OrderSchema>;

// ── Store Config ─────────────────────────────────────────────────────────────

export const ColorSchemeSchema = z.object({
  primary: z.string().default('#000000'),
  secondary: z.string().default('#ffffff'),
  accent: z.string().default('#0070f3'),
  background: z.string().default('#ffffff'),
  text: z.string().default('#000000'),
});
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;

export const PromptSectionsSchema = z.object({
  personality: z.boolean().default(true),
  toolGuidance: z.boolean().default(true),
  scenarios: z.boolean().default(true),
  guardrails: z.boolean().default(true),
  conversationFlow: z.boolean().default(true),
});
export type PromptSections = z.infer<typeof PromptSectionsSchema>;

export const PromptConfigSchema = z.object({
  tone: z
    .enum(['friendly', 'professional', 'casual', 'luxury', 'playful'])
    .default('friendly'),
  writingStyle: z.string().default('concise and helpful'),
  businessType: z.string().default('general retail'),
  persona: z.string().default('shopping assistant'),
  supportEmail: z.string().email().optional(),
  supportPhone: z.string().optional(),
  guardrails: z.array(z.string()).default([]),
  customSystemPrompt: z.string().optional(),
  sections: PromptSectionsSchema.default({}),
  enableFollowupInstructions: z.boolean().default(true),
});
export type PromptConfig = z.infer<typeof PromptConfigSchema>;

export const StoreStatusSchema = z.enum([
  'draft',
  'pending_review',
  'approved',
  'active',
  'paused',
  'suspended',
]);
export type StoreStatus = z.infer<typeof StoreStatusSchema>;

export const StoreConfigSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  businessName: z.string().min(1),
  displayName: z.string().min(1),
  shopifyDomain: z.string().min(1),
  storefrontToken: z.string().min(1),
  apiVersion: z.string().default('2025-01'),
  colorScheme: ColorSchemeSchema.default({}),
  promptConfig: PromptConfigSchema.default({}),
  status: StoreStatusSchema.default('draft'),
  version: z.number().int().default(1),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

export const CreateStoreConfigSchema = StoreConfigSchema.omit({
  id: true,
  version: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  apiVersion: true,
  colorScheme: true,
  promptConfig: true,
  status: true,
});
export type CreateStoreConfig = z.infer<typeof CreateStoreConfigSchema>;

// ── MCP Events ───────────────────────────────────────────────────────────────

export const ShopifyStoreCreatedEvent = z.object({
  storeId: z.string().uuid(),
  tenantId: z.string().uuid(),
  businessName: z.string(),
  shopifyDomain: z.string(),
  status: StoreStatusSchema,
  createdAt: z.string().default(() => new Date().toISOString()),
});
export type ShopifyStoreCreatedEvent = z.infer<typeof ShopifyStoreCreatedEvent>;

export const ShopifyStoreApprovedEvent = z.object({
  storeId: z.string().uuid(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().default(() => new Date().toISOString()),
});
export type ShopifyStoreApprovedEvent = z.infer<typeof ShopifyStoreApprovedEvent>;

export const ShopifyStoreUpdatedEvent = z.object({
  storeId: z.string().uuid(),
  version: z.number().int(),
  changes: z.record(z.string(), z.unknown()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type ShopifyStoreUpdatedEvent = z.infer<typeof ShopifyStoreUpdatedEvent>;

export const ShopifyStorePausedEvent = z.object({
  storeId: z.string().uuid(),
  reason: z.string().optional(),
  pausedAt: z.string().default(() => new Date().toISOString()),
});
export type ShopifyStorePausedEvent = z.infer<typeof ShopifyStorePausedEvent>;

export const ShopifyWebhookEvent = z.object({
  storeId: z.string().uuid(),
  topic: z.string(),
  payload: z.unknown(),
  receivedAt: z.string().default(() => new Date().toISOString()),
});
export type ShopifyWebhookEvent = z.infer<typeof ShopifyWebhookEvent>;
