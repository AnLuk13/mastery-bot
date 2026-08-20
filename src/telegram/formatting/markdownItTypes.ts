import MarkdownIt from "markdown-it";

/**
 * @types/markdown-it exposes Token only via a namespace merged onto the
 * default export, which doesn't survive re-import cleanly under this
 * project's ESM/isolatedModules TS config. Deriving it structurally from
 * the class's own `parse()` return type sidesteps that entirely.
 */
export type Token = ReturnType<
  InstanceType<typeof MarkdownIt>["parse"]
>[number];
