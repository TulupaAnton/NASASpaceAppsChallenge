/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean),
};

export default nextConfig;
