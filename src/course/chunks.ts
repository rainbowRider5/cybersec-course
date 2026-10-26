/**
 * Lesson prose lives in Markdown files next to each lesson's .ts file. A Markdown file is split
 * into named chunks with marker lines:
 *
 *   <!-- #intro -->
 *   Some **Markdown**...
 *
 * `chunks(raw)` returns a lookup function; asking for a chunk that does not exist throws, so a
 * typo fails loudly the first time the module loads.
 */
export function chunks(raw: string): (id: string) => string {
  const map = new Map<string, string>();
  const parts = raw.replace(/\r\n/g, '\n').split(/^<!--\s*#([\w-]+)\s*-->[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) map.set(parts[i], parts[i + 1].trim());
  return (id: string) => {
    const v = map.get(id);
    if (v === undefined) throw new Error(`Lesson text chunk "#${id}" not found`);
    return v;
  };
}
