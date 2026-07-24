import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

/**
 * Sanitize schema for conversation markdown.
 * Extends rehype-sanitize defaults so GFM footnotes / source citations keep
 * their ids, data attributes, and sr-only footnote heading.
 */
export const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      // Footnote ref / backref (hast camelCase + literal class tokens).
      "dataFootnoteBackref",
      "dataFootnoteRef",
      ["className", "data-footnote-backref", "content-cite-ref", "content-cite-backref"],
    ],
    section: [
      ...(defaultSchema.attributes?.section ?? []),
      "dataFootnotes",
      ["className", "footnotes", "content-footnotes"],
    ],
    h2: [...(defaultSchema.attributes?.h2 ?? []), ["className", "sr-only"]],
    sup: [...(defaultSchema.attributes?.sup ?? []), ["className", "content-cite-sup"]],
  },
};
