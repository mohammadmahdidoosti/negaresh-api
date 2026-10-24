/** Download the current edited output as a UTF-8 Markdown document. */

"use client";

import { useMounted } from "@/hooks/useMounted";
import { Icon } from "@/components/ui/Icon";

function filenameFrom(text: string): string {
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || "persian-article";
  const safe = title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0, 80).trim();
  return `${safe || "persian-article"}.md`;
}

export default function DownloadMarkdownButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const mounted = useMounted();
  const isDisabled = !mounted || disabled || !text;

  function handleDownload() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filenameFrom(text);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" onClick={handleDownload} disabled={isDisabled} className="outline-button">
      <Icon name="download" className="size-4" /> دریافت <span dir="ltr">.md</span>
    </button>
  );
}
