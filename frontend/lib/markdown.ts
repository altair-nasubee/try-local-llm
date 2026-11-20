// Markdown の補助

// 行頭の ``` の数が奇数なら、閉じていないコードブロックがある（ストリーミング中の書きかけ）
export function hasOpenFence(md: string): boolean {
  const fences = md.split("\n").filter((line) => /^\s{0,3}```/.test(line)).length;
  return fences % 2 === 1;
}
