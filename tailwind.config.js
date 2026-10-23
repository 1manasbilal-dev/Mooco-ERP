import animate from 'tailwindcss-animate';

// Semantic colours read the RGB triplets in src/styles/tokens.css, so `bg-brand/10` works
// and light/dark mode need no `dark:` duplicates.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const status = (name) => ({ DEFAULT: token(name), soft: token(`${name}-soft`), fg: token(`${name}-fg`) });

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        slate: {
          750: '#26334d',
          850: '#141d2e',
        },
        canvas: token('canvas'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2'), 3: token('surface-3') },
        fg: { DEFAULT: token('fg'), muted: token('fg-muted'), subtle: token('fg-subtle'), faint: token('fg-faint') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        brand: {
          DEFAULT: token('brand'),
          hover: token('brand-hover'),
          on: token('brand-on'),
          soft: token('brand-soft'),
          fg: token('brand-fg'),
          accent: token('brand-accent'),
        },
        ring: token('ring'),
        success: status('success'),
        danger: status('danger'),
        warning: status('warning'),
        info: status('info'),
      },
      borderRadius: {
        card: 'var(--radius-card)',
        control: 'var(--radius-control)',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        card: '0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.04)',
        'card-hover': '0 10px 15px -3px rgba(15, 23, 42, 0.06), 0 4px 6px -4px rgba(15, 23, 42, 0.04)',
        e1: 'var(--shadow-e1)',
        // e1 plus a top highlight, for solid filled buttons.
        'e1-lit': 'var(--shadow-e1), inset 0 1px 0 rgb(255 255 255 / 0.14)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
      },
      transitionTimingFunction: {
        'out-expo': 'var(--ease-out)',
      },
      animation: {
        'fade-up': 'ds-fade-up 220ms var(--ease-out) both',
      },
    },
  },
  plugins: [animate],
};
