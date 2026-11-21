"use client";
import { useEffect, useId, useState } from "react";
import { CodeBlock } from "./CodeBlock";
import styles from "./Chat.module.css";

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Mermaid の図。描けるまで・描けなかったときはコードのまま表示する（例外を外に出さない）
export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: isDark() ? "dark" : "default", securityLevel: "strict" });
        await mermaid.parse(code);
        const result = await mermaid.render(id, code);
        if (alive) setSvg(result.svg);
      } catch {
        // 記述の誤りはコードのまま見せる。mermaid が残した作業用の要素を消す
        document.getElementById(`d${id}`)?.remove();
        if (alive) setSvg(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, id]);

  if (svg === null) return <CodeBlock language="mermaid" raw={code} />;
  // securityLevel: "strict" で mermaid がサニタイズした SVG
  return <div className={styles.mermaid} dangerouslySetInnerHTML={{ __html: svg }} />;
}
