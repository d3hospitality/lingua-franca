// ═══════════════════════════════════════════════════════════════════
// PNG Encoder — Grayscale (8-bit, no alpha)
// Inherited from soPHICON / sommNI pipeline
// ═══════════════════════════════════════════════════════════════════

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
}

function adler32(buf: Uint8Array): number {
  let a = 1, b = 0;
  const MOD_ADLER = 65521;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  return (b << 16) | a;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(len + 12);
  chunk[0] = (len >>> 24) & 0xff;
  chunk[1] = (len >>> 16) & 0xff;
  chunk[2] = (len >>> 8) & 0xff;
  chunk[3] = len & 0xff;
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = crc32(chunk.slice(4, len + 8));
  chunk[len + 8] = (crc >>> 24) & 0xff;
  chunk[len + 9] = (crc >>> 16) & 0xff;
  chunk[len + 10] = (crc >>> 8) & 0xff;
  chunk[len + 11] = crc & 0xff;
  return chunk;
}

export function encodeGrayscalePng(width: number, height: number, data: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;  // Bit depth
  ihdr[9] = 0;  // Grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const ihdrChunk = writeChunk("IHDR", ihdr);

  const scanlineLen = width + 1;
  const totalDataLen = scanlineLen * height;
  const rawData = new Uint8Array(totalDataLen);
  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLen;
    rawData[offset] = 0;
    rawData.set(data.subarray(y * width, (y + 1) * width), offset + 1);
  }

  const blocks: Uint8Array[] = [];
  blocks.push(new Uint8Array([0x78, 0x01]));
  let offset = 0;
  while (offset < rawData.length) {
    let len = Math.min(65535, rawData.length - offset);
    const isLast = (offset + len) === rawData.length;
    const header = new Uint8Array(5);
    header[0] = isLast ? 0x01 : 0x00;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    const nlen = ~len & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    blocks.push(header);
    blocks.push(rawData.subarray(offset, offset + len));
    offset += len;
  }

  const adler = adler32(rawData);
  const adlerFooter = new Uint8Array(4);
  adlerFooter[0] = (adler >>> 24) & 0xff;
  adlerFooter[1] = (adler >>> 16) & 0xff;
  adlerFooter[2] = (adler >>> 8) & 0xff;
  adlerFooter[3] = adler & 0xff;
  blocks.push(adlerFooter);

  let idatLen = 0;
  for (const b of blocks) idatLen += b.length;
  const idatData = new Uint8Array(idatLen);
  let idatOffset = 0;
  for (const b of blocks) {
    idatData.set(b, idatOffset);
    idatOffset += b.length;
  }

  const idatChunk = writeChunk("IDAT", idatData);
  const iendChunk = writeChunk("IEND", new Uint8Array(0));
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const totalLength = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const finalBuffer = new Uint8Array(totalLength);
  let finalOffset = 0;
  finalBuffer.set(signature, finalOffset); finalOffset += signature.length;
  finalBuffer.set(ihdrChunk, finalOffset); finalOffset += ihdrChunk.length;
  finalBuffer.set(idatChunk, finalOffset); finalOffset += idatChunk.length;
  finalBuffer.set(iendChunk, finalOffset);
  return finalBuffer;
}
