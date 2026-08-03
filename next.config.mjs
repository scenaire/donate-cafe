/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ALERT_WIDGET_TOKEN and DASHBOARD_TOKEN ride in query strings, so without
  // this any outbound request from those pages (Google Fonts, Stripe's hosted
  // QR page) leaks the full URL — token included — in a Referer header.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
