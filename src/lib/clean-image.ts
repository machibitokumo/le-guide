import sharp from "sharp";
import { randomUUID } from "crypto";

export interface CleanedImage {
  buffer: Buffer;
  filename: string;
  mimeType: "image/jpeg";
}

export async function cleanImage(input: Buffer): Promise<CleanedImage> {
  const quality = Math.floor(Math.random() * 11) + 82; // 82-92

  const buffer = await sharp(input)
    .rotate() // auto-rotate based on EXIF before stripping
    .removeAlpha()
    .jpeg({ quality, mozjpeg: true })
    .withMetadata({}) // strips all EXIF/metadata
    .toBuffer();

  const filename = `${randomUUID()}.jpg`;

  return { buffer, filename, mimeType: "image/jpeg" };
}

export async function getImageDimensions(input: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(input).metadata();
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}
