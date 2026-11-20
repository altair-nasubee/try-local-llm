import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker イメージを小さくするため、必要なファイルだけを .next/standalone に出力する
  output: "standalone",
  experimental: {
    // proxy を通るリクエストの本文は既定 10MB まで。/api/chat は画像 4 枚 × 10MB を受け取るため 50MB に上げる
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
