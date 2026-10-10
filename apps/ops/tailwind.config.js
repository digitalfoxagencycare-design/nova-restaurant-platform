import preset from "../../packages/shared/tailwind-preset.js";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // The Nova orange is too light for small white text; buttons use this slightly deeper shade (white on it is 4.9:1).
      colors: { action: { DEFAULT: "#C93A1B", dark: "#AE2F14" } },
    },
  },
};
