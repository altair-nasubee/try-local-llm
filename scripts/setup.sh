#!/usr/bin/env bash
# Docker Engine と NVIDIA Container Toolkit を WSL の Ubuntu に導入する。
# 使い方：sudo bash scripts/setup.sh
# 導入済みの段階はスキップするので、何度実行しても安全。
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "$(id -u)" -eq 0 ] || fail "管理者権限が必要です" "sudo bash scripts/setup.sh で実行してください"
# sudo 実行中の $USER は root になるため、docker グループに入れる利用者は $SUDO_USER から取る
if [ -z "${SUDO_USER:-}" ] || [ "$SUDO_USER" = "root" ]; then
  fail "実行した利用者が分かりません" "root ではなく、普段の利用者から sudo bash scripts/setup.sh を実行してください"
fi

export DEBIAN_FRONTEND=noninteractive
DOCKER_PACKAGES=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)

installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

all_installed() {
  local p
  for p in "$@"; do installed "$p" || return 1; done
}

# 1. Docker Engine（公式の apt リポジトリ）
if all_installed "${DOCKER_PACKAGES[@]}"; then
  ok "Docker Engine は導入済みです"
else
  info "Docker Engine を導入します"
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y "${DOCKER_PACKAGES[@]}"
  ok "Docker Engine を導入しました"
fi

# 2. docker グループ（sudo なしで docker を使えるようにする）
if id -nG "$SUDO_USER" | tr ' ' '\n' | grep -qx docker; then
  ok "$SUDO_USER は docker グループに入っています"
else
  usermod -aG docker "$SUDO_USER"
  ok "$SUDO_USER を docker グループに追加しました（反映には WSL の再起動が必要です）"
fi

# 3. Docker の自動起動
systemctl enable --now docker
ok "Docker を起動しました（WSL の起動時にも自動で起動します）"

# 4. NVIDIA Container Toolkit（公式の apt リポジトリ）
if installed nvidia-container-toolkit; then
  ok "NVIDIA Container Toolkit は導入済みです"
else
  info "NVIDIA Container Toolkit を導入します"
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey |
    gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list |
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      >/etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update
  apt-get install -y nvidia-container-toolkit
  ok "NVIDIA Container Toolkit を導入しました"
fi

# 5. Docker に NVIDIA ランタイムを登録
if [ -f /etc/docker/daemon.json ] && grep -q '"nvidia"' /etc/docker/daemon.json; then
  ok "Docker に NVIDIA ランタイムは登録済みです"
else
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
  ok "Docker に NVIDIA ランタイムを登録しました"
fi

# 6. 確認
info "コンテナから GPU が見えるか確認します"
if docker run --rm --gpus all ubuntu nvidia-smi -L; then
  ok "セットアップが完了しました"
  info "docker グループを反映するため、PowerShell で wsl --shutdown を実行し、WSL を開き直してください"
else
  fail "コンテナから GPU が見えません" "Windows 側の NVIDIA ドライバーを更新し、WSL で nvidia-smi が動くか確認してください"
fi
