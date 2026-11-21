// 配色の設定。将来の手動切り替えに備えて 3 値を持てる形にしておく（今回は "system" 固定）。
// "light" / "dark" を選んだときは <html data-theme="..."> を付ける（globals.css 参照）
export type Theme = "system" | "light" | "dark";

export function getTheme(): Theme {
  return "system";
}
