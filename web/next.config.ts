import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.usepreflight.xyz" }],
        destination: "https://usepreflight.xyz/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
