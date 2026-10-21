# Hướng dẫn cài Thi Lốp AI Hub lên server FPT

Làm lần lượt từ trên xuống. Mỗi khung xám là lệnh anh dán vào cửa sổ dòng lệnh của server (SSH) rồi bấm Enter.

## 0. Cần chuẩn bị

- Server Ubuntu 22.04 hoặc 24.04, tối thiểu **2 vCPU, 4 GB RAM, 30 GB ổ đĩa**.
- Mở cổng **80** và **443** trên tường lửa của FPT Cloud (Security Group).
- Key API của Anthropic, OpenAI, Google Gemini (anh đã có).
- Một tên miền phụ, ví dụ `ai.thilop.vn` (không bắt buộc lúc đầu, chạy bằng IP trước cũng được).

## 1. Đăng nhập server và cài Docker

```bash
ssh root@IP-SERVER-CUA-ANH
curl -fsSL https://get.docker.com | sh
docker --version
```

## 2. Lấy code từ GitHub

Repo là riêng tư nên GitHub sẽ hỏi tên đăng nhập và mật khẩu. Ở ô mật khẩu, dán một **Personal access token** (tạo ở GitHub › Settings › Developer settings › Personal access tokens, quyền `repo`, chỉ đọc là đủ).

```bash
cd /opt
git clone https://github.com/TEN-GITHUB-CUA-ANH/thilop-ai-hub.git
cd thilop-ai-hub
```

## 3. Tạo file cấu hình `.env`

```bash
./deploy/gen-secrets.sh
```

Lệnh này tạo file `.env`, tự sinh mật khẩu CSDL, khoá bảo mật và **in ra mật khẩu admin lần đầu** — anh chép lại. Sau đó mở file để điền:

```bash
nano .env
```

Điền tối thiểu:

| Dòng | Điền gì |
| --- | --- |
| `DOMAIN` | Chưa có tên miền: để `:80`. Có rồi: `ai.thilop.vn` |
| `PUBLIC_BASE_URL` | `http://IP-server` hoặc `https://ai.thilop.vn` |
| `ADMIN_EMAIL` | Email anh dùng để đăng nhập |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Key các hãng |

Lưu: bấm `Ctrl+O`, `Enter`, rồi `Ctrl+X`.

## 4. Chạy hệ thống

```bash
docker compose up -d --build
docker compose ps
```

Lần đầu mất khoảng 5–10 phút để tải và đóng gói. Năm dịch vụ `db`, `redis`, `api`, `worker`, `web` đều phải ở trạng thái **running**. Có lỗi thì xem:

```bash
docker compose logs -f api
```

## 5. Đăng nhập và kiểm tra

1. Mở trình duyệt: `http://IP-SERVER-CUA-ANH` (hoặc `https://ai.thilop.vn`).
2. Đăng nhập bằng `ADMIN_EMAIL` và mật khẩu lần đầu. Bấm **Đổi mật khẩu** ở góc dưới bên trái.
3. Vào **Quản trị › Model**, bấm **Kiểm tra** ở từng model đang bật. Model nào báo lỗi thì xem tên model còn đúng không (hãng có thể đổi tên) hoặc tắt nó đi.
4. Vào **Quản trị › Cơ sở & hạn mức**: thêm đủ 6 cơ sở, địa chỉ, số điện thoại, giờ mở cửa, từ khoá nhận diện (ví dụ `lê văn lương, lvl`), hạn mức tháng.
5. Vào **Quản trị › Cài đặt**: hạn mức tháng của cả công ty, tỷ giá USD.
6. Vào **Quản trị › Người dùng**: tạo tài khoản cho quản lý và nhân viên, gán cơ sở.
7. Vào **Ứng dụng AI › Hỏi tài liệu**: tải bảng giá, chính sách bảo hành, quy trình. Tích "Bot trả lời khách được dùng tài liệu này" cho tài liệu được phép dùng để trả lời khách.

## 6. Gắn tên miền (khi có)

1. Ở nơi quản lý tên miền thilop.vn, tạo bản ghi **A**: `ai` → IP server.
2. Sửa `.env`: `DOMAIN=ai.thilop.vn` và `PUBLIC_BASE_URL=https://ai.thilop.vn`.
3. Chạy lại: `docker compose up -d`. HTTPS tự có sau khoảng 1 phút.

Messenger và Zalo **bắt buộc HTTPS**, nên làm bước này trước khi nối kênh chat.

## 7. Nối Messenger (fanpage)

1. Vào developers.facebook.com › tạo App loại **Business** › thêm sản phẩm **Messenger**.
2. Ở Messenger › Settings: chọn fanpage Thi Lốp, bấm **Generate token** → dán vào `MESSENGER_PAGE_TOKEN`. Ghi ID trang vào `MESSENGER_PAGE_ID`.
3. Ở App settings › Basic: chép **App Secret** → `MESSENGER_APP_SECRET`.
4. Chạy `docker compose up -d` để nạp key mới.
5. Ở Messenger › Webhooks: Callback URL = `https://ai.thilop.vn/webhooks/messenger`, Verify token = giá trị `MESSENGER_VERIFY_TOKEN` trong `.env`. Đăng ký sự kiện `messages`.
6. Để bot trả lời được **mọi khách** (không chỉ người quản trị trang), app cần qua **App Review** của Meta cho quyền `pages_messaging`. Trong lúc chờ duyệt, anh thử bằng tài khoản quản trị fanpage.

Quy tắc của Meta (kiểm tra ngày 22/10/2026): bot chỉ trả lời trong 24 giờ kể từ tin cuối của khách; sau đó nhân viên trả lời tay trong 7 ngày. Hub đã làm theo quy tắc này.

## 8. Nối Zalo OA

> Tom chưa kiểm tra được tài liệu chính thức của Zalo về chữ ký webhook, khung giờ trả lời và cách lấy token. Phần này cần kiểm tra lại trên developers.zalo.me trước khi chạy thật.

1. Vào developers.zalo.me › tạo ứng dụng › liên kết với Zalo OA của Thi Lốp.
2. Chép **App ID** → `ZALO_APP_ID`, **Khoá bí mật** → `ZALO_APP_SECRET`.
3. Ở mục Webhook: URL = `https://ai.thilop.vn/webhooks/zalo`, bật sự kiện "Người dùng gửi tin nhắn văn bản". Chép **OA Secret Key** → `ZALO_OA_SECRET_KEY`.
4. Cấp quyền cho ứng dụng truy cập OA (OAuth v4) để lấy **Refresh token** → `ZALO_REFRESH_TOKEN`. Hub tự làm mới token sau đó.
5. `docker compose up -d`.

## 9. Telegram (cảnh báo hạn mức, ca chuyển người)

1. Mở Telegram, nhắn @BotFather › `/newbot` › lấy token → `TELEGRAM_BOT_TOKEN` trong `.env`, rồi `docker compose up -d`.
2. Thêm bot vào nhóm CSKH của từng cơ sở. Lấy chat ID của nhóm (ví dụ nhắn vào nhóm rồi mở `https://api.telegram.org/bot<TOKEN>/getUpdates`).
3. Dán chat ID vào **Quản trị › Cơ sở** (từng cơ sở) và **Quản trị › Cài đặt** (nhóm admin).

## 10. Thử bot trước khi bật thật

Vào **Hộp thư khách hàng**, khung **Thử bot**: gõ câu khách hay hỏi (giá lốp, giờ mở cửa, khiếu nại) xem bot trả lời và chuyển người có đúng không. Tin thử không gửi ra fanpage hay Zalo.

## 11. Nối n8n, Claude Code

Vào **Cổng API** › tạo key. Trang này có sẵn ví dụ cho curl, n8n, Claude Code và Python.

- n8n (OpenAI credentials): Base URL `https://ai.thilop.vn/v1`, API key = key `tl-...`.
- Claude Code: `ANTHROPIC_BASE_URL=https://ai.thilop.vn` và `ANTHROPIC_AUTH_TOKEN=tl-...`.

## 12. Cập nhật phiên bản mới

```bash
cd /opt/thilop-ai-hub
git pull
docker compose up -d --build
```

## 13. Sao lưu mỗi đêm

```bash
crontab -e
```

Thêm dòng:

```
0 2 * * * /opt/thilop-ai-hub/deploy/backup.sh >> /var/log/hub-backup.log 2>&1
```

Bản sao lưu nằm trong `/opt/thilop-ai-hub/backups`. Nên chép thư mục này sang máy khác định kỳ.

Khôi phục CSDL từ một bản sao lưu:

```bash
docker compose exec -T db pg_restore -U hub -d hub --clean < backups/db-NGAY.dump
```

## Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Mở trang không được | `docker compose ps` xem `web` có chạy không; kiểm tra cổng 80/443 đã mở trên FPT Cloud |
| Chat báo "Hãng AI đang lỗi" | Quản trị › Model › Kiểm tra; xem key trong `.env` còn đúng, tài khoản hãng còn tiền |
| Báo "Đã chạm hạn mức" | Nâng hạn mức ở Quản trị (người dùng, cơ sở, công ty) hoặc chờ sang ngày/tháng mới |
| Tài liệu đứng ở "Đang chờ" | `docker compose logs -f worker` |
| HTTPS không lên | Bản ghi A của tên miền đã trỏ đúng IP chưa; cổng 80 phải mở để xin chứng chỉ |
| Quên mật khẩu admin | `docker compose exec api python -c "from app.db import session_factory; from app.models import User; from app.security import hash_password; db=session_factory()(); u=db.query(User).filter_by(role='admin').first(); u.password_hash=hash_password('MatKhauMoi123'); db.commit()"` |
