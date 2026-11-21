// インライン SVG のアイコン。色は currentColor（CSS 変数から継承）
type Name = "trash" | "info" | "clip" | "lock" | "plus" | "close";

const PATHS: Record<Name, string> = {
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8h.01M11 12h1v4h1",
  clip: "M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
};

export function Icon({ name, label, size = 18 }: { name: Name; label?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: "none", verticalAlign: "middle" }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
