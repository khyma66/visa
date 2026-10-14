import { relative } from 'node:path';
import { archiveSource } from './scripts/archive-source.mjs';
import { buildProvenanceSource } from './scripts/build-provenance.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      '@visa/archive': './' + relative(process.cwd(), archiveSource(process.cwd())),
      '@visa/build-provenance': './' + relative(process.cwd(), buildProvenanceSource(process.cwd())),
    },
  },
}

export default nextConfig
