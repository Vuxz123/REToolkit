# Mốc 3–4: diagnostics, evidence và TypeSafe Jev

2026-10-19. Người dùng yêu cầu tiếp tục roadmap sau mốc 0–2. Nền hiện tại
là CLI JavaScript và persistent Java Ghidra bridge; GUI tiếp tục làm sau.

## Quyết định

Thực hiện diagnostics và portable handoff như roadmap, thêm adapter HTTP Jev
theo docs người dùng cung cấp. Chẩn đoán filesystem/readiness mặc định đọc cục bộ;
`--probe` mới khởi động MCP bridge để quan sát handshake/discovery. Native session
có thể ping chỉ đọc. Không tự mở GUI, chạy analysis, đổi kết nối đang dùng hay sửa
project để làm diagnostics. Readiness không được suy ra từ sự có mặt của file.

Các lựa chọn đã cân nhắc: chỉ báo tool tồn tại (không đủ bằng chứng), probe mọi thứ
mặc định (chậm và có tác dụng phụ), hoặc kiểm tra tầng local + probe chủ động.
Chọn phương án thứ ba. Gói generic hỗ trợ lưu trữ/chia sẻ; adapter Jev dựng request
JSON đúng API thay vì giả định Jev nhập nguyên ZIP.

## Mốc 3

`doctor [Game] --task prepare|headless|mcp|assetripper [--probe] [--json]`.
Giữ trường `checks` tương thích doctor cũ, thêm `schemaVersion`, `tasks`,
`diagnostics:[{id,code,status,message,action,evidence}]`, readiness và limitations.
Mã lỗi ổn định, phân biệt thiếu runtime, bridge, extension, version mismatch,
GUI instance chưa mở, sai program, project lock, stale native/metadata,
analysis/symbols chưa xác minh. Công cụ tùy chọn thiếu không chặn tác vụ khác.

`status Game` bổ sung cùng model diagnostics/readiness, giữ các field project cũ.
Model dùng được cho GUI tương lai; không tuyên bố GUI hiện tại đã chuyển sang JS.
Prepare ready chỉ khi input/output evidence hợp lệ; headless queried ready phải
đúng binding Program/native hash và session khỏe. Analysis/symbol readiness tách riêng.

MCP probe khởi động child bridge riêng bằng executable đã cấu hình, trao đổi JSON-RPC
initialize/tools-list và tool discovery thực sự được advertise. Kiểm tra project
exact name, không dựa vào substring hay PID. Capability/identity không đủ thì unknown;
không mark đúng program từ một endpoint trả 200. Raw stderr/token/env không được
đưa vào output. Deadlines và cleanup có giới hạn; không kill GUI hay JVM ngoài scope.

## Mốc 4

`handoff create Game [--out <folder|zip>] [--include-dummy-dll]
[--include-assets] [--include-binaries] [--evidence <folder>]`.
Mặc định tạo gói nhẹ, không APK/native/metadata binary, runtime, cache, backup,
logs, token hoặc file project JSON nguyên bản. Copy dump.cs/script.json, notes
text phù hợp đã có. DummyDll/assets/binary là opt-in rõ ràng. Giữ classification
metadata/pseudocode/references/notes/reconstructed/assets/binary; không gọi chúng
là source gốc. Không tự chạy decompile để export.

Manifest v1 có `kind:retoolkit-handoff`, `schemaVersion:1`, build native/metadata
SHA256/size/ABI, steps, tool facts, file inventory, classifications và limitations.
Mọi inventory path là relative POSIX; hash kiểm tra bytes. Missing/stale artifacts
hiển thị rõ. `handoff verify <folder|zip>` kiểm tra schema, safe paths, duplicate
case-folded entries, symlink/junction, exact inventory và SHA256/size. Không extract
ZIP vào workspace, không cho ZIP bomb vượt declared sizes/bounded manifest.
Staging + rename atomic; không ghi đè output hiện có. Giữ workspace lease khi
snapshot/copy và revalidate inputs/output manifests. Session đang sống cần stop
trước export. Verify được sau khi di chuyển sang thư mục khác.

`evidence capture Game --kind decompile|xrefs|functions [--selector <name/address>]
[--direction to|from] [--limit <n>] [--out <external-folder>]` chỉ query session
đang có, không tự start. Ghi artifact ngoài workspace (mặc định exports/evidence),
vì supervisor đang giữ workspace lease. Evidence v1 gồm kind, request method/params,
build hashes, programIdentity, run/revision, collectedAt, result, coverage,
limitations, dataTrust. Không chứa token/config; addresses là strings. Paged/truncated
results ghi rõ coverage, không giả complete. Export chỉ nhận evidence đúng schema
và native/metadata binding; evidence revision giữ nguyên để người đọc nhận biết lịch sử.

## Adapter Jev

Docs đã xác minh: https://docs.typesafe.ai/api, /concepts/state, /models,
/introduction/quickstart. HTTP endpoint cố định https://api.typesafe.ai/v1/systemone.
Auth bằng TYPESAFE_API_KEY. JSON `{state,model,questions}`; supported question types
trong adapter này: choice, score, noul. Typed answers được giữ nguyên cùng model/usage.

`jev request <bundle> --questions <json> --out <request.json>
[--against <bundle>] [--file <relative-inventory-path>] [--model <id>]` chạy offline.
Verify bundle trước; chọn text evidence/notes đã khai báo, không nhúng binary.
Mặc định chọn notes/evidence nhỏ, không nhúng toàn bộ dump.cs/script.json. Giới hạn
state mặc định 64KiB; file lớn phải chọn/chia evidence, không silently truncate.
Body tối đa 32MiB UTF8, max JSON depth64, finite numbers, exact IDs/addresses strings.
Không hứa byte budget tương đương context-token limit của model.

`jev run <request.json> --out <result.json> [--timeout <seconds>]` là hành động gửi
dữ liệu rõ ràng. Không tự gửi khi tạo request/bundle/doctor. Không có CLI tùy chọn
đổi API host; redirects bị chặn; key không đi vào artifact/log. Không tự retry request
để tránh gửi/tính phí lặp ngoài ý muốn. HTTP/auth/rate-limit/timeout/malformed answer
trả mã riêng, giữ output cũ và không ghi dở. Không gọi API thật trong test mặc định;
contract tests dùng fetch local giả lập, báo rõ chưa có live service qualification.
Jev thực hiện judgment; toolkit cung cấp evidence và chuyển request/response.

## Ranh giới và nghiệm thu

Các module independent: diagnostics + mcp-probe; handoff + verify; evidence + Jev
adapter + CLI integration. Không sửa installer/GUI hoặc bridge Java trong mốc này.
Mốc 5 reproducible installer/CI giữ trong roadmap sau mốc 3–4.

Nghiệm thu: optional missing tools không chặn prepare; lock/wrong-program/unknown
MCP tách riêng; doctor read-only; gói move/verify/tamper; stale/missing artifacts
phản ánh đúng; output atomic/lock; real native session evidence capture + handoff;
Jev offline request và HTTP contract auth/error/validation; 83 test JS và 6 suite
legacy hiện có tiếp tục pass. Real IL2CPP/GUI/Thumb và live Jev còn là qualification
riêng; không biến fixture/mock thành bằng chứng cho chúng.
