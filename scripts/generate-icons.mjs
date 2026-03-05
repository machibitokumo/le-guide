import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// SVG source — dark bg, white "LI" monogram + image-frame accent
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#0a0a0a"/>
  <!-- image frame corners -->
  <path d="M96 96 L96 160" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M96 96 L160 96" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M416 96 L416 160" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M416 96 L352 96" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M96 416 L96 352" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M96 416 L160 416" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M416 416 L416 352" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <path d="M416 416 L352 416" stroke="#ffffff" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.25"/>
  <!-- "L" -->
  <text x="118" y="330" font-family="Georgia, serif" font-size="220" font-weight="700" fill="#ffffff" letter-spacing="-8">L</text>
  <!-- accent dot -->
  <circle cx="362" cy="280" r="28" fill="#ffffff" opacity="0.9"/>
</svg>`;

const svgBuffer = Buffer.from(svg);

async function generate() {
  // 512x512 PNG — og / general
  await sharp(svgBuffer).resize(512, 512).png().toFile(resolve(root, "public/icon-512.png"));
  console.log("✓ public/icon-512.png");

  // 192x192 PNG — PWA
  await sharp(svgBuffer).resize(192, 192).png().toFile(resolve(root, "public/icon-192.png"));
  console.log("✓ public/icon-192.png");

  // 180x180 PNG — Apple touch icon (white background, dark elements)
  const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" rx="112" fill="#ffffff"/>
    <path d="M96 96 L96 160" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M96 96 L160 96" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M416 96 L416 160" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M416 96 L352 96" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M96 416 L96 352" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M96 416 L160 416" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M416 416 L416 352" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <path d="M416 416 L352 416" stroke="#0a0a0a" stroke-width="20" stroke-linecap="round" fill="none" opacity="0.2"/>
    <text x="118" y="330" font-family="Georgia, serif" font-size="220" font-weight="700" fill="#0a0a0a" letter-spacing="-8">L</text>
    <circle cx="362" cy="280" r="28" fill="#0a0a0a" opacity="0.85"/>
  </svg>`;
  await sharp(Buffer.from(appleSvg)).resize(180, 180).png().toFile(resolve(root, "src/app/apple-icon.png"));
  console.log("✓ src/app/apple-icon.png");

  // 32x32 PNG → favicon (Next.js picks up icon.png in app dir)
  await sharp(svgBuffer).resize(32, 32).png().toFile(resolve(root, "src/app/icon.png"));
  console.log("✓ src/app/icon.png");

  // OG image 1200x630 — social sharing
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
    <rect width="1200" height="630" fill="#0a0a0a"/>
    <rect x="80" y="80" width="470" height="470" rx="80" fill="#111111"/>
    <path d="M140 140 L140 200" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M140 140 L200 140" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M490 140 L490 200" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M490 140 L430 140" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M140 490 L140 430" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M140 490 L200 490" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M490 490 L490 430" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <path d="M490 490 L430 490" stroke="#ffffff" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.3"/>
    <text x="163" y="445" font-family="Georgia, serif" font-size="280" font-weight="700" fill="#ffffff" letter-spacing="-4">L</text>
    <circle cx="436" cy="370" r="22" fill="#ffffff" opacity="0.9"/>
    <text x="620" y="355" font-family="Georgia, serif" font-size="96" font-weight="700" fill="#ffffff">Le Image</text>
    <text x="622" y="420" font-family="monospace" font-size="28" fill="#ffffff" opacity="0.35">AI-powered image editing</text>
  </svg>`;
  await sharp(Buffer.from(ogSvg)).resize(1200, 630).png().toFile(resolve(root, "public/og-image.png"));
  console.log("✓ public/og-image.png");

  console.log("\nAll icons generated!");
}

generate().catch(console.error);
