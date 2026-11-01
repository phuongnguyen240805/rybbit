import path from "node:path";
import extractionLoader from "next-intl/extractor/extractionLoader";
import type { Plugin } from "vite";

// Run next-intl's own SWC compiler before Vite/RSC transforms. Its catalog
// loader alone does not compile useExtracted/getExtracted calls.
export function nextIntlExtraction(): Plugin {
  let root: string;
  return {
    name: "kedi:next-intl-extraction",
    enforce: "pre",
    configResolved(config) { root = config.root; },
    async transform(source, id) {
      const filename = id.split("?")[0];
      if (filename.includes("/node_modules/") || !/\.[jt]sx?$/.test(filename) ||
        !/\b(?:useExtracted|getExtracted)\b/.test(source)) return;
      return new Promise<{ code: string; map: string | null }>((resolve, reject) => {
        Reflect.apply(extractionLoader, {
          rootContext: root,
          resourcePath: path.resolve(filename),
          sourceMap: true,
          async: () => (error: Error | null, code: string, map?: string) => {
            if (error) reject(error);
            else resolve({ code, map: map ?? null });
          },
        }, [source]);
      });
    },
  };
}
