import { createHash } from 'node:crypto';

export function contentAddressedAssetName(prefix, bytes, extension) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `${String(prefix || 'asset_')}${digest.slice(0, 32)}${extension}`;
}

export const immutableUploadStaticOptions = {
  etag: true,
  lastModified: true,
  maxAge: '1y',
  immutable: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
};

export const bundledAssetStaticOptions = {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
};
