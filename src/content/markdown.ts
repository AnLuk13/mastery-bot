export const MARKDOWN_EXTENSION = ".md";

export function hasMarkdownExtension(name: string): boolean {
  return name.toLowerCase().endsWith(MARKDOWN_EXTENSION);
}
