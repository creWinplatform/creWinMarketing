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
        // Eski CrewinJob sekmelerinin ana rengi; Ryzevo token'larına bağlı (app/ryzevo-tokens.css).
        // Vurgu: açık temada zeytin, koyu temada lime. Dolu yüzeyler (bg-ocean) ana düğme gibi görünür (app/ryzevo.css).
        ocean: 'rgb(var(--rz-ocean) / <alpha-value>)',
        'ocean-dark': 'rgb(var(--rz-ocean-dark) / <alpha-value>)',
        'ocean-light': 'rgb(var(--rz-ocean-light) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
