#!/usr/bin/env bash
# Tạo .env từ .env.example (nếu chưa có) và tự điền các chuỗi bí mật còn trống.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

fill() {
  local key="$1" val="$2"
  if grep -qE "^${key}=$" .env; then
    sed -i "s|^${key}=$|${key}=${val}|" .env
    echo "Đã tạo ${key}"
  fi
}

fill POSTGRES_PASSWORD "$(rand 32)"
fill JWT_SECRET "$(rand 64)"
fill MESSENGER_VERIFY_TOKEN "$(rand 24)"
if grep -qE "^ADMIN_PASSWORD=$" .env; then
  pw="$(rand 14)"
  sed -i "s|^ADMIN_PASSWORD=$|ADMIN_PASSWORD=${pw}|" .env
  echo "Mật khẩu admin lần đầu: ${pw}  (đăng nhập xong hãy đổi)"
fi
chmod 600 .env
echo "Xong. Mở .env để điền DOMAIN, PUBLIC_BASE_URL và các key hãng AI."
