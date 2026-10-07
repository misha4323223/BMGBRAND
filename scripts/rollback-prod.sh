#!/bin/bash
# Откат продового контейнера Yandex Serverless Containers на прежнюю ревизию.
# См. docs/ROLLBACK-1C.md — это «уровень 1», прод без Git (секунды).
#
#   ./scripts/rollback-prod.sh            — показать список ревизий и подсказку
#   ./scripts/rollback-prod.sh <rev-id>   — сделать ревизию активной (с подтверждением)
#
# Требуется настроенный yc CLI с правами serverless.containers.editor.
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-bmg-app}"

yc serverless container revision list --container-name "$CONTAINER_NAME"

if [ $# -lt 1 ]; then
  echo
  echo "Укажите ID ревизии для отката: ./scripts/rollback-prod.sh <revision-id>"
  exit 0
fi

REV="$1"
read -r -p "Сделать активной ревизию $REV контейнера $CONTAINER_NAME? [y/N] " ans
case "$ans" in
  [yY] | [yY][eE][sS]) ;;
  *)
    echo "Отменено."
    exit 1
    ;;
esac

yc serverless containers rollback --name "$CONTAINER_NAME" --revision-id "$REV"
echo "Готово: активная ревизия — $REV"
