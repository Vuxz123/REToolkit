# Cài nhanh REToolkit trên máy mới

Trên Windows x64, giải nén hoặc clone REToolkit vào một thư mục cố định, ví dụ
`C:\REToolkit`. Mở CMD tại đó và chạy:

```cmd
install.cmd
```

Không cần cài sẵn Node, Git hay winget. Nếu có Node >=24 kèm npm, bộ cài dùng nó;
nếu chưa có, bộ cài tải Node 24.15.0 portable từ nodejs.org, kiểm tra kích thước và
SHA256 theo [lock](../config/node-windows-x64.lock.json), rồi giải nén trong
`.cache/bootstrap`. Bản portable không thay Node của hệ thống. Checksum được lấy
từ [SHASUMS256 chính thức](https://nodejs.org/dist/v24.15.0/SHASUMS256.txt).

Profile mặc định `full` chạy lần lượt:

1. Cài dependency theo `package-lock.json`, không chạy lifecycle script tùy ý.
2. Cài Electron đã khóa phiên bản và quyền đọc cần cho renderer sandbox.
3. Cài JDK, Ghidra, Il2CppDumper và AssetRipper theo native lock.
4. Cài Python/GhidraMCP CLI riêng cho `retk mcp`.
5. Cài GUI Python, GhidraMCP extension và .NET cục bộ theo desktop lock.
6. Tạo lệnh `retk`, thêm thư mục lệnh vào **PATH của tài khoản hiện tại**.
7. Chạy diagnostics và lưu báo cáo từng bước.

Mở CMD mới sau khi cài xong:

```cmd
retk --version
retk gui
```

Bộ cài không tự mở GUI. Giữ nguyên vị trí thư mục REToolkit vì lệnh trỏ đến đúng
Node và checkout này. Không cần đăng ký npm global hay quyền sửa Machine PATH.
Chọn thư mục ngắn để tránh giới hạn đường dẫn thư viện native Python trên Windows.
Nếu chính sách máy chặn thực thi/download/ACL, bước tương ứng báo lỗi để xử lý;
bộ cài không tự nâng quyền.

## Chọn bản nhẹ hoặc xem trước

```cmd
install.cmd --profile desktop
install.cmd --profile cli
install.cmd --plan --json
install.cmd --no-path
install.cmd --cache D:\RETK-packages
```

| Profile | Thành phần |
|---|---|
| `full` | CLI, GUI và các engine/runtime ở trên |
| `desktop` | CLI + GUI; chưa cài bộ engine |
| `cli` | Dependency và lệnh CLI; chưa cài GUI hoặc engine |

`--plan`/`--help` không tải mạng hay ghi file, kể cả khi máy chưa có Node.
`--cache` chọn cache archive cho các bộ cài runtime; cache Node portable vẫn nằm
trong `.cache/bootstrap`. Cài dependency npm và Electron lần đầu vẫn cần mạng.
`--no-path` chỉ tạo shim: dùng đường dẫn tuyệt đối đến
`.cache\quickstart\bin\retk.cmd` hoặc tự thêm thư mục đó vào User PATH.

Nếu Node đã có, có thể dùng cùng bộ điều phối:

```cmd
npm run setup:quick
node scripts/quickstart.mjs --plan --json
retk quickstart --profile full
```

Biến thể `retk quickstart` hỗ trợ `--root <checkout>` giống các lệnh CLI khác;
đích phải là một checkout có `package.json` và các lock tương ứng. `install.cmd`
luôn cài checkout chứa chính nó.

GUI có **Cài đặt → Công cụ → Xem kế hoạch cài nhanh**. Đóng GUI và các tác vụ
REToolkit trước khi thực sự cài để npm không thay file đang được sử dụng.

## Kết quả, lỗi và chạy lại

Báo cáo gần nhất nằm tại `.cache/quickstart/latest.json`; mỗi lần chạy có thư mục
UUID chứa `report.json` và log từng bước. Báo cáo ghi bước bắt đầu/kết thúc, thời
gian thực tế, kết quả và lỗi. Bước lỗi trả exit code khác 0, các bước phụ thuộc
không chạy tiếp. Không có phần trăm hoặc ETA ước đoán cho cả bộ cài.

Chạy lại cùng lệnh để kiểm tra trạng thái hiện tại. Runtime đúng lock và qua kiểm
tra file được dùng lại. Runtime bị đổi, receipt không rõ, lock bộ cài còn giữ hoặc
transaction chưa hoàn tất cần kiểm tra; bộ cài không tự xóa khóa hay chạy lại
thao tác chưa rõ kết quả. Dependency npm được kiểm tra lock và phiên bản package
cấp đầu; kiểm tra này không phải chứng thực toàn bộ byte trong `node_modules`.
Bộ cài còn kiểm tra CLI nạp được các module; thiếu entry point/dependency thì
cài lại theo lock.

Nếu `where retk` chỉ đến một lệnh cũ trên PATH, bộ cài giữ nguyên lệnh đó và báo
xung đột. Dùng shim tuyệt đối trong báo cáo hoặc xem lại thứ tự PATH. Với bản cũ
đăng ký bằng npm link, chỉ gỡ sau khi xác nhận đúng bản:

```cmd
where retk
npm unlink --global retoolkit --ignore-scripts
```

Không dùng lệnh unlink để gỡ shim quickstart: shim nằm trong checkout, còn mục
PATH của nó được quản lý qua Windows User Environment Variables. Việc gỡ lệnh
không đòi hỏi xóa workspace.

## Những phần vẫn cần cấu hình riêng

Unity Editor/module/license đúng game, LDPlayer, CLI của Agent và đăng nhập,
Jev API key, folder thư viện ZIP và ảnh/video game gốc không được cài tự động.
Unity cần Editor phù hợp dự án. Xem [GUI](desktop.md),
[Agent/MCP](project-agent.md) và [Jev](jev-settings.md).

Kết quả cài đặt không xác minh Ghidra đã mở đúng Program, MCP đã kết nối, gameplay
hoặc hình ảnh đã khớp game gốc. Các bộ cài runtime giữ nguyên receipt/transaction
và kiểm tra riêng. Nghiệm thu bootstrap dùng fixture tách biệt, bao gồm archive
Node thật; chưa thay thế nghiệm thu trên một máy Windows vừa cài trắng.
