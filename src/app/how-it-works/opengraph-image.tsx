import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "نگارش | مهندسی کلمات؛ فراتر از یک بازنویسی ساده";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Explicit word layout preserves RTL order in the image renderer.
function PersianLine({ text, fontSize, color = "#fafafa" }: { text: string; fontSize: number; color?: string }) {
  return <div style={{ display: "flex", flexDirection: "row-reverse", gap: fontSize * 0.23, fontSize, color }}>{text.split(" ").map((word, index) => <span key={index}>{word}</span>)}</div>;
}

export default async function OpenGraphImage() {
  const [font, logo] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/Vazirmatn-Bold.ttf")),
    readFile(join(process.cwd(), "src/assets/logo-light.svg")),
  ]);
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", width: "100%", height: "100%", padding: 64, background: "#09090b", color: "#fafafa", fontFamily: "Vazirmatn", border: "1px solid #27272a" }}>
      {/* ImageResponse uses native image elements for embedded assets. */}
      <img src={`data:image/svg+xml;base64,${logo.toString("base64")}`} alt="" width={150} height={46} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 20 }}>
        <PersianLine text="پشت‌ صحنه فناوری نگارش" fontSize={23} color="#a1a1aa" />
        <PersianLine text="مهندسی کلمات" fontSize={64} />
        <PersianLine text="فراتر از یک بازنویسی ساده" fontSize={49} color="#a1a1aa" />
      </div>
      <div style={{ display: "flex", width: "100%", justifyContent: "space-between", borderTop: "1px solid #27272a", paddingTop: 24, color: "#a1a1aa", fontSize: 20 }}><span>NEGARESH</span><PersianLine text="حفظ داده‌ها · بازبینی تحریریه · نثر طبیعی فارسی" fontSize={20} color="#a1a1aa" /></div>
    </div>,
    { ...size, fonts: [{ name: "Vazirmatn", data: font, style: "normal", weight: 700 }] },
  );
}
