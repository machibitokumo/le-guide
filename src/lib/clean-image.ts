import sharp from "sharp";
import { randomUUID } from "crypto";

export interface CleanedImage {
  buffer: Buffer;
  filename: string;
  mimeType: "image/jpeg";
}

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

export type DetectedFormat = "jpeg" | "png" | "heic" | "pdf" | "unknown";

export function detectFormat(buffer: Buffer): DetectedFormat {
  if (buffer.length < 12) return "unknown";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) return "png";
  if (
    buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
  ) return "pdf";
  if (
    buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
  ) {
    const brand = buffer.toString("ascii", 8, 12);
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  return "unknown";
}

export async function cleanImage(input: Buffer): Promise<CleanedImage> {
  const quality = Math.floor(Math.random() * 11) + 82; // 82-92

  // .rotate() physically corrects orientation from EXIF, then we strip all metadata
  const buffer = await sharp(input)
    .rotate()
    .removeAlpha()
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  const filename = `${randomUUID()}.jpg`;

  return { buffer, filename, mimeType: "image/jpeg" };
}

/** Extract raw EXIF buffer from a JPEG (the APP1 payload, starting with "Exif\0\0"). */
export async function extractExif(input: Buffer): Promise<Buffer | null> {
  const meta = await sharp(input).metadata();
  return meta.exif ?? null;
}

/**
 * Inject a raw EXIF buffer into a clean JPEG by inserting an APP1 segment
 * right after the SOI marker (FF D8).
 */
export function injectExif(jpegBuffer: Buffer, exifBuffer: Buffer): Buffer {
  if (jpegBuffer[0] !== 0xFF || jpegBuffer[1] !== 0xD8) return jpegBuffer;

  // APP1 segment: FF E1 + 2-byte BE length (includes length field itself) + exif data
  const segLen = exifBuffer.length + 2;
  const app1 = Buffer.allocUnsafe(4 + exifBuffer.length);
  app1[0] = 0xFF;
  app1[1] = 0xE1;
  app1.writeUInt16BE(segLen, 2);
  exifBuffer.copy(app1, 4);

  return Buffer.concat([jpegBuffer.subarray(0, 2), app1, jpegBuffer.subarray(2)]);
}

export async function getImageDimensions(input: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(input).metadata();
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}
