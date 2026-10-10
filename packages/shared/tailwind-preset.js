/** Tailwind preset: colours are CSS variables set by theme.js, so a restaurant's brand applies without a rebuild. */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;
export default {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: v("--brand"), soft: v("--brand-soft"), on: v("--on-brand") },
        accent: { DEFAULT: v("--accent"), soft: v("--accent-soft"), on: v("--on-accent") },
        ink: v("--ink"),
        line: v("--line"),
        surface: v("--bg"),
        good: { DEFAULT: "#1B8548", soft: "#E7F6EC" },
        bad: { DEFAULT: "#C62828", soft: "#FDECEC" },
        warn: { DEFAULT: "#B8690A", soft: "#FFF1DC" },
      },
      fontFamily: { display: ["var(--font-display)"], sans: ["var(--font-body)"] },
      boxShadow: { card: "0 1px 2px rgba(16,32,31,.06), 0 4px 14px rgba(16,32,31,.05)", float: "0 12px 32px rgba(16,32,31,.22)" },
    },
  },
};
