import { relative } from 'node:path';
import { archiveSource } from './scripts/archive-source.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
    resolveAlias: { '@visa/archive': './' + relative(process.cwd(), archiveSource(process.cwd())) },
  },
}

export default nextConfig
