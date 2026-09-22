import { registerAdmin } from "@clango/admin-api";

import { Post } from "./models";
import { exportPostPdf, publishPosts } from "./tasks";

/**
 * Admin customisation. Importing this module for its side effect is what applies it, mirroring how
 * model definitions are registered at module load.
 */
registerAdmin(Post, {
  listDisplay: ["title", "author", "status", "publishedAt"],
  listFilter: ["status", "author"],
  searchFields: ["title", "body"],
  readonlyFields: ["slug"],
  fieldsets: [
    { title: "Content", fields: ["title", "slug", "body", "excerpt"] },
    { title: "Publishing", fields: ["status", "author", "publishedAt"] },
  ],
  actions: [
    {
      name: "publish",
      label: "Publish selected",
      description: "Marks the selected drafts as published.",
      handler: async (ids, context) => {
        // The write happens in a queue consumer, not in the request: a bulk action must not depend on
        // how many rows the user selected.
        if (context.enqueue === undefined) {
          throw new Error(
            "The publish action needs a Queues producer (`tasks.binding` in the config).",
          );
        }
        await context.enqueue(publishPosts, { ids: [...ids] });
      },
    },
    {
      name: "export_pdf",
      label: "Export as PDF",
      description: "Renders each selected post's admin page to a PDF in R2.",
      handler: async (ids, context) => {
        if (context.enqueue === undefined) {
          throw new Error("The export action needs a Queues producer.");
        }
        // One task per row: a render is slow, and batching several into one message invites a timeout.
        for (const id of ids) {
          await context.enqueue(exportPostPdf, { id, origin: "https://example.com" });
        }
      },
    },
  ],
});
