"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionSummary } from "@/lib/types";

export function useSessions() {
  const [list, setList] = useState<SessionSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (res.ok) setList((await res.json()) as SessionSummary[]);
    } catch {
      // 次の取得に任せる
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // 削除できなければ例外（ダウンロード中の 409 など）
  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      await refresh();
    },
    [refresh],
  );

  return { list, refresh, remove };
}
