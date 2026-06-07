/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        money: {
          darker: '#05190e',
          dark:   '#0a2f1d',
          mid:    '#0d3a22',
          card:   '#071e12',
          light:  '#10b981',
        },
        gold: {
          foil:  '#d4af37',
          light: '#f3e5ab',
          dark:  '#b38728',
          dim:   '#9e7215',
        },
      },
    },
  },
  plugins: [],
}
