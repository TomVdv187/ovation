import type { Config } from "tailwindcss";
import { ovationPreset } from "@ovation/core/tailwind-preset";

export default {
  presets: [ovationPreset],
  content: ["./src/**/*.{ts,tsx}"],
} satisfies Config;
