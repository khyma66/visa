import { defineConfig, loadEnv } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { archiveSource } from "./scripts/archive-source.mjs";
import { buildProvenanceSource } from "./scripts/build-provenance.mjs";

export default defineConfig(({ mode }) => ({
  resolve: { alias: {
    "@visa/archive": archiveSource(process.cwd()),
    "@visa/build-provenance": buildProvenanceSource(process.cwd(), { ...loadEnv(mode, process.cwd(), ''), ...process.env }),
  } },
  plugins: [
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
}));
