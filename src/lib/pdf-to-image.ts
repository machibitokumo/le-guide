import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";

// Use inline worker to avoid serving a separate worker file
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * Render the first page of a PDF to a JPEG File object.
 * Renders at 3x scale for high-quality OCR.
 */
export async function pdfToImage(pdfFile: File): Promise<File> {
  const buffer = await pdfFile.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);

  const scale = 3;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92)
  );

  const name = pdfFile.name.replace(/\.pdf$/i, ".jpg");
  return new File([blob], name, { type: "image/jpeg" });
}
