/**
 * PDF export via Browser Rendering.
 *
 * The browser itself cannot run in the Workers test pool, so the renderer depends on a
 * *launcher* interface rather than on Puppeteer directly: the production path passes
 * `puppeteer.launch(env.BROWSER)`, and tests pass a stub. That keeps everything except the browser
 * covered — page setup, waiting, cookie forwarding, and the hand-off to storage.
 *
 * Rendering is slow and may exceed the Worker CPU budget, so it belongs behind a Workflow or a
 * Queue, never in the request that asked for the export.
 */

/** One page of a browser session. Mirrors the Puppeteer methods this module uses. */
export interface BrowserPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  pdf(options?: PdfOptions): Promise<Uint8Array | ArrayBuffer>;
  setExtraHTTPHeaders?(headers: Record<string, string>): Promise<void> | void;
  close?(): Promise<void>;
}

/** Print options passed through to the browser. */
export interface PdfOptions {
  readonly format?: string;
  readonly printBackground?: boolean;
  readonly margin?: {
    readonly top?: string;
    readonly bottom?: string;
    readonly left?: string;
    readonly right?: string;
  };
  readonly landscape?: boolean;
}

/** An open browser. */
export interface BrowserSession {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

/** Opens a browser. In production, `{ launch: () => puppeteer.launch(env.BROWSER) }`. */
export interface BrowserLauncher {
  launch(): Promise<BrowserSession>;
}

/** Options accepted by {@link renderPdf}. */
export interface RenderPdfOptions {
  readonly launcher: BrowserLauncher;
  /** Page to print. */
  readonly url: string;
  /** Forwarded as a `Cookie` header, so the export can authenticate as the person who asked for it. */
  readonly cookieHeader?: string;
  readonly pdf?: PdfOptions;
  /** How long to wait for the page to load. Defaults to 30 seconds. */
  readonly timeoutMs?: number;
}

function toBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/**
 * Renders a URL to PDF.
 *
 * The browser is always closed, including on failure: a leaked session burns a concurrent-browser
 * slot, and Browser Rendering has a low ceiling on those.
 */
export async function renderPdf(options: RenderPdfOptions): Promise<Uint8Array> {
  const browser = await options.launcher.launch();
  try {
    const page = await browser.newPage();
    if (options.cookieHeader !== undefined && page.setExtraHTTPHeaders !== undefined) {
      await page.setExtraHTTPHeaders({ cookie: options.cookieHeader });
    }
    await page.goto(options.url, {
      // `networkidle0` waits for the admin's own data fetches, so the export is not a loading screen.
      waitUntil: "networkidle0",
      timeout: options.timeoutMs ?? 30_000,
    });
    const pdf = await page.pdf({ printBackground: true, format: "A4", ...options.pdf });
    await page.close?.();
    return toBytes(pdf);
  } finally {
    await browser.close();
  }
}

/** Stores rendered exports. Implemented by R2 in the application. */
export interface PdfStore {
  put(key: string, value: Uint8Array): Promise<void>;
}

/** Options accepted by {@link createPdfExporter}. */
export interface PdfExporterOptions {
  readonly launcher: BrowserLauncher;
  readonly store: PdfStore;
  /** Receives progress, so a Workflow can report it. */
  readonly onProgress?: (stage: "rendering" | "storing" | "done") => Promise<void> | void;
}

/** A rendered export. */
export interface PdfExport {
  readonly key: string;
  readonly bytes: number;
}

/**
 * Renders a URL and stores the result, reporting progress between the two slow steps.
 *
 * Splitting render from store is what makes this usable from a Workflow: each half is independently
 * retryable, and a retry after a storage failure does not re-render.
 */
export function createPdfExporter(options: PdfExporterOptions): {
  export(url: string, key: string, pdf?: PdfOptions): Promise<PdfExport>;
} {
  return {
    async export(url, key, pdf) {
      await options.onProgress?.("rendering");
      const bytes = await renderPdf({
        launcher: options.launcher,
        url,
        ...(pdf === undefined ? {} : { pdf }),
      });
      await options.onProgress?.("storing");
      await options.store.put(key, bytes);
      await options.onProgress?.("done");
      return { key, bytes: bytes.byteLength };
    },
  };
}
