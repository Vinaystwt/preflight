import type { MetadataRoute } from "next";

const routes = [
  "",
  "/check",
  "/cli",
  "/gallery",
  "/docs",
  "/docs/verify-release-api",
  "/docs/machine-report",
  "/how-it-works",
  "/pricing",
  "/legal/privacy",
  "/legal/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-07-14T00:00:00.000Z");
  return routes.map((route) => ({
    url: `https://usepreflight.xyz${route}`,
    lastModified,
    changeFrequency: route === "" ? "daily" : "weekly",
    priority: route === "" ? 1 : 0.7,
  }));
}
