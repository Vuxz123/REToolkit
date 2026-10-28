# Tái dựng trên một project làm việc chung

`recovery` nối các khả năng hiện có trên **cùng một artifact có revision**.
Source apply, import thư viện và migration giữ được kết quả của nhau. Lệnh trực
tiếp `reconstruct`, `libraries`, `migration` vẫn giữ phạm vi cũ; không tự chuyển
chúng sang artifact và không đổi `project.re.json` sang đường dẫn staging.

## Bắt đầu và chẩn đoán

Chuẩn bị/export project Unity trước, rồi chạy:

```powershell
retk recovery create MyGame --json
retk recovery status MyGame --artifact <artifactId> --json
retk recovery diagnose MyGame --artifact <artifactId> --limit 20 --json
retk recovery diagnose MyGame --artifact <artifactId> --query DOTween --json
retk recovery history MyGame --artifact <artifactId> --limit 20 --json
```

`create` copy inventory `Assets`, `Packages`, `ProjectSettings` đã kiểm tra sang
`04_Notes/recovery/artifacts/<artifactId>/generations/<revision>/project`.
Không copy cache `Library`, `Temp`, logs hay project game bên ngoài workspace.
Không dùng hardlink. Copy và hash toàn bộ source vẫn tốn thời gian/dung lượng;
Unity có thể phải import lại ở generation mới. Đây chưa phải tối ưu tốc độ Editor.

`diagnose` lập SQLite graph nếu chưa có, sau đó dùng graph còn khớp inventory.
Báo cáo có phân trang/cursor theo snapshot, count và bước tiếp theo:

- Source: assembly/type, khả năng body/initialization/event-storage từ route
  hiện tại, số component/binding chưa resolve và traversal completeness.
- Runtime: DLL chưa được xác minh implementation và lệnh tìm ứng viên trong
  catalog. Không kết luận DLL là stub chỉ từ tên file hoặc body rỗng.
- Binding: count reference bị thiếu và coverage tĩnh chưa đầy đủ. Dùng
  `assets.refs` trên asset/object liên quan để truy nguyên lỗi.
- Validation: yêu cầu quan sát Unity mới. Constructor đầy đủ, dependency closure,
  API tương thích và gameplay vẫn chưa được tự chứng minh bởi báo cáo này.

`query` chỉ lọc những dòng chẩn đoán; không thiết lập dependency closure của một
tính năng. Thông tin khả năng sửa source vẫn cần plan/parser/native proof hiện có.
Thư viện ứng viên lấy qua `libraries.identify`, chưa phải thư viện tương thích.

## Chạy trên đúng artifact

Mọi bước dùng `artifactId` và **revision vừa nhận về**:

```powershell
retk recovery run MyGame --artifact <artifactId> --revision <revision> --operation assets.index --params '{"storage":"sqlite"}' --json
retk recovery run MyGame --artifact <artifactId> --revision <revision> --operation assets.scripts --params '{"query":"Player","limit":10}' --json
retk recovery run MyGame --artifact <artifactId> --revision <revision> --operation reconstruct.plan --params-file recovery-plan-params.json --json
retk recovery run MyGame --artifact <artifactId> --revision <revision> --operation reconstruct.apply --params '{"operationId":"<source-plan-id>"}' --json
```

Trong CMD/PowerShell, ưu tiên `--params-file` khi JSON có dấu nháy hoặc source dài.
File này là **params của operation**, ví dụ `{ "request": <reconstruction DTO>,
"evidence": [...] }`, không phải toàn bộ recovery envelope. DTO và graphRevision
bên trong vẫn do domain service kiểm tra. `revision` của artifact là UUID;
`graphRevision` là SHA256 riêng, không tráo hai giá trị này.

Source apply chạy trên một bản copy mới; revision cũ và export gốc giữ nguyên.
Kết quả domain nằm trong `result`, còn revision/project hiện tại nằm ở envelope.
Plan, graph, receipt và lịch sử của mỗi artifact ở thư mục riêng, không dùng
graph/plan của export gốc hoặc artifact khác làm shortcut.

## Thư viện và binding trên cùng kết quả

1. Đăng ký roots/quét ZIP qua các lệnh `libraries roots/scan` sẵn có.
2. Qua `recovery run`, gọi `libraries.identify`, `libraries.plan` với requirements
   chứa phiên bản catalog đã chọn; thử phiên bản có sẵn trước như workflow hiện tại.
3. Gọi `libraries.import` bằng plan UUID của artifact. Chỉ kết quả `imported`
   có canonical receipt và inventory stage còn khớp mới được copy sang revision
   mới. `blocked`, `satisfied`, `import_failed` không tự thay project hiện tại.
4. Gọi `reconstruct.validate` qua recovery để kiểm tra **artifact hiện tại**.
   `libraries.verify` của luồng cũ kiểm tra riêng stage của import; nó không có
   trong allowlist recovery để tránh nhận nhầm bằng chứng cho project đã kết hợp.
5. Migration dùng `migration.observe/plan/apply/verify` qua recovery. Sau apply,
   stage được kiểm tra receipt/inventory rồi copy sang revision mới và index lại.
   Source plan kế tiếp đọc đúng bindings đã migrate.

Các bước chạy Editor được fork để giữ revision trước. Source integrity, Unity
compilation, binding coverage và gameplay là kết quả độc lập. Status artifact
không tổng hợp thành chứng nhận compile/binding: đọc kết quả validation và report
đúng operation/snapshot. Thư viện bị type/assembly collision, DLL removal, complex
field migration và runtime stub replacement vẫn tuân theo giới hạn hiện có.
Mốc này chưa thêm tự thay DOTween, ZeroX, DLL → C# hay khôi phục native tự động.

## Job, GUI và thao tác bị ngắt

Các MCP tool `recovery_create/status/history/diagnose/run/abandon` dùng cùng
schema CLI. Với thao tác dài, gọi `jobs_start` operation `recovery.create` hoặc
`recovery.run`, giữ jobId rồi `jobs_get/jobs_wait`. `recoveryProgress` trả phase,
artifact/revision và số file đã copy/tổng file; không tạo ETA hay phần trăm giả.
GUI có typed operations trong nhóm tái dựng và hiển thị tiến trình trong job;
chưa có màn hình quản lý artifact riêng. Khởi động lại GUI/MCP để nạp schema mới.

Trước mutation, toolkit lưu intent. Nếu không có publication hoàn chỉnh,
`status` trả `needs-inspection` và pending invocationId; lệnh tiếp theo bị chặn.
Không replay một job chưa biết kết quả. Sau khi kiểm tra job, child ownership,
intent và receipts, có thể chủ động bỏ nhánh chưa publish:

```powershell
retk recovery abandon MyGame --artifact <artifactId> --revision <revision> --intent <invocationId> --json
```

Lệnh yêu cầu đúng revision/intent và inventory revision đã publish không đổi.
Nó không đóng process, xóa lock, replay source hoặc xóa candidate; vẫn giữ toàn
bộ bằng chứng. Graph/state candidate được bỏ khỏi lựa chọn hiện tại để index
lại. Nếu ownership chưa rõ, lease cũ hoặc input đã thay đổi thì vẫn bị chặn.

## Kiểm thử

`node --test test/recovery-*.test.js` dùng project Unity và ZIP source-owned trong
thư mục tạm. Ca import dùng runner fixture ghi observation, không chạy DLL/vendor
Editor. Những test này xác minh pipeline/inventory/isolation, không chứng minh
runtime, biên dịch Unity thật hoặc game người dùng đã chạy được.
