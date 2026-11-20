// 画面の数値表示

// 18e9 → "18"、6.6e9 → "6.6"（小数第 1 位まで、末尾の .0 は付けない）
export function formatGb(bytes: number): string {
  return String(Number((bytes / 1e9).toFixed(1)));
}

// 進捗の表示用：常に小数第 1 位まで（11.2 / 18.0）
export function formatGbFixed(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

export function percent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.floor((completed / total) * 100));
}
