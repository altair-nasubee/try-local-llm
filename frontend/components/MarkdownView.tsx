"use client";
// 応答の Markdown 表示（GitHub Flavored Markdown）。HTML は描画しない（rehype-raw は使わない）
import type { Element, ElementContent } from "hast";
import { createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { t } from "@/lib/i18n";
import { hasOpenFence } from "@/lib/markdown";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";
import styles from "./Chat.module.css";

function textOf(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

// 書きかけのフェンスの情報。components を描画のたびに作り直すと、
// react-markdown が要素を毎回作り直して図がちらつくため、値は Context で渡す
const FenceContext = createContext<{ openFence: boolean; end: number }>({ openFence: false, end: 0 });

function Pre({ node, children }: { node?: Element; children?: React.ReactNode }) {
  const { openFence, end } = useContext(FenceContext);
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
}

function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// 画像は読み込まない。AI の回答に外部の画像があると、表示しただけで URL（会話の内容を含みうる）が外部に送られるため。
// 見たいときに押して開けるよう、リンクにする
function Image({ src, alt }: { src?: string | Blob; alt?: string }) {
  const href = typeof src === "string" ? src : undefined;
  return <Link href={href}>{t("chat.imageLink", { name: alt || href || "" })}</Link>;
}

const components: Components = { pre: Pre, a: Link, img: Image };
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export function MarkdownView({ text, streaming }: { text: string; streaming: boolean }) {
  const fence = { openFence: streaming && hasOpenFence(text), end: text.trimEnd().length };
  return (
    <div className={styles.markdown}>
      <FenceContext.Provider value={fence}>
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
          {text}
        </ReactMarkdown>
      </FenceContext.Provider>
    </div>
  );
}
