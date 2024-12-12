/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    experimental: {
        outputFileTracingIncludes: {
            '*': [
                'public/**/*',
                '.next/static/**/*',
            ],
        },
    },
};

export default nextConfig;
