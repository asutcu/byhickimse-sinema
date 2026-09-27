import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "playwright-core", "@prisma/client", "prisma", "pino"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Proje klasoru altindaki medya dosyalarini (video/gorsel) API uzerinden akitiyoruz;
  // buyuk dosya yanitlari icin govde siniri kaldirilmali.
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  /**
   * Dev modunda proje olusturma / otomasyon dosya yazimi Next'in file watcher'ini
   * tetikleyip sunucuyu yeniden baslatiyordu (projects/, sqlite, logs, chrome profili).
   */
  webpack: (config, { dev }) => {
    if (dev) {
      const runtimeIgnored = [
        path.join(process.cwd(), "projects"),
        path.join(process.cwd(), "chrome-profile"),
        path.join(process.cwd(), "logs"),
      ];
      const patternIgnored = [
        "**/projects/**",
        "**/chrome-profile/**",
        "**/logs/**",
        "**/*.db",
        "**/*.db-journal",
        "**/*.db-wal",
      ];
      const prev = config.watchOptions?.ignored;
      const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
      const ignored = [...prevList, ...runtimeIgnored, ...patternIgnored].filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      config.watchOptions = {
        ...config.watchOptions,
        ignored,
      };
    }
    return config;
  },
};

export default nextConfig;
