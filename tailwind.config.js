/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        xs: {
          bg: '#f5f5f7',
          card: '#ffffff',
          surface: '#ebedf0',
          border: '#e0e0e0',
          'border-hover': '#c0c0c0',
          orange: '#ff5722',
          'orange-hover': '#e64a19',
          'orange-dim': 'rgba(255, 87, 34, 0.1)',
          text: '#1a1a1a',
          'text-secondary': '#555555',
          'text-muted': '#999999',
          online: '#22c55e',
          blue: '#1d9bf0',
        },
      },
      fontSize: {
        '2xs': ['11px', '15px'],
      },
    },
  },
  plugins: [],
}
