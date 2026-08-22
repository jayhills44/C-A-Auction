/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Never bundle these packages — resolve them at runtime instead. Ably ships
    // a pre-compiled browser build that Next.js's webpack chokes on if it tries
    // to re-parse it. Server-side we get the Node build via require() naturally;
    // client-side we load the browser build from Ably's CDN (see layout.tsx).
    serverComponentsExternalPackages: ["ably", "firebase-admin"],
  },
};
module.exports = nextConfig;
