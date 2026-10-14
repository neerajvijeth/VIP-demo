const v = (n) => `hsl(var(--${n}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [__dirname + '/index.html', __dirname + '/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: v('background'), foreground: v('foreground'), card: v('card'), border: v('border'),
        muted: v('muted'), 'muted-foreground': v('muted-foreground'), primary: v('primary'), 'primary-foreground': v('primary-foreground'),
        accent: v('accent'), ring: v('ring'), popover: v('popover'),
        sev: { critical: v('sev-critical'), high: v('sev-high'), medium: v('sev-medium'), low: v('sev-low'), info: v('sev-info') },
        ok: v('ok'),
      },
      fontFamily: { display: ['"Instrument Serif"', 'Georgia', 'serif'], sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      borderRadius: { lg: '0.5rem', md: '0.375rem', sm: '0.25rem' },
      keyframes: {
        'slide-from-right': { from: { opacity: 0, transform: 'translateX(24px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-from-left': { from: { opacity: 0, transform: 'translateX(-24px)' }, to: { opacity: 1, transform: 'none' } },
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'sheet-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(-4px) scale(.98)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'slide-from-right': 'slide-from-right 220ms ease-out', 'slide-from-left': 'slide-from-left 220ms ease-out',
        'fade-in': 'fade-in 180ms ease-out', 'sheet-in': 'sheet-in 200ms ease-out', 'pop-in': 'pop-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
