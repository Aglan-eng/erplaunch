/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/*.html', './src/**/*.{html,css}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        ink: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display-xl': ['clamp(3rem, 1.2rem + 7vw, 7.5rem)', { lineHeight: '1', letterSpacing: '-0.04em' }],
        'display-lg': ['clamp(2.5rem, 1rem + 5vw, 5rem)',   { lineHeight: '1.05', letterSpacing: '-0.035em' }],
        'display-md': ['clamp(2rem, 1rem + 3vw, 3.5rem)',    { lineHeight: '1.1', letterSpacing: '-0.03em' }],
      },
      spacing: {
        section: 'clamp(4rem, 2rem + 6vw, 9rem)',
      },
      animation: {
        'gradient-shift': 'gradient-shift 12s ease-in-out infinite',
        'fade-up':        'fade-up 800ms cubic-bezier(0.16,1,0.3,1) both',
        'blink':          'blink 1.2s steps(2) infinite',
      },
      keyframes: {
        'gradient-shift': {
          '0%,100%': { backgroundPosition: '0% 50%' },
          '50%':     { backgroundPosition: '100% 50%' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'blink': { '50%': { opacity: '0' } },
      },
    },
  },
  plugins: [],
};
