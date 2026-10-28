# Chuẩn bị project tự động

Trong `retk gui`, chọn **Tạo project từ APK** và giữ tùy chọn chuẩn bị sau khi
nhập. Với project đã có, mở bảng **Chuẩn bị**, đặt chính sách rồi bấm **Chuẩn bị
project**. Worker Node chạy nền, không cần agent duy trì cuộc hội thoại. Đóng GUI
không dừng worker; mở lại để xem cùng lần chạy.

CLI tương đương, sau khi đã tạo workspace:

```cmd
retk prepare MyGame --symbols plan --address-mode rva --json
retk preparation MyGame --json
```

Mặc định `--analysis-mode full` giữ quy trình phân tích toàn bộ Ghidra và symbol
hiện có. Trong GUI, checkbox **Analysis theo yêu cầu** mặc định tắt. Bật checkbox
hoặc dùng CLI sau để hoãn công việc native toàn bộ:

```cmd
retk prepare MyGame --analysis-mode on-demand --json
```

Chế độ `on-demand` vẫn dump và import Ghidra. Chỉ sau khi bằng chứng import được
xác minh, pipeline ghi `analyze` và symbol hàng loạt là `deferred`; export asset,
index và mapping script tiếp tục theo profile. Không cần chọn RVA/VA cho bước
symbol đã hoãn. `nativeAnalysis` ghi `{state: "deferred", mode: "on-demand"}` và
symbol coverage vẫn `unverified`; hoàn tất setup không có nghĩa đã phân tích
native toàn bộ, có đầy đủ xref hay gameplay đã được xác minh. Agent phải yêu cầu
phân tích từng phạm vi khi cần. Chế độ không tự tạo trạng thái `analyzed` hay
receipt symbol toàn bộ trong project.

Chế độ được lưu trong `options.analysisMode` của preparation report, cùng chính
sách symbol/profile/device. Resume giữ chế độ đã lưu; đổi chế độ cần tạo run mới.
Report cũ không có trường này được hiểu là `full` và vẫn resume được. Không lưu
thêm một bản cấu hình chế độ riêng trong project settings; agent đọc report gần
nhất để chọn cách tiếp tục.

`rva` chỉ là ví dụ: chọn đúng `rva` hoặc `va` cho bằng chứng địa chỉ của build.
Mặc định là profile `reconstruction`, symbol `plan`, không chạy Unity baseline.
Không có address mode thì riêng bước symbol bị chặn; các bước độc lập vẫn chạy.
`--symbols apply` cho phép ghi symbol qua plan, transaction, backup và receipt
hiện có; `--symbols skip` bỏ qua. `--profile native` bỏ nhánh asset/Unity.

Các giai đoạn được lưu trước khi thực thi: prerequisite, Android, input IL2CPP,
dump, import Ghidra, analysis, symbol, export AssetRipper, SQLite index, trang
mapping script đầu tiên và Unity baseline tùy chọn. Bước hiện tại, thời gian,
heartbeat job và lỗi có trong GUI/MCP; không dựng phần trăm giả cho engine chưa
cung cấp tổng khối lượng. Mapping ban đầu chỉ lấy tối đa 100 script và báo
`hasMore`; agent tiếp tục truy vấn theo trang khi cần tái dựng.

Đây là pipeline chuẩn bị project với công cụ đã cài. Nó kiểm tra và chỉ ra
runtime/SDK còn thiếu, không tự tải hoặc cài runtime toàn máy. Cài prerequisite
qua luồng cài đặt hiện có rồi chạy lại phù hợp. Analysis chọn heap theo RAM trống
với phần dành cho hệ điều hành; cấu hình `GHIDRA_HEADLESS_MAXMEM` tường minh được
tôn trọng. Thiếu RAM báo blocker ngay, không lặp chờ vô hạn.

Prerequisite phân biệt điều kiện để chạy với bằng chứng kết quả đã có. Trên project
mới, doctor có thể báo `DUMP_EVIDENCE_STALE`/`IMPORT_EVIDENCE_STALE` vì chưa tạo
dump/import. Pipeline ghi đúng hai mục này vào `pendingOutputs` và thực hiện các
bước còn thiếu, thay vì coi chúng là thiếu engine. Doctor vẫn chỉ báo prepared
khi output đã được xác minh. Thiếu tool, input sai hash, ownership/khóa, report
không đủ phạm vi hoặc trạng thái chưa xác minh vẫn chặn. Kiểm tra RAM và policy
heap giữ nguyên; bước bị chặn vì RAM trả mã memory cụ thể, không hướng dẫn cài
lại SDK như thể runtime bị thiếu.

## Kiểm tra split và dữ liệu Android

Chọn rõ serial/package trong GUI hoặc truyền:

```cmd
retk prepare MyGame --serial emulator-5554 --package com.example.game --symbols plan --address-mode rva --json
```

Không chọn thiết bị đầu tiên. Package được đối chiếu với manifest APK gốc; chỉ
tái sử dụng serial người dùng từng chọn trong capture workspace. Có serial và
package tường minh thì mặc định bật phục hồi tự động khi xác lập được thiếu input.
`--no-auto-pull` chỉ kiểm tra/báo cần pull; `--no-include-data` bỏ dữ liệu ứng dụng.

Pipeline đọc manifest binary XML và quan hệ `uses-split`, split type bắt buộc,
`isSplitRequired`, package và version 64 bit. ZIP chứa nhiều APK được kiểm tra
từng APK bằng staging riêng; OBB không bị bung chỉ để đọc manifest. Một APK không
có `libil2cpp.so` chưa đủ kết luận thiếu split: có thể là Mono hoặc build khác.

Đọc entry bên trong APK phân biệt hoa/thường: `res/-N.png` và `res/-n.png` là
hai resource khác nhau. Đây là đọc ZIP tại chỗ, không thay quy tắc materialize
file trên Windows hay quy tắc của container XAPK. Entry trùng chính xác, biến thể
gây nhập nhằng của `AndroidManifest.xml`, path nguy hiểm, link, size/CRC sai vẫn
bị từ chối. APK-set không hợp lệ lưu thêm `inspectionIssues` có giới hạn và số
mục bị lược để xác định nguyên nhân trong receipt.

Worker đã kết thúc giữ nguyên báo cáo cũ. Sau cập nhật, kiểm tra ownership và
resume đúng run/policy nếu workspace còn tồn tại; chỉ bước chưa đạt được chạy
lại theo quy tắc resume. Nếu đã xóa project để tạo mới, tạo workspace mới rồi
chuẩn bị từ APK gốc. Việc sửa toolkit không tự khởi động lại pipeline hoặc tắt app
để giải phóng RAM.

Trước khi pull toàn bộ, pipeline đọc danh sách APK cài đặt và kéo riêng base để
so sánh **package, version, hash nguyên base APK và chứng thư đã xác minh** với
bản gốc. Có cùng tên/version chưa đủ. `apksigner` được tìm từ Android SDK Unity
đã cài và JDK quản lý; thiếu verifier hoặc chữ ký không xác minh được thì không
tự phục hồi. Không trộn các bản cập nhật, signer hoặc build khác nhau.

Khi thiếu split khai báo, thiếu input mà bản cài có thêm APK, hoặc có OBB trên
thiết bị nhưng archive gốc không có, pipeline dùng capture hiện có để lấy tất cả
APK cài đặt, OBB và dữ liệu ứng dụng được phép đọc. Nó không mở game, cài app hay
bật root. Dữ liệu private dùng quyền hiện có; bị từ chối quyền vẫn là thiếu phạm
vi kiểm tra. APK set sau pull phải vượt kiểm tra dependency/identity lần nữa,
danh sách APK trên thiết bị và archive gốc phải không đổi trước khi nhập.

Archive gốc và capture được giữ riêng. Khi đã có dump/import/analysis/symbol hoặc
export downstream, capture mới được giữ để xem xét đổi input; pipeline không tự
thay input của database/project đó. Receipt nằm dưới
`04_Notes/android-delivery/<UUID>/inspection.json`.

**Không có phép kiểm tra offline nào chứng minh mọi asset PAD/CDN đã tải.**
Chỉ quan sát được nội dung đang cài/đã tải và có quyền đọc. Asset fast-follow,
on-demand, hoặc dữ liệu server chưa tải vẫn là `downloadedData.coverage:
unverified`, kể cả capture thành công. Cần chạy/download game ở bước nghiệm thu
được người dùng chọn rồi đối chiếu lại nếu muốn kiểm tra thêm phạm vi này.

Mỗi lệnh metadata ADB trong pipeline có hạn chờ 30 giây, pull có hạn chờ 10 phút.
Hết hạn trả `cleanup_pending` và dừng các bước tiếp theo ở `unknown`; đây không
phải xác nhận child đã đóng. Giữ lease/staging của tiến trình đang chạy, không
xóa khóa, không tự retry. Supervision hiện có chỉ giải phóng lease khi thực sự
quan sát child đóng. Không tự kill engine ngoài quyền sở hữu của lần chạy.

## Resume và kết quả bàn giao cho agent

`04_Notes/preparation/<runId>/` chứa report, handoff và bằng chứng từng giai đoạn.
Report tách riêng native analysis, symbol coverage, assets/index, compile,
binding, dữ liệu tải thêm và gameplay. Hoàn thành setup không chứng minh game
đã tái dựng hoặc chơi được. Các nhánh độc lập có thể sẵn sàng dù nhánh khác bị chặn.

```cmd
retk prepare MyGame --resume-run <runId> --json
retk preparation MyGame --run <runId> --json
```

Resume giữ chính sách đã lưu và chỉ tái sử dụng bước có input/tool/config cùng
hash và receipt/output hợp lệ. Output của bước từng thành công bị mất/đổi cần
xem xét phục hồi, không tự chạy lại thao tác ghi. Thay chính sách, input hoặc
engine cần xem xét rồi tạo lần chạy mới. Trạng thái `unknown` hoặc owner mất
kết nối cần kiểm tra receipt và lease, không tự replay write.

CLI status và MCP `preparation_status {}` mặc định kiểm tra lại nội dung input
và bằng chứng. `freshness: current` xác nhận phạm vi report còn hiện hành;
`stale` hạ mức sẵn sàng của nhánh liên quan. Handoff trên đĩa là bản ghi lịch sử,
không phải kiểm chứng hiện tại. GUI poll nhẹ không hash lại game mỗi hai giây:
`verifyFreshness: false` trả `not-rechecked`, readiness chưa xác minh và riêng
`recordedReadiness`. Bấm **Làm mới** để xác minh; MCP cũng có tùy chọn boolean này.

Agent mở từ project sẽ đọc status gọn trước, dùng kết quả hiện hành và chỉ xử lý
blocker; không điều phối lại toàn bộ setup. Chưa có preparation và task đã cho
phép setup thì agent khởi tạo đúng một job:

```json
{"operation":"workspace.prepare","params":{"symbols":"plan","addressMode":"rva"}}
```

Đọc job qua `jobs_get {"jobId":"..."}` hoặc GUI; lưu ID để nối lại cùng job.
Job command có thể hoàn thành trong khi domain report là `partial`/`blocked`;
`unknown` giữ kết quả chưa xác định và không được coi là thao tác thành công.
Không cần một agent ngồi polling liên tục. `flow` cũ vẫn là luồng dump/import
ngắn hơn; nó không thay thế pipeline này.
