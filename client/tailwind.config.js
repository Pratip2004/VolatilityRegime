/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // AntD ships its own reset; Tailwind is used for layout utilities only.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
}
