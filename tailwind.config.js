/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Cinzel', 'Georgia', 'serif'],
      },
      colors: {
        /** Page shells (Captain’s Log, etc.) — unified dark base */
        primary: '#020617',
        secondary: '#050a14',
        /** Primary CTA / highlights (refined orange) */
        accent: '#ff8c2b',
        'accent-hover': '#ea7d24',
        night: '#020617',
        /**
         * Launch Zone design tokens — use `bg-lz-bg`, `text-lz-accent`, etc.
         * Mirrors CSS variables in src/index.css :root
         */
        lz: {
          bg: '#020617',
          surface: '#050a14',
          elevated: '#0a1628',
          accent: '#00cfff',
          'accent-muted': 'rgba(0, 207, 255, 0.4)',
          cta: '#ff8c2b',
          'cta-hover': '#ea7d24',
        },
      },
      boxShadow: {
        /** Accent cyan — soft glow (not hard drop shadow) */
        'lz-glow': '0 0 28px rgba(0, 207, 255, 0.15), 0 0 56px rgba(0, 207, 255, 0.08)',
        'lz-glow-md': '0 0 36px rgba(0, 207, 255, 0.22), 0 0 72px rgba(0, 207, 255, 0.1)',
        'lz-glow-lg': '0 0 48px rgba(0, 207, 255, 0.28), 0 0 96px rgba(0, 207, 255, 0.12)',
        'lz-glow-cta': '0 0 32px rgba(255, 140, 43, 0.42), 0 6px 28px rgba(0, 0, 0, 0.35)',
        'glow-amber': '0 0 32px rgba(255, 140, 43, 0.42), 0 4px 24px rgba(0, 0, 0, 0.32)',
        'glow-cyan': '0 0 28px rgba(0, 207, 255, 0.32)',
        'hero-title': '0 0 20px rgba(147, 197, 253, 0.45), 0 0 48px rgba(255, 255, 255, 0.12)',
      },
      borderRadius: {
        lz: '12px',
        'lz-card': '16px',
      },
      transitionDuration: {
        400: '400ms',
      },
      backgroundImage: {
        'lz-gradient': 'linear-gradient(165deg, #020617 0%, #050a14 45%, #000000 100%)',
        'lz-orange-cta': 'linear-gradient(135deg, #ff8c2b 0%, #ea7d24 55%, #cc6a1e 100%)',
      },
    },
  },
  plugins: [],
};
