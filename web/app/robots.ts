import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://usepreflight.xyz/sitemap.xml",
    host: "https://usepreflight.xyz",
  };
}
