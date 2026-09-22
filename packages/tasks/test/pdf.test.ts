import { describe, expect, it } from "vitest";

import {
  createPdfExporter,
  renderPdf,
  type BrowserLauncher,
  type BrowserPage,
  type BrowserSession,
} from "../src/index";

interface Trace {
  readonly events: string[];
  readonly headers: Record<string, string>[];
  readonly urls: string[];
  readonly pdfOptions: Record<string, unknown>[];
}

/** A launcher that records what the renderer asked for. */
function launcher(options: { failOnGoto?: boolean } = {}): {
  launcher: BrowserLauncher;
  trace: Trace;
} {
  const trace: Trace = { events: [], headers: [], urls: [], pdfOptions: [] };

  const page: BrowserPage = {
    async goto(url) {
      trace.events.push("goto");
      trace.urls.push(url);
      if (options.failOnGoto === true) throw new Error("navigation failed");
      return null;
    },
    async pdf(pdfOptions) {
      trace.events.push("pdf");
      trace.pdfOptions.push({ ...(pdfOptions ?? {}) });
      return new Uint8Array([1, 2, 3]);
    },
    setExtraHTTPHeaders(headers) {
      trace.headers.push(headers);
    },
    async close() {
      trace.events.push("page-close");
    },
  };

  const browser: BrowserSession = {
    async newPage() {
      return page;
    },
    async close() {
      trace.events.push("browser-close");
    },
  };

  return {
    launcher: {
      async launch() {
        trace.events.push("launch");
        return browser;
      },
    },
    trace,
  };
}

describe("renderPdf", () => {
  it("loads the URL, prints it and closes the browser", async () => {
    const { launcher: stub, trace } = launcher();
    const bytes = await renderPdf({ launcher: stub, url: "https://example.com/admin/blog/post" });

    expect([...bytes]).toEqual([1, 2, 3]);
    expect(trace.events).toEqual(["launch", "goto", "pdf", "page-close", "browser-close"]);
    expect(trace.urls).toEqual(["https://example.com/admin/blog/post"]);
  });

  it("waits for the page's own data fetches and prints backgrounds by default", async () => {
    const { launcher: stub, trace } = launcher();
    await renderPdf({ launcher: stub, url: "https://example.com/" });
    expect(trace.pdfOptions[0]).toMatchObject({ printBackground: true, format: "A4" });
  });

  it("forwards the caller's cookie so the export is authenticated", async () => {
    const { launcher: stub, trace } = launcher();
    await renderPdf({ launcher: stub, url: "https://example.com/", cookieHeader: "session=abc" });
    expect(trace.headers).toEqual([{ cookie: "session=abc" }]);
  });

  it("accepts print options", async () => {
    const { launcher: stub, trace } = launcher();
    await renderPdf({
      launcher: stub,
      url: "https://example.com/",
      pdf: { format: "Letter", landscape: true },
    });
    expect(trace.pdfOptions[0]).toMatchObject({ format: "Letter", landscape: true });
  });

  it("closes the browser even when navigation fails", async () => {
    const { launcher: stub, trace } = launcher({ failOnGoto: true });
    await expect(renderPdf({ launcher: stub, url: "https://example.com/" })).rejects.toThrow(
      /navigation failed/,
    );
    // A leaked session burns one of a small number of concurrent browser slots.
    expect(trace.events).toContain("browser-close");
    expect(trace.events).not.toContain("pdf");
  });
});

describe("createPdfExporter", () => {
  it("renders, stores and reports each stage", async () => {
    const { launcher: stub } = launcher();
    const stored: { key: string; bytes: number }[] = [];
    const progress: string[] = [];

    const exporter = createPdfExporter({
      launcher: stub,
      store: {
        async put(key, value) {
          stored.push({ key, bytes: value.byteLength });
        },
      },
      onProgress: (stage) => {
        progress.push(stage);
      },
    });

    await expect(exporter.export("https://example.com/", "exports/post.pdf")).resolves.toEqual({
      key: "exports/post.pdf",
      bytes: 3,
    });
    expect(stored).toEqual([{ key: "exports/post.pdf", bytes: 3 }]);
    // Render and store are separate stages so a Workflow can retry one without the other.
    expect(progress).toEqual(["rendering", "storing", "done"]);
  });
});
