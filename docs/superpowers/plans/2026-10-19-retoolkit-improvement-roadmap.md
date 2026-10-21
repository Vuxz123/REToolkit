# Roadmap cải tiến REToolkit

Cập nhật: 2026-10-19. CLI và lõi xử lý dùng JavaScript/Node.js 24+ theo lựa chọn đã chốt; GUI làm sau. Bản này thay thế giả định PowerShell-first trong đề xuất ban đầu. Installer, GUI và một số adapter PowerShell vẫn được giữ lại.

## Mục tiêu

REToolkit chuẩn bị, định danh, truy vấn và bàn giao dữ liệu Unity IL2CPP. TypeSafe Jev nhận state và câu hỏi có kiểu để đánh giá/so sánh; REToolkit không xây engine chấm điểm riêng. Tài liệu HTTP được xác minh từ [TypeSafe API](https://docs.typesafe.ai/api) do người dùng cung cấp.

## Trạng thái theo mốc

| Mốc | Phạm vi đã triển khai | Phần còn lại |
| --- | --- | --- |
| 0 — Chuẩn hóa | JS entry point/help/README, giữ legacy adapter, runner JS và 6 suite PowerShell | Nghiệm thu GUI/game thật riêng |
| 1 — Định danh/trạng thái | Schema2, native/metadata SHA256+size, chọn input rõ ràng, migration có backup, giữ field lạ | GUI chưa dùng chung model JS |
| 2 — Chạy tiếp an toàn | Fingerprint/output manifest, staged extraction/dump, resume/dry-run, lease engine/workspace, reimport có backup, `.re` restore | Nghiệm thu nhiều build IL2CPP thật |
| Bridge — theo hướng REA | JVM/Program/decompiler sống lâu, truy vấn, rename/comment, plan/apply IL2CPP labels, snapshot/journal/recovery | Experimental v1; full C types/signatures và GUI provider chưa làm |
| 3 — Chẩn đoán | Doctor/status theo tác vụ, mã/action ổn định, MCP discovery có deadline, exact native binding, analysis/symbols độc lập | GUI dùng model này sau; MCP instance không chứng minh được hash vẫn unknown |
| 4 — Handoff/Jev | Folder/ZIP manifest portable, verify hash/CRC, capture pseudocode/xref, request offline, HTTP adapter gửi tường minh | Live Jev acceptance chưa chạy; không tuyên bố tương thích nhập ZIP trực tiếp |
| 5 — Phát hành/cài đặt | Locked ZIP cho JDK21/Ghidra/Dumper/AssetRipper; Python/MCP CLI dùng generation và wheel lock offline; journal/rollback/engine leases, CI Windows, GUI provenance | Nghiệm thu bộ vendor/bridge+extension thật, .NET/PyGhidra GUI reproducibility, hosted CI và GUI/game thật |

Mốc 3–4 có [design](../specs/2026-10-19-milestones-3-4-design.md), [implementation](2026-10-19-milestones-3-4-implementation.md), [hướng dẫn](../../diagnostics-and-jev.md), và [verification](../specs/2026-10-19-milestones-3-4-verification.md) riêng.

## Nguyên tắc nghiệm thu

- Input/output thuộc đúng build/cấu hình; tên file hoặc cờ cũ không đủ.
- Prepared, query-ready, analysis và symbols là kết luận độc lập.
- Không ghi đè Program đã phân tích ngầm định; ghi có backup, revision guard và lưu bền vững trước khi báo thành công.
- Giữ workspace cũ, field lạ và khả năng phục hồi migration.
- Thiếu công cụ tùy chọn không chặn tác vụ không dùng nó.
- Handoff phân biệt metadata, pseudocode, output tái dựng; không gọi đó là source gốc. Giữ rõ thiếu/partial.
- Mock/unit, fixture engine thật, GUI/game thật và live Jev được báo riêng.

## Mốc 5: đã triển khai và phần cần nghiệm thu

Đường locked install và kiểm thử phát hành được mô tả trong
[hướng dẫn](../../toolchain-and-release.md),
[design](../specs/2026-10-19-release-hardening-design.md),
[kế hoạch](2026-10-19-release-hardening-implementation.md) và
[kết quả kiểm chứng](../specs/2026-10-19-release-hardening-verification.md).
Không có thay đổi engine đang dùng trên máy; fixture ZIP không chứng minh bộ
vendor chạy đúng cùng nhau. Luồng legacy `-All` giữ hành vi cũ; chỉ đường
`-LockedManifest`/`toolchain install` và `-PythonManifest`/`python-runtime install`
có staging/rollback mới theo phạm vi từng installer. Python/MCP CLI có
[hướng dẫn](../../python-runtime.md), [design](../specs/2026-10-19-python-mcp-lock-design.md),
[kế hoạch](2026-10-19-python-mcp-lock-implementation.md) và
[kiểm chứng](../specs/2026-10-19-python-mcp-lock-verification.md) riêng.

1. Manifest bộ phiên bản Ghidra/JDK/Il2CppDumper/MCP bridge+extension/AssetRipper đã kiểm chứng; update chủ động và ghi lại trước/sau.
2. Đã có staging/checksum/layout/rollback cho bốn ZIP relocatable. Python/MCP CLI đã dùng CPython 3.12 x64 và toàn bộ wheel khóa hash, pip offline, generation tại đường dẫn cuối, receipt/file verify và rollback con trỏ. Bộ vendor CPython3.12.10/bridge6.0.0/pywin32312 đã qua cài offline và stdio với35 distribution; metadata extension khớp Ghidra12.1.2. Plugin/GUI thật, .NET và PyGhidra GUI còn riêng; hash tự tính chỉ định danh bản tải. Xem [kiểm chứng vendor](../specs/2026-10-20-vendor-mcp-qualification-verification.md).
3. Đã thêm CI Windows chạy JS và PowerShell 5.1 không tải engine; chưa chạy hosted workflow. Engine acceptance riêng. PowerShell 7 chỉ khi công bố hỗ trợ.
4. Fixture release: archive lồng, case collision, nhiều ABI/metadata, Unicode/khoảng trắng, migration/resume, output thiếu/hỏng.
5. Kiểm chứng build IL2CPP được phép sử dụng: prepare, analyzed workspace, `.re` transfer/reopen, exact MCP query và review handoff.
6. Đã thêm sidecar revision/hash/compiler/EXE và kiểm thử staging/rollback bằng compiler fixture. Còn compile/GUI thật và chuyển GUI sang model JS để cùng kết luận với CLI.

Ngoài phạm vi: decompiler/engine so sánh riêng, mở rộng web/Electron/firmware, tự động toàn bộ phân tích IL2CPP mặc định.
