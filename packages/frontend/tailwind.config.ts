import type { Config } from 'tailwindcss';
import preset from '@aiostreams/ui/tailwind-preset';

const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx,mdx}', '../ui/src/**/*.{ts,tsx}'],
};
export default config;
