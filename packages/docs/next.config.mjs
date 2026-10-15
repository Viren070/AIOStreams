import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ['takumi-js'],
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
