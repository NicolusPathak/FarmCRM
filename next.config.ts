import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow large JSON bodies for the bulk customer import (1,400+ customers)
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
