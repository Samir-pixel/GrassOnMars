/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        signal: "#ed2023",
        ink: "#2b2f36",
        paper: "#ffffff",
        "menu-edge": "#8c8e92",
      },
      fontFamily: {
        display: ['"Borensa"', '"Yeseva One"', '"DM Serif Display"', "serif"],
        body: ['"Offset TM"', '"Pangolin"', '"Patrick Hand"', "sans-serif"],
      },
      borderRadius: {
        action: "7.2px",
        menu: "10px",
      },
    },
  },
  plugins: [],
};
