#!/usr/bin/env bash
# Sao lưu CSDL và file của Hub vào thư mục backups/ (giữ 14 bản gần nhất).
# Chạy mỗi đêm bằng cron:  0 2 * * * /duong-dan/thilop-ai-hub/deploy/backup.sh >> /var/log/hub-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M)"

docker compose exec -T db pg_dump -U hub -d hub -Fc > "backups/db-${stamp}.dump"
# --user root: image chạy bằng user hub (uid 10001), không ghi được vào thư mục backups/ của máy chủ (chủ là root)
if docker compose run --rm --no-deps -T --user root -v "$(pwd)/backups:/backup" --entrypoint sh api \
  -c "[ -d /data/files ] || exit 3; tar czf /backup/files-${stamp}.tgz -C /data files"; then :
elif [ $? -eq 3 ]; then echo "Chưa có file nào để sao lưu"
else echo "LỖI: sao lưu file thất bại" >&2; exit 1
fi

ls -1t backups/db-*.dump | tail -n +15 | xargs -r rm --
ls -1t backups/files-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Đã sao lưu ${stamp}. Nên chép thư mục backups/ sang máy khác hoặc Google Drive định kỳ."
