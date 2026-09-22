import { defineModel, fields } from "@clango/core";

/** A person who writes posts. */
export const Author = defineModel("blog.Author", {
  fields: {
    name: fields.string({ max: 120 }),
    email: fields.email({ unique: true }),
    avatar: fields.image({ optional: true }),
  },
  meta: { labelField: "name" },
  display: (author) => author.name,
  api: { enabled: true },
});

/** A label applied to posts. */
export const Tag = defineModel("blog.Tag", {
  fields: {
    name: fields.string({ max: 60, unique: true }),
  },
  meta: { labelField: "name" },
  display: (tag) => tag.name,
  // Read-only: writes are refused by omission rather than by a permission check.
  api: { enabled: true, ops: ["list", "retrieve"] },
});

/** A blog post. */
export const Post = defineModel("blog.Post", {
  fields: {
    title: fields.string({ max: 200 }),
    slug: fields.slug({ from: "title", unique: true }),
    body: fields.text({ searchable: true, optional: true }),
    excerpt: fields.string({ max: 300, optional: true }),
    status: fields.choice(["draft", "published"], { default: "draft" }),
    publishedAt: fields.datetime({ optional: true, index: true }),
    author: fields.foreignKey(() => Author, { onDelete: "cascade" }),
    tags: fields.manyToMany(() => Tag),
  },
  meta: { ordering: ["-publishedAt"], labelField: "title" },
  display: (post) => post.title,
  api: { enabled: true },
});
