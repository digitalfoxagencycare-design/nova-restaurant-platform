import preset from "../../packages/shared/tailwind-preset.js";

export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
};
