import { defineApp } from "@clango/core";

import { Author, Post, Tag } from "./models";

/** The blog app used as the reference example for every milestone. */
export const blog = defineApp({ name: "blog", models: [Author, Post, Tag], database: "DB_MAIN" });

export default blog;
