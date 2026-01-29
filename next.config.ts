import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 确保 sharp 的二进制文件被包含在部署包中
  outputFileTracingIncludes: {
    "/**": [
      "node_modules/sharp/**/*",
      "node_modules/@img/sharp-linux-x64/**/*",
      "node_modules/@img/sharp-linuxmusl-x64/**/*",
      "node_modules/@img/sharp-libvips-linux-x64/**/*",
      "node_modules/@img/sharp-libvips-linuxmusl-x64/**/*",
    ],
  },
  // 确保 sharp 在服务端组件中被正确处理
  // 设置为外部包，不会被 webpack 打包，'sharp'件由 Node.js 运行时加载
  serverExternalPackages: ['sharp'],

  // 配置 webpack 确保 .node 文件被正确处理
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 确保 .node 文件不被 webpack 处理，而是作为外部资源
      config.externals = config.externals || [];
      // 对于 .node 文件，使用 file-loader 或 raw-loader 处理
      config.module.rules.push({
        test: /\.node$/,
        use: 'raw-loader',
      });
    }
    return config;
  },
};

export default nextConfig;
