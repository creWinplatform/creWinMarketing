import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: '#0f172a',
        'navy-light': '#1e293b',
        ocean: '#0284c7',
        'ocean-dark': '#0369a1',
        'ocean-light': '#38bdf8',
      },
    },
  },
  plugins: [],
};

export default config;
