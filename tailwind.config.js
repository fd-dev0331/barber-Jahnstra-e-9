/** @type {import('tailwindcss').Config} */
// Tokens are the single source of truth from design-system/bregenz-barbershop/MASTER.md (v2, dark-first).
// Every colour value here has a computed contrast ratio recorded in that file. Do not "adjust" one
// without re-checking the pair it is used in.
module.exports = {
  // Die Admin-Seiten bauen ihre Tabellen und Karten im JavaScript zusammen —
  // ohne diesen Pfad fehlen im Build genau die Klassen, die nur dort vorkommen.
  content: ['./public/**/*.html', './public/assets/js/**/*.js', './src/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        bg: '#0E0D0C',
        surface: { DEFAULT: '#1A1816', 2: '#22201D' },
        fg: { DEFAULT: '#FFFFFF', body: '#D6D3D1', muted: '#A8A29E' },
        accent: { DEFAULT: '#D4AF37', hover: '#E0B44C', on: '#0E0D0C' },
        line: { DEFAULT: '#2A2724', strong: '#6B6560' },
        danger: '#F87171',
        ok: '#4ADE80',
        warn: '#FBBF24',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Oswald', 'Arial Narrow', 'sans-serif'],
        sans: ['Barlow', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        kicker: ['0.75rem', { lineHeight: '1', letterSpacing: '0.22em' }],
        hero: ['2.75rem', { lineHeight: '1.02', letterSpacing: '0.01em' }],
        'hero-lg': ['5.25rem', { lineHeight: '1.02', letterSpacing: '0.01em' }],
        h2: ['1.875rem', { lineHeight: '1.05', letterSpacing: '0.02em' }],
        'h2-lg': ['2.875rem', { lineHeight: '1.05', letterSpacing: '0.02em' }],
      },
      borderRadius: { sm: '4px', md: '6px', lg: '10px', xl: '14px' },
      maxWidth: { container: '1200px', prose: '52ch', head: '16ch' },
      boxShadow: {
        md: '0 4px 12px rgba(0,0,0,.5)',
        lg: '0 16px 40px rgba(0,0,0,.6)',
      },
    },
  },
  plugins: [],
};
