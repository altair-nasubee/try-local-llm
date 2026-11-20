"use client";
// 画面全体。状態（選択中のモデル・表示中のセッション・操作ロック）をここで持つ
import { useEffect, useRef, useState } from "react";
import { useDownload } from "@/hooks/useDownload";
import { useModels } from "@/hooks/useModels";
import { useSessions } from "@/hooks/useSessions";
import { formatGb } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ModelEntry, SessionSummary } from "@/lib/types";
import styles from "./AppShell.module.css";
import { ChatView } from "./ChatView";
import { ConfirmDialog } from "./ConfirmDialog";
import { DownloadDialog } from "./DownloadDialog";
import { ModelPicker } from "./ModelPicker";
import { SessionList } from "./SessionList";

export type UiState = {
  selectedModel: string;
  currentSessionId: string | null;
  locked: boolean; // ダウンロード中（エラー表示を閉じるまで含む）
};

export function AppShell() {
  const { models, defaultModel, ollamaUp, refresh: refreshModels } = useModels();
  const sessions = useSessions();

  // null はデフォルトモデル（起動直後は新しいチャット＋デフォルトモデル）
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // ダウンロード完了の通知（非同期）から今の値を読むための写し
  const currentSessionRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  const [confirmDownload, setConfirmDownload] = useState<ModelEntry | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<ModelEntry | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const download = useDownload({
    onDone(model) {
      void refreshModels();
      setConfirmDownload(null);
      // 完了したモデルを選択状態にする（会話中はモデルを変えない）
      if (currentSessionRef.current === null) setChosenModel(model);
    },
  });

  const ui: UiState = {
    selectedModel: chosenModel ?? defaultModel,
    currentSessionId,
    locked: download.state.status === "running" || download.state.status === "error",
  };

  function selectModel(name: string) {
    const entry = models.find((m) => m.name === name);
    // Ollama が止まっている間は有無が分からないので、ダウンロードを勧めない
    if (ollamaUp && entry && !entry.installed) {
      setStartError(null);
      setConfirmDownload(entry);
      return;
    }
    setChosenModel(name);
  }

  function newChat() {
    setCurrentSessionId(null);
    const entry = models.find((m) => m.name === ui.selectedModel);
    if (ollamaUp && !entry?.installed) setChosenModel(null);
  }

  function openSession(s: SessionSummary) {
    setCurrentSessionId(s.id);
    setChosenModel(s.model);
  }

  async function startDownload() {
    if (!confirmDownload) return;
    setStarting(true);
    try {
      await download.start(confirmDownload.name);
      setConfirmDownload(null);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  function closeDownloadDialog() {
    // エラー表示を閉じた時点で操作禁止を解除する（spec 11-15）
    if (download.state.status === "error") void download.cancel();
    setConfirmDownload(null);
  }

  async function deleteModel() {
    if (!modelToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(modelToDelete.name)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(t("delete.failed"));
      await refreshModels();
      // 使用中のモデルを消したらデフォルトモデルに切り替え、会話中なら新しいチャットにする（spec 6.3・11-9）
      if (modelToDelete.name === ui.selectedModel) {
        setChosenModel(null);
        setCurrentSessionId(null);
      }
      setModelToDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSession() {
    if (!sessionToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await sessions.remove(sessionToDelete.id);
      if (sessionToDelete.id === currentSessionId) newChat();
      setSessionToDelete(null);
    } catch {
      setDeleteError(t("delete.failed"));
    } finally {
      setDeleting(false);
    }
  }

  function cancelDelete() {
    setModelToDelete(null);
    setSessionToDelete(null);
    setDeleteError(null);
  }

  return (
    <div className={styles.shell}>
      <SessionList
        list={sessions.list}
        currentId={currentSessionId}
        disabled={ui.locked}
        onNew={newChat}
        onOpen={openSession}
        onDeleteRequest={(s) => setSessionToDelete(s)}
      />
      <main className={styles.main}>
        <header className={styles.header}>
          <ModelPicker
            models={models}
            selectedModel={ui.selectedModel}
            defaultModel={defaultModel}
            ollamaUp={ollamaUp}
            conversationLocked={currentSessionId !== null}
            disabled={ui.locked}
            onSelect={selectModel}
            onDeleteRequest={(name) => setModelToDelete(models.find((m) => m.name === name) ?? null)}
          />
        </header>
        <section className={styles.chat} aria-label={t("app.title")}>
          <ChatView
            sessionId={currentSessionId}
            model={ui.selectedModel}
            models={models}
            ollamaUp={ollamaUp}
            locked={ui.locked}
            onSessionCreated={(s) => {
              setCurrentSessionId(s.id);
              void sessions.refresh();
            }}
            onDone={() => void sessions.refresh()}
          />
        </section>
      </main>

      <DownloadDialog
        confirm={confirmDownload}
        state={download.state}
        startError={startError}
        starting={starting}
        onStart={() => void startDownload()}
        onClose={closeDownloadDialog}
        onAbort={() => void download.cancel()}
      />
      {modelToDelete && (
        <ConfirmDialog
          title={t("delete.confirmTitle", {
            name: modelToDelete.name,
            size: modelToDelete.sizeBytes === null ? "?" : formatGb(modelToDelete.sizeBytes),
          })}
          confirmLabel={t("delete.confirm")}
          busy={deleting}
          error={deleteError}
          onConfirm={() => void deleteModel()}
          onCancel={cancelDelete}
        />
      )}
      {sessionToDelete && (
        <ConfirmDialog
          title={t("session.deleteConfirm", { title: sessionToDelete.title })}
          confirmLabel={t("delete.confirm")}
          busy={deleting}
          error={deleteError}
          onConfirm={() => void deleteSession()}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
}
