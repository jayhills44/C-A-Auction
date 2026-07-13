import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Position colors used across the app
        qb: "#dc2626", // red
        rb: "#16a34a", // green
        wr: "#2563eb", // blue
        te: "#ea580c", // orange
        k: "#9333ea", // purple
        def: "#475569", // slate
      },
    },
  },
  plugins: [],
};
export default config;
