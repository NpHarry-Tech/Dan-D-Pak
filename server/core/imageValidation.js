const signatures = {
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/webp': (bytes) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (bytes) => bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  'image/bmp': (bytes) => bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM',
  'image/tiff': (bytes) => bytes.length >= 4 &&
    ['49492a00', '4d4d002a'].includes(bytes.subarray(0, 4).toString('hex')),
  'image/heif': (bytes) => bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'].includes(bytes.toString('ascii', 8, 12)),
};

export function detectImageMime(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  for (const [mime, matches] of Object.entries(signatures)) {
    if (matches(bytes)) return mime;
  }
  return null;
}

export function hasImageSignature(bytes, mimeType) {
  return Buffer.isBuffer(bytes) && signatures[mimeType]?.(bytes) === true;
}

export function requireImageSignature(bytes, mimeType) {
  if (!hasImageSignature(bytes, mimeType)) {
    const error = new Error('Nội dung file không khớp định dạng ảnh đã khai báo');
    error.status = 400;
    error.code = 'IMAGE_SIGNATURE_MISMATCH';
    throw error;
  }
}
