/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "*": ["public/**/*", ".next/static/**/*"],
  },
};

export default nextConfig;
