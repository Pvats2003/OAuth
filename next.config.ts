import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Seed guides are read from disk at request time; make sure Vercel bundles them.
  outputFileTracingIncludes: {
    "/**": ["./data/guides/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
