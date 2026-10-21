FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 TZ=Asia/Ho_Chi_Minh
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Thư mục lưu file (tài liệu, ghi âm, giọng đọc, Excel) — gắn volume khi chạy
RUN mkdir -p /data && useradd -m -u 10001 hub && chown -R hub /data /app
USER hub

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
