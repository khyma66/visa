/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig
