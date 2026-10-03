import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { archiveSource } from "./scripts/archive-source.mjs";

export default defineConfig({
  plugins: [
    { name: "private-development-archive", enforce: "pre", resolveId(id) {
      if (id === "@visa/archive") return archiveSource(process.cwd());
    } },
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
