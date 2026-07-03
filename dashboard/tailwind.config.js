/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        weather: {
          sun: '#FFB800',
          rain: '#4A90D9',
          wind: '#7BC8A4',
          cold: '#88C8F7',
          hot: '#FF6B6B',
        }
      }
    },
  },
  plugins: [],
}
