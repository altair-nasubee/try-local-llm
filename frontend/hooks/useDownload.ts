"use client";
// ダウンロード状態のポーリング。サーバー側で動くダウンロードの状態を受け取る
// （ブラウザを閉じても続き、開き直すと進捗ダイアログが出る）
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, t } from "@/lib/i18n";
import type { DownloadState } from "@/lib/types";

const URL_ = "/api/models/download";
const RUNNING_INTERVAL_MS = 1000;
const IDLE_INTERVAL_MS = 5000;

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    // サーバーの説明（空き容量の数値など）があればそれを、無ければコードを文言にする
    return body.message ?? errorText(body.error, t("download.failed"));
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function useDownload(opts: { onDone(model: string): void }) {
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const onDoneRef = useRef(opts.onDone);
  const handledDone = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    onDoneRef.current = opts.onDone;
  });

  const cancel = useCallback(async () => {
    const res = await fetch(URL_, { method: "DELETE" });
    if (res.ok) setState((await res.json()) as DownloadState);
  }, []);

  // 受け取った状態を反映する。done は（遷移を見ていなくても）onDone を呼んでから idle に戻す
  const apply = useCallback(
    async (next: DownloadState) => {
      setState(next);
      if (next.status === "done") {
        if (handledDone.current) return;
        handledDone.current = true;
        onDoneRef.current(next.model);
        await cancel();
      } else {
        handledDone.current = false;
      }
    },
    [cancel],
  );

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let status: DownloadState["status"] = "idle";
      try {
        const res = await fetch(URL_, { cache: "no-store" });
        if (res.ok && alive) {
          const next = (await res.json()) as DownloadState;
          status = next.status;
          await apply(next);
        }
      } catch {
        // 通信できないときは次の回に任せる
      }
      if (alive) timer = setTimeout(poll, status === "running" ? RUNNING_INTERVAL_MS : IDLE_INTERVAL_MS);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [apply, tick]);

  // 失敗したら理由（空き容量不足・busy など）を例外にする。状態は変えない
  const start = useCallback(async (model: string) => {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) throw new Error(await readError(res));
    setState((await res.json()) as DownloadState);
    // running の間隔でポーリングし直す
    setTick((n) => n + 1);
  }, []);

  return { state, start, cancel };
}
