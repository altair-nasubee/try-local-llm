"use client";
// モデル一覧。Ollama が止まっている間は 5 秒ごとに取り直す（復帰を画面に反映するため）
import { useCallback, useEffect, useState } from "react";
import type { ModelEntry, ModelsResponse } from "@/lib/types";

const RETRY_WHILE_DOWN_MS = 5000;

export function useModels() {
  const [data, setData] = useState<ModelsResponse>({ models: [], defaultModel: "", ollamaUp: true });
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (!res.ok) return;
      setData((await res.json()) as ModelsResponse);
      setLoaded(true);
    } catch {
      // 次の取得に任せる
    }
  }, []);

  useEffect(() => {
    // 初回の取得（結果は非同期に state へ入る）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loaded || data.ollamaUp) return;
    const timer = setInterval(() => void refresh(), RETRY_WHILE_DOWN_MS);
    return () => clearInterval(timer);
  }, [loaded, data.ollamaUp, refresh]);

  return {
    models: data.models as ModelEntry[],
    defaultModel: data.defaultModel,
    ollamaUp: data.ollamaUp,
    loaded,
    refresh,
  };
}
