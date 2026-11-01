# Kedi SEO: Cloudflare + Dokploy

Kedi Admin đang ở `https://ladipage.gofiber-phuongnguyen.workers.dev`.
Frontend SEO dùng `https://kedi-seo.gofiber-phuongnguyen.workers.dev`.
Backend Rybbit xử lý analytics; OpenSEO xử lý audit. Cần cả hai backend.

## 1. Chuẩn bị source

Nhánh triển khai Rybbit: `codex/cloudflare-dokploy`; OpenSEO:
`codex/dokploy-kedi`. Hai nhánh chứa cả phần tích hợp Kedi trước đó.
Các nhánh đã được đẩy lên GitHub:

- Rybbit: [phuongnguyen240805/rybbit](https://github.com/phuongnguyen240805/rybbit),
  nhánh `codex/cloudflare-dokploy`.
- OpenSEO: [phuongnguyen240805/open-seo](https://github.com/phuongnguyen240805/open-seo),
  nhánh `codex/dokploy-kedi`.

Trong Dokploy chọn đúng nhánh nêu trên. Remote `origin` của Rybbit trỏ vào
fork riêng; `upstream` giữ liên kết với `rybbit-io/rybbit` để cập nhật sau này.
Không deploy nguyên image upstream vì thiếu SSO.
Không commit `.env`, khóa, cookie hoặc file credential.

Hai ứng dụng Dokploy dùng Docker Compose, không phải Docker Stack/Swarm.
Chọn build context theo vị trí compose, không chép riêng file compose vào thư
mục khác: `../..` phải trỏ đến root repository. Có thể dùng registry image tự
build từ chính commit nếu VPS không đủ RAM build; không thay bằng image upstream.

## 2. Rybbit backend + database

Trong Dokploy tạo Project `kedi-seo`, rồi tạo Docker Compose service `analytics`:

1. Source: fork Rybbit của bạn, chọn nhánh có tích hợp Kedi.
2. Compose path: `deploy/dokploy/compose.yaml`.
3. Tab Environment: chép nội dung `.env.example` cùng thư mục, điền các giá trị.
4. Tạo mật khẩu khác nhau cho PostgreSQL, ClickHouse, Redis và Better Auth.
   `KEDI_SEO_SSO_SECRET` dùng chung ở bốn thành phần; xem bảng bên dưới.
5. `BASE_URL` là URL frontend Kedi SEO, **không phải URL backend**.
6. Trong Domains thêm domain HTTPS của API analytics, service `backend`, port
   **3001**, path `/`, không strip `/api`.
7. Bật Isolated Deployments nếu Dokploy cung cấp, dùng Preview Compose kiểm tra
   backend vẫn chung network với postgres/clickhouse/redis. Không mở domain/cổng
   public cho database.
8. Deploy. Entrypoint chuẩn tự khởi tạo/migrate database PostgreSQL khi khởi động,
   và server khởi tạo schema ClickHouse. Lần đầu dùng volume mới riêng cho Kedi;
   không trỏ tới database hiện hữu chưa sao lưu. Đây là hành vi của image, không
   cần tự chạy thêm migration để thử.

Kiểm tra `https://<analytics-api>/api/health` trả 200. Kiểm tra log backend,
PostgreSQL, ClickHouse và Redis đều sẵn sàng. Nếu init lỗi, sửa lỗi đó trước,
không xóa volume để thử lại. Lite Dashboard tắt theo cấu hình hiện tại.

## 3. OpenSEO

Tạo Docker Compose service thứ hai `openseo` trong cùng Project:

1. Source: fork OpenSEO có phần tích hợp Kedi.
2. Compose path: `deploy/dokploy/compose.yaml` trong repository OpenSEO.
3. Chép `deploy/dokploy/.env.example` của OpenSEO vào Environment.
4. Đặt `AUTH_MODE=password`, `BETTER_AUTH_URL=https://<openseo-api>`.
   Đây là origin của chính OpenSEO; `KEDI_SEO_FRONTEND_ORIGIN` mới là frontend.
5. Điền storage access/secret key ngẫu nhiên. Các API key nhà cung cấp chỉ điền
   khi sử dụng chức năng tương ứng; kiểm tra quota/billing của nhà cung cấp.
6. Domains: HTTPS của OpenSEO, service **web**, port **80**, path `/`.
7. Tắt **Isolated Deployments** cho OpenSEO vì `init` dùng
   `network_mode: service:runtime`. Compose đã nối `web` vào cả network private
   `default` và network ngoài `dokploy-network` để Traefik truy cập được.
   Trong Preview Compose, `web` phải giữ cả hai network; `init` không được có
   thêm trường `networks` bên cạnh `network_mode`.
8. Deploy. `init` chạy một lần và exit 0 là bình thường; runtime cần healthy,
   web và crawl-gateway cần running. Init tự cấu hình và áp dụng migration cho
   database mới. Chờ init xong trước khi kiểm tra API.

Kiểm tra `https://<openseo-api>/api/health` trả 200. OpenSEO standalone dùng
celld + RustFS với volumes `storage`, `runtime`, `config`, `web-config`,
không dùng database analytics của Rybbit. Giữ volume qua mỗi redeploy.
Nếu thay origin/SSO key mà init không chạy lại, chọn recreate/redeploy init
rồi restart runtime và web; kiểm tra cấu hình mới có hiệu lực, không xóa dữ liệu.

## 4. Nối frontend Worker với hai API

Trong Cloudflare Worker `kedi-seo`, Settings → Variables and Secrets:

| Biến | Giá trị |
| --- | --- |
| `KEDI_SEO_ADMIN_ORIGIN` | `https://ladipage.gofiber-phuongnguyen.workers.dev` |
| `OPENSEO_FRONTEND_ORIGIN` | `https://kedi-seo.gofiber-phuongnguyen.workers.dev` |
| `RYBBIT_INTERNAL_URL` | HTTPS origin của backend analytics |
| `OPENSEO_BASE_URL` | HTTPS origin của OpenSEO |
| `OPENSEO_INTERNAL_URL` | Cùng origin OpenSEO khi gọi từ Workers |
| `KEDI_SEO_SSO_SECRET` | Secret dùng chung cho SSO |
| `OPENSEO_SESSION_SECRET` | Secret riêng để mã hóa cookie frontend |

Hai secret được lưu dưới kiểu Secret, không phải `NEXT_PUBLIC_*`.
Cloudflare không truy cập được hostname Docker `backend`, `web` hay localhost.

Trong source Rybbit, copy `client/.env.cloudflare.example` thành
`client/.env.cloudflare.local`, điền đúng hai API origin. Chạy từ `client`:

```powershell
pnpm install --frozen-lockfile
pnpm run deploy:cloudflare
```

Lần cài đầu nên chạy `pnpm install --frozen-lockfile` từ root workspace.
Script build đặt public API về cùng origin frontend; native API rewrite được
build từ `RYBBIT_INTERNAL_URL`, nên phải build/deploy lại sau khi điền URL này.
Không đưa secret vào `next.config.ts`, `vite.config.ts` hoặc `wrangler.jsonc`.
Có thể dùng `pnpm exec wrangler secret bulk <file-json-private>` để nạp secrets.

Đối với tracker trên website khách, dùng HTTPS production, rồi kiểm tra
`/api/script.js` và request `/api/track` thành công từ origin website khách.
Không dùng snippet localhost đã tạo trong môi trường local.

## 5. Kedi Admin: bật iframe và SSO

Các thay đổi iframe/issuer và endpoint Nest `/api/account/seo-context` đã có
trong source local. Bản production cũng phải chứa những thay đổi đó; đặt biến
môi trường đơn thuần không bổ sung endpoint vào bản build cũ.

Trên Kedi Admin đặt:

```dotenv
KEDI_SEO_ADMIN_ORIGIN=https://ladipage.gofiber-phuongnguyen.workers.dev
KEDI_SEO_EMBED_ORIGIN=https://kedi-seo.gofiber-phuongnguyen.workers.dev
KEDI_SEO_SSO_SECRET=<cùng secret với Worker và hai backend>
```

Kedi Admin đang tách nhiều Workers. `/ai-seo` nằm ở `ladipage-ai`, còn route
`/api/kedi-seo/session` đi qua router mặc định `ladipage-core`. Đặt các biến trên
đúng Worker thực thi (không chỉ public router `ladipage`). Khi đổi cách tách
bundle, kiểm tra lại build manifest/router trước khi triển khai.
Triển khai qua script multi-worker hiện có; không deploy monolith đè lên router.
Backend Nest cần endpoint context, và production Kedi phải gọi đúng backend đó.

| Giá trị | Kedi Admin | SEO Worker | Rybbit backend | OpenSEO init |
| --- | --- | --- | --- | --- |
| Issuer admin origin | `KEDI_SEO_ADMIN_ORIGIN` | Cùng tên | Cùng tên | Cùng tên |
| SEO frontend origin | `KEDI_SEO_EMBED_ORIGIN` | `OPENSEO_FRONTEND_ORIGIN` | `BASE_URL` | `KEDI_SEO_FRONTEND_ORIGIN` |
| SSO secret | `KEDI_SEO_SSO_SECRET` | Cùng tên | Cùng tên | Cùng tên |

Không dùng lại khóa test local. Nếu đã tạo file secrets production ngoài Git
trong lần triển khai frontend, dùng đúng khóa đó cho ba thành phần còn lại.
Không gửi khóa trong chat.

File production secrets đã chuẩn bị trên máy này:
`C:\Users\ADMIN\kedi-seo-integration\.local\cloudflare-production-secrets.json`.
Chỉ lấy giá trị `KEDI_SEO_SSO_SECRET` để điền cho Kedi Admin và hai backend;
`OPENSEO_SESSION_SECRET` là khóa riêng của frontend, không cần điền vào backend.

## 6. Nghiệm thu

- Đăng nhập Kedi Admin, mở `/ai-seo`: iframe không hiện form đăng nhập phụ.
- POST `/api/kedi-seo/session` của parent và child thành công; refresh sau hơn
  60 giây vẫn giữ đúng workspace. Staff không có quyền ghi, tenant khác không
  đọc được site/project của nhau.
- Danh sách website tải thành công. Cài snippet production lên website test,
  mở một lượt truy cập và kiểm tra traffic.
- Chạy audit một URL được phép; kiểm tra trạng thái completed và kết quả.
- Ngôn ngữ/theme theo Kedi Admin; CSP frame-ancestors chỉ cho origin parent.
- Backup PostgreSQL, ClickHouse và các volume OpenSEO trước nâng cấp. Không dùng
  `down -v`, volume prune hoặc reset database khi cập nhật.

Frontend public có thể deploy trước; khi chưa có hai backend, chưa nghiệm thu
được traffic, audit và đăng nhập xuyên suốt. Dữ liệu local không tự chuyển lên VPS.

## Bản frontend đã triển khai

Ngày 2026-11-01, Worker `kedi-seo`, version
`4b007a94-c44f-4034-9bbd-881e59c22cfa` đã được triển khai. `/kedi` và JavaScript
trả 200, CSP chỉ cho iframe từ Kedi Admin, JWT sai trả 401. JWT ký bằng secret
production được xác thực, sau đó trả 503 vì chưa có backend. Hai khóa production
đã được kiểm tra là binding `secret_text` trên Cloudflare.

Build Workers, kiểm tra đóng gói, 36 test SSO/proxy/appearance và 7 kiểm tra
runtime Workers đã qua. Trình duyệt headless tải bản public không có page error.
Runtime local dùng compatibility date 2026-10-30 do giới hạn binary; bản cloud
dùng 2026-11-01 và đã được kiểm tra trực tiếp. Cả hai Compose đã qua `config`;
chưa triển khai backend hoặc chạy migration trên VPS trong công việc này.

Typecheck toàn client còn gặp lỗi resolver/Zod đã có ở SegmentDialog, GoalEditor
và AnnotationFormDialog trên cây dependencies local; không coi đây là một lần
typecheck toàn dự án thành công. ESLint hiện chưa có cấu hình hoạt động.

Tài liệu: [Dokploy Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains),
[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
