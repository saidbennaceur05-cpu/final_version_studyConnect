/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/*.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: '#4f46e5',
        'brand-2': '#7c3aed',
      }
    },
  },
  plugins: [],
}
