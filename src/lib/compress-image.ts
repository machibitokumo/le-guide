"use client";

const MAX_DIMENSION = 1800;
const MAX_BYTES = 3.8 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

async function isHeic(file: File): Promise<boolean> {
  if (file.size < 12) return false;
  const view = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  // ftyp box: bytes 4-7 should be "ftyp", bytes 8-11 = brand
  if (view[4] !== 0x66 || view[5] !== 0x74 || view[6] !== 0x79 || view[7] !== 0x70) return false;
  const brand = String.fromCharCode(view[8], view[9], view[10], view[11]);
  return HEIC_BRANDS.has(brand);
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && !file.name.match(/\.(heic|heif)$/i)) return file;

  const heic = await isHeic(file);

  // Skip re-encode only for plain JPEGs that are already small enough
  if (!heic && file.size <= MAX_BYTES && file.type === "image/jpeg") {
    const dims = await getDimensions(file);
    if (dims.width <= MAX_DIMENSION && dims.height <= MAX_DIMENSION) return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    if (heic) {
      throw new Error("This iPhone photo (HEIC) couldn't be decoded in your browser. Convert to JPEG in Photos, then try again.");
    }
    throw err;
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const targetW = Math.round(bitmap.width * scale);
  const targetH = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob: Blob | null = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg", lastModified: file.lastModified });
}

async function getDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}
