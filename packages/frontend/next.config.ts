import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  output: 'export',
  images: {
    unoptimized: true,
  },
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      './ptt.js': './ptt',
      './regex.js': './regex',
    };
    return config;
  },
};

export default nextConfig;
