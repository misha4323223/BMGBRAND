#!/bin/bash
set -e

# ─── Конфиг Yandex Cloud (заполнить один раз) ────────────────────────────────
YC_REGISTRY_ID="YOUR_REGISTRY_ID"          # cr.yandex/<id>
YC_CONTAINER_ID="YOUR_CONTAINER_ID"        # из консоли → Serverless Containers
YC_SERVICE_ACCOUNT_ID="YOUR_SA_ID"         # сервисный аккаунт с ролями
YC_FOLDER_ID="YOUR_FOLDER_ID"              # ID каталога (folder)
IMAGE_NAME="bmgbrand"
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE=".env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "Ошибка: файл $ENV_FILE не найден."
  echo "Скопируй .env.production.example → .env.production и заполни ключи."
  exit 1
fi

# Читаем переменные из .env.production
export $(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' | xargs)

# Проверка обязательных переменных
REQUIRED_VARS=(
  YDB_ENDPOINT YDB_DATABASE YDB_SA_KEY
  YANDEX_STORAGE_BUCKET_NAME YANDEX_STORAGE_ACCESS_KEY YANDEX_STORAGE_SECRET_KEY
  YOOKASSA_SHOP_ID YOOKASSA_SECRET_KEY
  TBANK_TERMINAL_KEY TBANK_SECRET_KEY
  CDEK_CLIENT_ID CDEK_CLIENT_SECRET
  TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS
  DATABASE_URL
)

MISSING=0
for VAR in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!VAR}" ]; then
    echo "⚠ Не заполнена переменная: $VAR"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Заполни недостающие переменные в $ENV_FILE и запусти скрипт снова."
  exit 1
fi

# Формируем тег образа
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FULL_IMAGE="cr.yandex/${YC_REGISTRY_ID}/${IMAGE_NAME}:${TIMESTAMP}"
LATEST_IMAGE="cr.yandex/${YC_REGISTRY_ID}/${IMAGE_NAME}:latest"

echo "=== Сборка Docker-образа ==="
docker build -t "$FULL_IMAGE" -t "$LATEST_IMAGE" .

echo ""
echo "=== Авторизация в Container Registry ==="
yc container registry configure-docker

echo ""
echo "=== Пуш образа в реестр ==="
docker push "$FULL_IMAGE"
docker push "$LATEST_IMAGE"

echo ""
echo "=== Деплой новой ревизии ==="
yc serverless container revision deploy \
  --container-id "$YC_CONTAINER_ID" \
  --image "$FULL_IMAGE" \
  --service-account-id "$YC_SERVICE_ACCOUNT_ID" \
  --memory 512MB \
  --cores 1 \
  --core-fraction 100 \
  --concurrency 16 \
  --execution-timeout 60s \
  --environment "NODE_ENV=production" \
  --environment "PORT=8080" \
  --environment "YDB_ENDPOINT=${YDB_ENDPOINT}" \
  --environment "YDB_DATABASE=${YDB_DATABASE}" \
  --environment "YDB_SA_KEY=${YDB_SA_KEY}" \
  --environment "YANDEX_STORAGE_BUCKET_NAME=${YANDEX_STORAGE_BUCKET_NAME}" \
  --environment "YANDEX_STORAGE_ACCESS_KEY=${YANDEX_STORAGE_ACCESS_KEY}" \
  --environment "YANDEX_STORAGE_SECRET_KEY=${YANDEX_STORAGE_SECRET_KEY}" \
  --environment "YANDEX_DELIVERY_TOKEN=${YANDEX_DELIVERY_TOKEN}" \
  --environment "YANDEX_DELIVERY_PLATFORM_STATION_ID=${YANDEX_DELIVERY_PLATFORM_STATION_ID}" \
  --environment "YOOKASSA_SHOP_ID=${YOOKASSA_SHOP_ID}" \
  --environment "YOOKASSA_SECRET_KEY=${YOOKASSA_SECRET_KEY}" \
  --environment "TBANK_TERMINAL_KEY=${TBANK_TERMINAL_KEY}" \
  --environment "TBANK_SECRET_KEY=${TBANK_SECRET_KEY}" \
  --environment "OZON_PAY_ACCESS_KEY=${OZON_PAY_ACCESS_KEY}" \
  --environment "OZON_PAY_SECRET_KEY=${OZON_PAY_SECRET_KEY}" \
  --environment "OZON_PAY_NOTIFICATION_SECRET=${OZON_PAY_NOTIFICATION_SECRET}" \
  --environment "CDEK_CLIENT_ID=${CDEK_CLIENT_ID}" \
  --environment "CDEK_CLIENT_SECRET=${CDEK_CLIENT_SECRET}" \
  --environment "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" \
  --environment "TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}" \
  --environment "TELEGRAM_WHOLESALE_CHAT_ID=${TELEGRAM_WHOLESALE_CHAT_ID}" \
  --environment "SMTP_HOST=${SMTP_HOST}" \
  --environment "SMTP_PORT=${SMTP_PORT}" \
  --environment "SMTP_USER=${SMTP_USER}" \
  --environment "SMTP_PASS=${SMTP_PASS}" \
  --environment "BITRIX24_WEBHOOK_URL=${BITRIX24_WEBHOOK_URL}" \
  --environment "DATABASE_URL=${DATABASE_URL}"

echo ""
echo "=== Готово! ==="
echo "Ревизия задеплоена: $FULL_IMAGE"
echo "Контейнер: $YC_CONTAINER_ID"
