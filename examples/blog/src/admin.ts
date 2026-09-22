import { registerAdmin } from "@clango/admin-api";

import { Post } from "./models";

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
});
