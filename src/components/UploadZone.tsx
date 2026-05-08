"use client";

import { useCallback, useState, useRef } from "react";

interface UploadZoneProps {
  onUpload: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = /^(image\/(jpeg|png)|application\/pdf)$/;

export default function UploadZone({ onUpload, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndUpload = useCallback(
    async (file: File) => {
      setError(null);

      if (!ACCEPTED_TYPES.test(file.type)) {
        setError("Only JPEG, PNG, and PDF files are accepted.");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("File must be under 10 MB.");
        return;
      }

      let imageFile = file;

      if (file.type === "application/pdf") {
        try {
          setConverting(true);
          const { pdfToImage } = await import("@/lib/pdf-to-image");
          imageFile = await pdfToImage(file);
        } catch {
          setError("Failed to convert PDF. Try a JPEG or PNG instead.");
          setConverting(false);
          return;
        } finally {
          setConverting(false);
        }
      }

      try {
        const { compressImage } = await import("@/lib/compress-image");
        imageFile = await compressImage(imageFile);
      } catch {
        // compression is best-effort — fall back to the original file
      }

      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      const url = URL.createObjectURL(imageFile);
      prevUrlRef.current = url;
      setPreview(url);
      onUpload(imageFile);
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndUpload(file);
    },
    [validateAndUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = () => inputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndUpload(file);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onClick={disabled || converting ? undefined : handleClick}
        onDrop={disabled || converting ? undefined : handleDrop}
        onDragOver={disabled || converting ? undefined : handleDragOver}
        onDragLeave={disabled || converting ? undefined : handleDragLeave}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200
          ${disabled || converting ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
          ${isDragging ? "border-accent bg-accent/5 scale-[1.02]" : "border-border"}
        `}
      >
        {converting ? (
          <div className="space-y-3 py-8">
            <p className="text-foreground/50 text-xs font-mono animate-pulse">Converting PDF...</p>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <img
              src={preview}
              alt="Receipt preview"
              className="max-h-48 mx-auto rounded-lg object-contain"
            />
            <p className="text-sm text-foreground/50">Receipt loaded</p>
          </div>
        ) : (
          <div className="space-y-3 py-8">
            <div className="text-4xl opacity-30">&#x1f4f7;</div>
            <p className="text-foreground/30 text-xs">JPEG, PNG, or PDF — max 10 MB</p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error && (
        <p className="mt-3 text-center text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
