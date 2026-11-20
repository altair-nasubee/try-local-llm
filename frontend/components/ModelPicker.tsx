"use client";
import { useId } from "react";
import { t } from "@/lib/i18n";
import type { ModelEntry } from "@/lib/types";
import { Icon } from "./Icon";
import { InfoPopover } from "./InfoPopover";
import styles from "./ModelPicker.module.css";

// Ollama が止まっている間は有無が分からないので、状態を付けない（spec 11-12）
function optionLabel(m: ModelEntry, ollamaUp: boolean): string {
  const parts = [m.name];
  if (ollamaUp) parts.push(m.installed ? t("model.installed") : t("model.notInstalled"));
  if (m.tier === "slow") parts.push(`⚠ ${t("model.slow")}`);
  return parts.join(" ");
}

export function ModelPicker(props: {
  models: ModelEntry[];
  selectedModel: string;
  defaultModel: string;
  ollamaUp: boolean;
  conversationLocked: boolean; // 会話中（1 セッション = 1 モデル）
  disabled: boolean; // ダウンロード中などの操作禁止
  onSelect(name: string): void;
  onDeleteRequest(name: string): void;
}) {
  const id = useId();
  const selected = props.models.find((m) => m.name === props.selectedModel);
  // 一覧に無いモデル（削除済みモデルの過去セッションなど）も選択中として見せる
  const missing = props.selectedModel !== "" && !selected;
  const showTrash = props.ollamaUp && !!selected?.installed;
  const isDefault = props.selectedModel === props.defaultModel;

  return (
    <div className={styles.picker}>
      <label htmlFor={id} className={styles.label}>
        {t("model.label")}
      </label>
      <select
        id={id}
        className={styles.select}
        value={props.selectedModel}
        disabled={props.disabled || props.conversationLocked}
        onChange={(e) => props.onSelect(e.target.value)}
      >
        {missing && <option value={props.selectedModel}>{props.selectedModel}</option>}
        {props.models.map((m) => (
          <option key={m.name} value={m.name}>
            {optionLabel(m, props.ollamaUp)}
          </option>
        ))}
      </select>
      {props.conversationLocked && (
        <span className={styles.lock} title={t("model.locked")}>
          <Icon name="lock" label={t("model.locked")} />
        </span>
      )}
      <InfoPopover label={t("model.helpButton")} text={t("model.help")} disabled={props.disabled} />
      {showTrash && (
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("delete.button")}
          title={isDefault ? t("delete.defaultModel") : t("delete.button")}
          disabled={props.disabled || isDefault}
          onClick={() => props.onDeleteRequest(props.selectedModel)}
        >
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}
