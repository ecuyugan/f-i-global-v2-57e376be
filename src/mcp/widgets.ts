import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const ASSETS_DIR = path.join(ROOT_DIR, "assets");

// ── Immutable asset base constants (resolved once at startup) ──────
const rawBase =
  process.env.BASE_URL ?? "http://localhost:3600";

export const WIDGET_ASSET_BASE = (() => {
  const trimmed = rawBase.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/assets") ? trimmed : `${trimmed}/assets`;
})();

export const WIDGET_ASSET_ORIGIN = (() => {
  try {
    return new URL(WIDGET_ASSET_BASE).origin;
  } catch {
    return WIDGET_ASSET_BASE.replace(/\/+$/, "");
  }
})();

// ── Widget types ───────────────────────────────────────────────────
export interface WidgetDef {
  name: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
}

/**
 * No-op now that widgets are self-contained (all JS/CSS inlined).
 * Kept for API compatibility — callers can still invoke it safely.
 */
export function injectWidgetAssetBase(html: string, _assetBase: string): string {
  return html;
}

/**
 * Read self-contained widget HTML from disk.
 * Build script (build-all.mts) inlines all JS/CSS into a single HTML file.
 * ChatGPT loads widgets via srcdoc iframe — external script fetches fail,
 * so everything must be inlined.
 */
export function readWidgetHtml(componentName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    return `<!-- Placeholder widget: ${componentName} -->`;
  }
  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  if (fs.existsSync(directPath)) {
    return fs.readFileSync(directPath, "utf8");
  }
  // Fallback: look for hashed variant
  const candidates = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => f.startsWith(`${componentName}-`) && f.endsWith(".html"))
    .sort();
  const fallback = candidates[candidates.length - 1];
  if (fallback) {
    return fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
  }
  return `<!-- Placeholder widget: ${componentName} -->`;
}

/** Returns the MCP resource URI for a widget (ui:// scheme). */
export function getWidgetTemplateUri(name: string): string {
  return `ui://widget/${name}.html`;
}

/**
 * Tool descriptor _meta for tools/list response.
 * Per OpenAI docs: tool _meta needs `ui.resourceUri` + invocation strings.
 */
// Shared CSP domain lists — used by both tool descriptors and resource content
const SHOPIFY_RESOURCE_DOMAINS = [
  "https://cdn.shopify.com",
  "https://*.shopify.com",
];

// Domains the widget needs to connect to (fetch/XHR) or navigate to (openExternal)
const SHOPIFY_CONNECT_DOMAINS = [
  "https://*.shopify.com",
  "https://*.myshopify.com",
  "https://pay.shopify.com",
  "https://checkout.shopify.com",
];

/** Build the full CSP domain lists, including the merchant's storefront domain. */
function buildCspDomains(storeDomain?: string) {
  const storeDomains: string[] = [];
  if (storeDomain) {
    storeDomains.push(`https://${storeDomain}`);
  }
  return {
    resource_domains: [...SHOPIFY_RESOURCE_DOMAINS, ...storeDomains],
    connect_domains: [...SHOPIFY_CONNECT_DOMAINS, ...storeDomains, WIDGET_ASSET_ORIGIN],
  };
}

export function getToolDescriptorMeta(widget: WidgetDef, storeDomain?: string) {
  const csp = buildCspDomains(storeDomain);
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/widgetDomain": WIDGET_ASSET_ORIGIN,
    "openai/widgetCSP": csp,
    // Keep legacy key for backwards compatibility
    ui: { resourceUri: widget.templateUri },
  };
}

/**
 * Resource content _meta for resources/read response.
 * Per OpenAI docs: CSP and domain go on the content-level _meta.ui.
 * ChatGPT reads these when evaluating templates.
 */
export function getResourceContentMeta(widget: WidgetDef, storeDomain?: string) {
  const csp = buildCspDomains(storeDomain);
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/widgetAccessible": true,
    "openai/widgetDomain": WIDGET_ASSET_ORIGIN,
    "openai/widgetCSP": csp,
    // Keep legacy structure for backwards compatibility
    ui: {
      domain: WIDGET_ASSET_ORIGIN,
      csp: {
        connectDomains: csp.connect_domains,
        resourceDomains: csp.resource_domains,
        frameDomains: [] as string[],
      },
    },
  };
}

/**
 * Tool response _meta for CallTool results.
 * Included on each tool response alongside content + structuredContent.
 */
export function getToolResponseMeta(widget: WidgetDef) {
  return {
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
  };
}
