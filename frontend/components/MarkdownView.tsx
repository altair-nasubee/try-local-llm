"use client";
// 応答の Markdown 表示（GitHub Flavored Markdown）。HTML は描画しない（rehype-raw は使わない）
import type { Element, ElementContent } from "hast";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { hasOpenFence } from "@/lib/markdown";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";
import styles from "./Chat.module.css";

function textOf(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

export function MarkdownView({ text, streaming }: { text: string; streaming: boolean }) {
  const end = text.trimEnd().length;
  const openFence = streaming && hasOpenFence(text);

  const components: Components = {
    pre({ node, children }) {
      const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
      const classes = (code?.properties.className as string[] | undefined) ?? [];
      const language = classes.find((c) => c.startsWith("language-"))?.slice("language-".length);
      const raw = code ? textOf(code) : "";
      if (language === "mermaid") {
        // 書きかけ（本文の最後まで続く閉じていないフェンス）はコードのまま。閉じた時点で図にする
        const isLastBlock = (node?.position?.end.offset ?? 0) >= end;
        if (!(openFence && isLastBlock)) return <MermaidBlock code={raw.replace(/\n$/, "")} />;
      }
      const inner = code ? (children as React.ReactElement<{ children?: React.ReactNode }>).props?.children : children;
      return (
        <CodeBlock language={language} raw={raw.replace(/\n$/, "")}>
          {inner}
        </CodeBlock>
      );
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };

  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
