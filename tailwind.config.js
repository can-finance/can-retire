/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      // Deliberate global type bump: our readers are retirees, many with
      // deteriorating eyesight. Every step is shifted up one notch, so the
      // utility NAMES no longer match Tailwind's stock values — `text-xs` is
      // 14px here, not 12px; `text-sm` is 16px, not 14px. This is intentional;
      // please don't "correct" it back to the defaults. 3xl/4xl are left alone.
      fontSize: {
        // `2xs` is the one deliberate escape hatch: genuine fine print (the
        // footer's privacy badge and utility links) that nobody needs to read
        // to use the tool. Don't reach for it for anything a user must read.
        '2xs': ['0.75rem', { lineHeight: '1rem' }],
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        sm: ['1rem', { lineHeight: '1.5rem' }],
        base: ['1.125rem', { lineHeight: '1.75rem' }],
        lg: ['1.25rem', { lineHeight: '1.75rem' }],
        xl: ['1.375rem', { lineHeight: '1.875rem' }],
        '2xl': ['1.625rem', { lineHeight: '2rem' }],
      },
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        }
      }
    },
  },
  plugins: [],
}
