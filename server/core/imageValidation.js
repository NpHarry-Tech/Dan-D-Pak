const signatures = {
  'image/jpeg': (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/webp': (bytes) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (bytes) => bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
};

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
