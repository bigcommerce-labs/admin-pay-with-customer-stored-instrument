/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    styledComponents: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Admin panel loads the app in an iframe on *.mybigcommerce.com
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://*.mybigcommerce.com https://*.bigcommerce.com" },
        ],
      },
    ];
  },
};

export default nextConfig;
