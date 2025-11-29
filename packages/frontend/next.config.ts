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
      '../utils/languages.js': '../utils/languages',
      '../utils/constants.js': '../utils/constants',
    };
    return config;
  },
};

export default nextConfig;
