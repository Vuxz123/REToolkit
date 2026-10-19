# Thiết kế bridge Ghidra giữ phiên cho REToolkit

Ngày: 2026-10-19
Trạng thái: Đã được người dùng duyệt ngày 2026-10-19; đã triển khai bản thử nghiệm v1, xem `docs/ghidra-bridge.md` về kiểm thử và giới hạn qualification.
Phạm vi đã xác nhận: CLI JavaScript trước; bản đầu có truy vấn, áp symbol IL2CPP, rename và comment. GUI làm sau.

## 1. Quyết định kiến trúc

Tự xây bridge Java nhỏ, chạy bằng Ghidra headless trên project đã có trong workspace. Một supervisor Node giữ JVM và khóa workspace trong suốt phiên; các lần gọi CLI kết nối trực tiếp vào endpoint của bridge. Giữ một `DecompInterface` cho mỗi Program, tuần tự hóa mọi thao tác Ghidra API.

| Phương án | Điểm mạnh | Đánh đổi | Quyết định |
| --- | --- | --- | --- |
| Bridge Java headless riêng | CLI JS truy vấn trực tiếp; kiểm soát lưu project, symbol và transaction | Phải tự kiểm thử protocol và vòng đời | Chọn |
| Dùng REA làm provider | Có sẵn lớp truy vấn và lifecycle | Phạm vi Windows, project tạm và chính sách mutation khác nhu cầu lưu workspace | Chỉ tham khảo cách tổ chức |
| Tiếp tục chỉ dùng GhidraMCP GUI | Đã có truy vấn/ghi trong GUI | Phụ thuộc GUI và Python bridge cho CLI | Giữ đường tương thích trong thời gian chuyển đổi |

Tham khảo bridge Java và client của REA, không sao chép nguyên kiến trúc project tạm. Hành vi đề xuất bên dưới là thiết kế REToolkit; chưa được coi là đã chạy được.

## 2. Tích hợp với hiện trạng

- `src/toolkit.js`: hiện import/analyze theo từng tiến trình; receipt kiểm tra native hash và program. Giữ những lệnh này hoạt động khi không có phiên.
- `src/state.js`: tái sử dụng khóa workspace và quy tắc không thu hồi khóa khi còn engine marker chưa xác định được tình trạng.
- `src/process.js`, `src/engine-worker.js`: tái sử dụng phần launch, log và supervisor; bổ sung kênh quản lý phiên, không giả định supervisor hiện tại đã biết shutdown một server Java lâu dài.
- `scripts/ghidra/RetkProgramReceipt.java`: tách kiểm tra identity dùng chung với bridge; kiểm tra receipt vẫn phải pass.
- `re.js`: thêm nhóm lệnh session/query/write; tách dispatch của nhóm mới sang module riêng.
- `mcp` hiện tại tiếp tục là backend GUI/Python có tên rõ ràng. Adapter MCP Node mới là bước kế tiếp trên cùng protocol, không phải điều kiện để CLI bridge v1 hữu ích.

Không tăng schema project chỉ để ghi PID/port. Trạng thái phiên là runtime tạm, tách khỏi `project.re.json`. Lịch sử chỉnh sửa đã lưu và provenance symbol là dữ liệu workspace có thể export.

## 3. Thành phần và trách nhiệm

| File đề xuất | Trách nhiệm |
| --- | --- |
| `src/ghidra/protocol.js` | Kiểm tra request/response, phiên bản protocol, operation và giới hạn |
| `src/ghidra/runtime.js` | Thư mục phiên, quyền truy cập, descriptor, atomic publish, discovery |
| `src/ghidra/client.js` | Kết nối, xác thực, request ID, paging, deadline, lỗi có cấu trúc |
| `src/ghidra/supervisor.js` | Sở hữu khóa/JVM, backup đầu phiên ghi, control connection, heartbeat, stop |
| `src/ghidra/provider.js` | Điều phối project identity, query và ghi; cập nhật provenance theo receipt đã lưu |
| `src/ghidra/environment.js` | Dùng chung cấu hình JDK/Ghidra/runtime isolation cho tác vụ ngắn và phiên lâu dài |
| `src/ghidra/cli.js` | Dispatch các lệnh mới, tách khỏi entry point hiện tại |
| `src/il2cpp/symbol-plan.js` | Hợp đồng input/profile, gọi bridge tạo plan và trình bày summary/hash/provenance |
| `scripts/ghidra/RetkSessionBridge.java` | Entry `HeadlessScript`, socket accept, lifecycle, queue |
| `scripts/ghidra/RetkProgramIdentity.java` | Identity thực tế của Program và metadata phiên |
| `scripts/ghidra/RetkQueries.java` | Function, strings, xref, assembly, bytes, decompile |
| `scripts/ghidra/RetkMutations.java` | Transaction, rename/comment, symbol plan, save và journal |
| `test/ghidra-*.test.js`, `test/il2cpp-symbol-plan.test.js` | Unit/contract/lifecycle tests không cần engine |
| `test/real-ghidra-session.mjs` | Acceptance với Ghidra thật trên fixture do toolkit tạo |

Giao tiếp dữ liệu chỉ dùng JSON có schema; không có endpoint thực thi Java/Python/shell tùy ý.

## 4. Hai chế độ phiên

### Phiên đọc, mặc định

Mở đúng project/program bằng `-process`, `-noanalysis`, `-readOnly`, `-scriptPath`, `-postScript RetkSessionBridge.java`. Không `-import`, `-overwrite` hoặc `-deleteProject`.

Đọc được symbol/annotation đã lưu. Không tự Auto Analysis hay áp symbol. Khi analysis chưa xác minh, kết quả trả `analysisStatus: unknown` hoặc trạng thái đã quan sát, không coi danh sách function rỗng là chắc chắn không có function.

### Phiên chỉnh sửa, khởi động bằng `--write`

Trước khi mở JVM, supervisor giữ khóa workspace, kiểm tra project không bị GUI/headless khác mở, tạo backup toàn bộ project và kiểm tra manifest backup. Sau đó mở `-process -noanalysis` với quyền ghi; không dùng `-readOnly`.

`--write` chỉ cho phép các mutation đã định nghĩa. Việc thực thi vẫn cần lệnh cụ thể như `function rename`, `comment set`, `symbols apply`. Không tự đổi từ phiên đọc sang phiên ghi. Phiên đọc gặp lệnh ghi trả `write_session_required` với lệnh stop/start tương ứng.

Chọn chế độ khi start giúp lifetime, Ghidra save semantics và backup rõ ràng. Không hỏi xác nhận lặp lại trong CLI: các lệnh ghi và tùy chọn thay thế conflict là ý định thực thi cụ thể của người dùng.

## 5. Khởi động, sử dụng và đóng phiên

1. `session start` kiểm tra workspace tồn tại, project/program path hợp lệ và identity native/metadata. Không tạo/import project như tác dụng phụ.
2. Spawn supervisor Node độc lập. Supervisor tự giành khóa workspace; CLI gọi start không giữ một khóa rồi chờ supervisor lấy lại cùng khóa.
3. Supervisor tạo runtime riêng tại `<toolkit>/.cache/ghidra-sessions/<workspace-key>/<run-id>/`. Nếu là phiên ghi, hoàn tất backup trước khi launch.
4. Ghi descriptor bí mật, launch Ghidra bằng đường dẫn đã resolve. Java giữ `currentProgram` và xác nhận hash, domain path, program name, image base, address space, language/compiler cùng Ghidra version.
5. Java bind IPv4 loopback cổng ngẫu nhiên; publish endpoint atomically. Supervisor mở control connection và hoàn tất handshake. Chỉ publish phiên ready sau khi đối chiếu toàn bộ binding.
6. CLI start trả về khi ready. Lần query sau xác thực lại run ID/identity; không khởi động JVM khác. Nếu đã có phiên tương thích thì start trả thông tin phiên đó; khác mode/profile thì trả conflict.
7. Stop ngừng nhận request mới, hủy request đang chờ, cho tác vụ đang chạy hoàn tất/hủy có kiểm soát, dispose decompiler, kết thúc script và đợi cây tiến trình thuộc phiên đóng.
8. Chỉ sau đó mới xóa descriptor/endpoint và thả khóa. Project `.gpr/.rep` và các thay đổi đã lưu được giữ lại.

Mặc định startup deadline 300 giây, handshake 5 giây, request 60 giây; decompile cho override tối đa 300 giây. Idle timeout 15 phút, chỉ đếm khi không có request/transaction đang chạy. Idle-close và stop dùng cùng đường cleanup.

Kênh control giữa supervisor và Java sống suốt phiên, heartbeat mỗi 5 giây. Mất kênh không được coi là xác nhận Java đã chết: Java ngừng nhận mutation mới, xử lý transaction theo trạng thái rồi đóng; worker vẫn giữ marker đến khi launcher thực sự đóng. Nếu chưa xác định được engine đã dừng, giữ trạng thái `cleanup-pending` và khóa, không khởi động đè.

CLI start timeout chỉ kết thúc thời gian chờ. Nó gửi yêu cầu hủy startup cho đúng run; không xóa runtime/khóa khi chưa xác nhận cleanup. Không dùng PID đơn thuần để kill hoặc để tuyên bố process ownership.

## 6. Quyền truy cập và protocol

V1 dùng TCP `127.0.0.1` trên mọi host để giảm hai đường code. Trước mắt chỉ qualification Windows hiện tại; không suy ra hỗ trợ Linux/macOS từ việc transport có thể chạy.

Token ngẫu nhiên 32 byte, endpoint/descriptor thuộc đúng run. Tạo thư mục runtime và xác minh quyền truy cập trước khi ghi token: Windows dùng adapter `icacls.exe`/SID của user hiện tại với quyền user và SYSTEM; POSIX khi qualification dùng thư mục 0700/file 0600. Nếu không thiết lập/đọc lại được quyền yêu cầu thì startup thất bại. Không cần native addon ở bản đầu; không tuyên bố cách này chống được tiến trình độc hại cùng user.

Descriptor có protocol version, run ID, workspace canonical path, mode, project/domain path, identity input/profile và token. Token không vào stdout, log, project JSON hoặc archive. Endpoint public chỉ gồm host, port, run ID và đường dẫn descriptor riêng.

Request NDJSON gồm `version`, `id`, `runId`, `method`, `params`, thông tin xác thực. Read/write methods có allowlist và validate field; số địa chỉ 64-bit luôn truyền bằng chuỗi hex, không qua JavaScript Number.

Response gồm `id`, `runId`, `ok`, `result` hoặc `error`, `programIdentity`, `revision`, `coverage`, `limitations`. Các dữ liệu lấy từ target, kể cả symbol/comment và pseudocode, được đánh dấu dữ liệu không đáng tin để agent không làm theo chỉ dẫn nhúng trong đó.

Giới hạn: request 64 KiB, mỗi response frame 2 MiB, hàng đợi tối đa 32 request. Function/string/xref list mặc định 100 mục, tối đa 1000; bytes read tối đa 4096 byte/lệnh. Text decompile có paging theo cursor, không cắt surrogate pair; frame lớn không bị truncate âm thầm. Cursor gắn với run ID và revision; cursor cũ sau mutation trả `stale_cursor`.

Một control connection riêng phục vụ heartbeat/stop/cancel; mọi thao tác Program chạy trên một luồng owner nối với hàng đợi. Socket thread chỉ đọc, kiểm tra schema và enqueue; không gọi Ghidra API trực tiếp.

## 7. Truy vấn v1

| CLI đề xuất | Java operation | Kết quả |
| --- | --- | --- |
| `session start/status/stop <Game>` | lifecycle, ping, shutdown | Binding, mode, readiness, hoạt động hiện tại |
| `function list <Game>` | `functions.list` | Address, namespace/name, signature, paging |
| `function get <Game> <address>` | `functions.get` | Một function và provenance quan sát |
| `decompile <Game> <address-or-unique-name>` | `functions.decompile` | Pseudocode, signature, coverage, diagnostic |
| `disasm <Game> <address>` | `instructions.list` | Instruction trong phạm vi yêu cầu |
| `xrefs <Game> <address> --direction to/from` | `references.list` | Typed references và paging |
| `strings <Game> --query <text>` | `strings.search` | Nội dung, địa chỉ, encoding khi biết |
| `bytes read <Game> <address> --length <n>` | `memory.read` | Bytes từ loaded memory và coverage |

Name selector phải duy nhất; trùng tên trả danh sách ứng viên, không tự chọn. Address nhận `0x...` hoặc `space:0x...`; không tự trộn RVA, VA và file offset. Byte query ghi rõ nguồn là loaded Program memory, không khẳng định bằng bytes gốc nếu DB đã được patch trước đây.

Sau mỗi mutation thành công, tăng revision và flush cache decompiler cùng toàn bộ cache query liên quan. Bản đầu chỉ cần cache decompiler của Ghidra; chưa xây cache kết quả riêng để tránh stale data. Việc reuse JVM được đo bằng process/run ID, không suy ra từ độ nhanh cảm nhận.

## 8. Rename và comment v1

- `function rename <Game> <address> <name>`: chỉ tác động function entry đã có, kiểm tra tên hợp lệ, conflict và giá trị cũ. Không ngầm đổi tên program hoặc tạo function ở địa chỉ tùy ý.
- `comment set <Game> <address> --type eol|plate|pre|post|repeatable --text <text>`: chỉ đổi loại comment được chọn. `--file <utf8-file>` hỗ trợ nội dung dài; CLI chuẩn hóa thành payload trước khi gửi.
- Cả hai có `--dry-run`, trả before/after, địa chỉ, conflict và expected revision mà không ghi DB.
- Request thực thi có operation UUID, payload hash, expected revision và expected old value. Xung đột revision hoặc dữ liệu cũ trả conflict; không retry mutation bằng ID mới một cách tự động.
- Đổi tên rõ ràng bằng lệnh rename là yêu cầu thay thế tên tại entry đó. Bulk import có chính sách bảo toàn tên người dùng riêng bên dưới.

## 9. Áp symbol IL2CPP v1

### 9.1. Đầu vào và mapping

Nguồn là `02_Il2CppDumperOutput/script.json` thuộc đúng dump hiện hành. Bind native hash, metadata hash, script hash, dumper profile, program identity, image base và revision. Dump stale/không xác minh được thì từ chối apply; cung cấp lệnh dump/scan để chuẩn bị lại, không dùng file có tên giống nhau làm bằng chứng.

Đọc số nguyên trong script.json theo decimal text/BigInt, Java đọc theo số nguyên không dấu phù hợp; không parse địa chỉ lớn qua JS Number. Chuẩn hóa thành chuỗi hex trong plan.

Upstream `StructGenerator` xuất địa chỉ qua `GetRVA`; định nghĩa profile Il2CppDumper đã kiểm chứng sẽ map `imageBase + RVA`. Profile không nhận diện được phải yêu cầu `--address-mode rva|va` và preview; không đoán bằng độ lớn địa chỉ. ARM/Thumb giữ raw address và canonical instruction address riêng; chỉ chuẩn hóa theo profile/loader đã có fixture kiểm chứng, không xóa bit Thumb tùy tiện trên mọi ABI.

Mọi entry được kiểm tra đúng address space, overflow, vùng memory mapped và loại vùng code/data. Ghi lại raw address, mapped address, lý do bỏ qua hoặc conflict. Không lấy khoảng cách tới method tiếp theo làm bằng chứng chắc chắn về function body.

### 9.2. Phạm vi áp dụng

Hỗ trợ ngay các nhóm của template `ghidra.py` hiện tại: `ScriptMethod`, `ScriptString`, `ScriptMetadata`, `ScriptMetadataMethod`, `Addresses`. Áp labels/names, comment metadata/string và tạo function entry hợp lệ khi yêu cầu. Full `il2cpp.h`, C signature và struct/type reconstruction của `ghidra_with_struct.py` là bước mở rộng riêng, không gộp vào tiêu chí symbol v1.

Tên/symbol import mới dùng provenance IMPORTED kèm mapping gốc; tên USER_DEFINED đang có được bảo toàn mặc định. Tên đã giống target là no-op. Các label cũ do Python tạo với USER_DEFINED và không có provenance không tự bị coi là do toolkit sở hữu.

Sanitize tên theo quy tắc xác định trước, giữ original name trong receipt. Collision sau sanitize được giải quyết bằng suffix address ổn định nếu không đụng tên người dùng; không âm thầm thay label khác. Comment tự sinh chỉ cập nhật block do REToolkit quản lý, giữ nguyên nội dung người dùng ngoài block.

`Addresses` chỉ cung cấp ứng viên entry. Mặc định không tạo function mới; `--create-functions` thêm các entry có instruction/code mapping phù hợp, không chồng function hiện có. Entry không xác định được được báo skipped, không xóa function/disassembly để ép tạo.

### 9.3. Plan rồi apply

1. `symbols plan <Game>` yêu cầu bridge stream-read script.json đã bind với workspace, kiểm tra target/conflict và tạo plan bất biến dưới `04_Notes/symbol-plans/<plan-id>.json` cùng summary. Java đọc số nguyên trực tiếp; Node không materialize địa chỉ qua Number.
2. Plan chứa đầy đủ binding, policy, revision, count planned/no-op/conflict/skipped và hash nội dung. Bulk data đi qua file plan được kiểm tra hash; không gửi cả script.json trong một frame socket.
3. `symbols apply <Game> --plan <path>` chỉ dùng plan trong workspace tương ứng. Java mở và kiểm tra chính bytes/hash đó, revalidate revision, before values, inputs và policy trước khi mutation.
4. Mặc định bỏ qua conflict tên/comment của user. Muốn thay chúng phải tạo plan mới có `--replace-user-names` hoặc `--replace-user-comments`; summary thể hiện rõ trước/sau. Không có prompt xác nhận vòng hai.
5. Tất cả entry hợp lệ trong plan là một mutation atomic. Không hỗ trợ chế độ ghi từng phần rồi coi như thành công hoàn chỉnh ở v1. Validation skip đã biết được thống kê riêng; lỗi/cancel bất ngờ trong lúc apply rollback toàn bộ mutation.
6. `symbolsApplied` chỉ true khi policy/nhóm yêu cầu hoàn thành, không còn mục bắt buộc chưa giải quyết. Plan áp được một phần do conflict/skipped trả coverage partial; step dùng unknown kèm receipt/coverage, không giả completed từ exit code 0.

Plan revision cũ bị từ chối sau một rename/comment khác. Cùng script/policy/revision mà mọi target đã đúng sẽ là no-op, không tạo backup/transaction mới vô ích.

## 10. Transaction, lưu bền và khôi phục

Mỗi mutation phải đi qua cùng một mutation executor; không có đường rename/comment riêng bỏ qua save/backup.

1. Đóng transaction wrapper của GhidraScript theo API phù hợp trước khi server nhận mutation; kiểm tra không còn outer transaction khiến rollback bị trì hoãn.
2. Kiểm tra mode, identity, revision, before values, disk writability và operation UUID/payload hash.
3. Tạo snapshot Program bằng `saveToPackedFile` thành file `.gzf` tạm, rename sau khi thành công và ghi hash/manifest. Không copy `.rep` đang mở. Snapshot thất bại thì chưa bắt đầu mutation.
4. Ghi journal intent có operation ID, expected revision, plan/payload hash và snapshot reference.
5. Bắt đầu transaction ngoài cùng, áp mutation, ghi operation marker và revision mới trong Program options cùng transaction. Exception/cancel trước commit gọi rollback, giữ revision cũ.
6. Commit transaction; gọi Program save và kiểm tra readback. Nếu save thành công, atomically ghi receipt saved rồi mới trả thành công.
7. Nếu commit/save/receipt rơi vào tình trạng chưa xác minh, phiên chuyển `needs-recovery`; chỉ cho status/stop/recovery, không phục vụ query hoặc mutation như thể DB đã ổn. Không tuyên bố rollback bền chỉ vì transaction đã kết thúc.

Trả success nghĩa là thay đổi đã được lưu, không chỉ đang nằm trong RAM. Receipt gồm operation ID, before/after, revision, input/profile hashes, snapshot ID, save status và coverage.

Ledger trong Program lưu tối đa 1024 operation IDs gần nhất; journal đầy đủ thuộc workspace. Retry cùng ID/cùng hash trả kết quả đã xác minh; cùng ID/khác hash bị từ chối. Sau reconnect, chỉ xác nhận saved khi ledger trong Program vừa mở và journal/receipt thống nhất. ID đã ra khỏi cửa sổ xác minh trả `idempotency_expired`, không tự áp lại.

Backup toàn project đầu write-session phục hồi được cả program và project metadata. Snapshot `.gzf` phục hồi một Program trước operation; phải stop/confirm engine closed rồi restore vào project mới để kiểm tra trước khi thay project hiện hành. Không import snapshot đè database đang mở. Backup/restore cần fixture engine thật trước khi bật mutation trong bản phát hành.

Cache/cursor cũ mất hiệu lực ngay khi transaction commit; nếu save chưa rõ thì phiên vẫn bị chặn. Transaction rolled back phải kiểm tra lại decompiler state trước khi nhận query tiếp.

## 11. Khóa, GUI và các lệnh hiện có

Supervisor sở hữu `.retk-lock` từ trước launch đến sau engine close. Client query/write không tự acquire lại khóa; chúng xác thực qua session binding. Không mở bypass chung cho code không thuộc session.

Bridge Java là tiến trình con được supervisor ủy quyền ghi plan, snapshot và journal vào các thư mục cố định của phiên/workspace; client bên ngoài không tự ghi những artifact đó để né khóa. Mutation saved phát event qua control connection; supervisor đối chiếu receipt trước khi cập nhật project JSON. Nếu state JSON chưa cập nhật được, receipt vẫn ghi rõ DB đã saved và state reconciliation đang pending.

- `session status` đọc descriptor + ping, không gọi `toolkit.status()` đang lấy khóa độc quyền.
- `status <Game>` khi có phiên trả snapshot project + live session status theo đường chỉ đọc, không âm thầm migrate/save project từ client.
- `scan/add/dump/import/analyze/export/import .re`, AssetRipper/LDPlayer mutators trên cùng workspace trả `session_conflict` khi phiên giữ lease. Gợi ý stop, không tự đóng phiên.
- CLI `open/ghidra-gui/pyghidra-gui` kiểm tra session trước khi launch; có phiên thì hướng dẫn stop. GUI được mở bằng tay vẫn chịu khóa project của Ghidra.
- GUI đã mở trước thì session start từ chối, không xóa `.lock` hay kill GUI.
- Hash native/metadata thay đổi trong lúc phiên sống làm binding stale; mutation bị chặn. Client read mặc định cũng yêu cầu restart thay vì trộn dữ liệu build mới với Program cũ.
- Runtime/session token không nằm trong export. History/snapshot/receipt có thể export khi phiên đã dừng và project save đã được xác minh.

Provider là đường duy nhất reconciliation receipt vào `project.re.json`. Chỉ supervisor đang giữ lease mới được save state; client ngoài phiên không ghi đè snapshot cũ. Nếu receipt đã bền nhưng JSON update thất bại, startup sau đối chiếu lại receipt/Program ledger trước khi nâng trạng thái.

## 12. Lệnh minh họa được đề xuất

Các lệnh sau là giao diện thiết kế, chưa có trong CLI hiện tại:

```powershell
node re.js session start FoodHunt --write
node re.js function list FoodHunt --query Board --limit 50
node re.js decompile FoodHunt 0x123456 --json
node re.js symbols plan FoodHunt --create-functions
node re.js symbols apply FoodHunt --plan "workspaces/FoodHunt/04_Notes/symbol-plans/<plan-id>.json"
node re.js function rename FoodHunt 0x123456 Board_Update --dry-run
node re.js function rename FoodHunt 0x123456 Board_Update
node re.js comment set FoodHunt 0x123456 --type plate --text "Update board state"
node re.js session status FoodHunt
node re.js session stop FoodHunt
node re.js open FoodHunt
```

Không tự start JVM từ một query thiếu session ở v1; trả `session_not_running` và lệnh start. Tác vụ launch nặng luôn là hành động rõ ràng. Không đổi backend MCP mặc định trong cùng bản bridge đầu tiên.

## 13. Lỗi có cấu trúc

Các mã v1: `session_not_running`, `session_conflict`, `startup_timeout`, `authentication_failed`, `protocol_mismatch`, `program_mismatch`, `input_changed`, `write_session_required`, `revision_conflict`, `ambiguous_selector`, `address_unmapped`, `plan_invalid`, `backup_failed`, `operation_cancelled`, `operation_unknown`, `idempotency_expired`, `save_failed`, `needs_recovery`, `response_limit`, `queue_full`, `cleanup_pending`.

Lỗi có run/request/operation ID, giai đoạn, log path và hành động tiếp theo; không đưa token hoặc toàn bộ environment vào thông báo. Query lỗi không tự khởi động lại engine rồi replay mutation đang chưa rõ kết quả.

## 14. Kiểm thử và điều kiện phát hành

### Kiểm thử tự động không cần engine

- Strict framing, token/run mismatch, partial frame, schema/size limits và Unicode paging.
- Một start thắng khi có hai CLI đồng thời; query nhiều process đi vào một session/Program queue.
- Tất cả mutator hiện tại bị chặn khi lease đang sống; session status không deadlock.
- Parent/supervisor/worker bị kill ở từng pha; giữ marker khi chưa xác minh cleanup, không mở DB lần hai.
- Lost reply/retry cùng operation ID không áp mutation lần hai; lỗi save/receipt không biến thành success.
- Symbol mapping BigInt, RVA/VA/profile, Thumb, collision, user labels/comments, overlap, invalid address và stale plan.
- Plan/script bị sửa sau preview; partial validation; exception/cancel giữa batch phải rollback.

### Kiểm thử Ghidra thật, bắt buộc trước khi bật ghi

1. Project fixture tự tạo có function/symbol/comment đã lưu; phiên đọc thấy đúng dữ liệu và không đổi DB có ý nghĩa.
2. 20 query liên tiếp dùng cùng Java process/run, một decompiler và không tái import. Ghi lại cold/warm latency; không cam kết mức tăng tốc trước khi đo.
3. Write-session rename + comment; stop, mở lại bằng headless và GUI để đọc đúng kết quả bền.
4. Snapshot `.gzf` tạo/restore thành project riêng, so lại dữ liệu trước mutation. Backup project đầu phiên cũng phục hồi được.
5. Symbol fixture ELF ARM64 và PE với image base khác 0; ARMv7/Thumb qualification riêng. Có một fixture IL2CPP hợp lệ sở hữu/được phép dùng trước khi công bố hỗ trợ bulk symbol cho build thật.
6. Conflict USER_DEFINED được giữ; replace policy chỉ đổi mục đã preview. Bulk exception/cancel không để lại một nửa plan.
7. Có test lỗi sau transaction commit, sau save và trước ack để chứng minh reconciliation/idempotency.
8. Ghidra GUI đang mở chặn phiên; sau stop, project mở GUI được và annotation vẫn còn.
9. Toàn bộ 66 test JavaScript hiện tại và 6 bộ test PowerShell tiếp tục pass; bổ sung suite mới chứ không thay bằng mock-only assertions.

## 15. Thứ tự triển khai sau khi duyệt thiết kế

1. Protocol/runtime private + supervisor lifetime; ping/start/stop và regression giữ khóa.
2. Bridge identity, serial queue và truy vấn; đo JVM reuse trên fixture thật.
3. Write mode, backup/snapshot, transaction/save/journal/idempotency; hoàn tất recovery tests trước mutation release.
4. Rename/comment + symbol plan/apply cho các nhóm plain ghidra.py; qualification ARM64/PE/Thumb theo phạm vi công bố.
5. Tích hợp CLI/status/state, docs, giữ GUI backend tương thích; acceptance toàn luồng và kiểm tra hồi quy.
6. Bước sau v1: MCP Node adapter dùng cùng provider và typed operations; type/signature import đầy đủ là hạng mục riêng.

Đây là thiết kế chức năng và kiến trúc. Kế hoạch triển khai có test/code task chi tiết sẽ được chốt theo thiết kế đã duyệt; chưa sửa code sản phẩm hoặc thay backend hiện tại trong lần thiết kế này.

## 16. Nguồn kỹ thuật đã đối chiếu

- [REA Java bridge](https://github.com/morluto/rea/blob/main/bridge/ghidra/ReaGhidraBridge.java): `HeadlessScript`, socket và direct Ghidra APIs.
- [REA GhidraClient](https://github.com/morluto/rea/blob/main/src/ghidra/GhidraClient.ts): session startup, queue và cleanup ownership.
- [Ghidra HeadlessScript](https://ghidra.re/ghidra_docs/api/ghidra/app/util/headless/HeadlessScript.html) và `tools/ghidra/support/analyzeHeadlessREADME.html` local: script/launch semantics.
- [Ghidra DomainObject](https://ghidra.re/ghidra_docs/api/ghidra/framework/model/DomainObject.html): transaction, save, packed snapshot. Khả năng restore/reopen vẫn phải kiểm thử với engine thật của toolkit.
- [Ghidra DecompInterface](https://ghidra.re/ghidra_docs/api/ghidra/app/decompiler/DecompInterface.html): per-Program decompiler và cancellation/flush APIs.
- [Il2CppDumper StructGenerator](https://github.com/Perfare/Il2CppDumper/blob/master/Il2CppDumper/Outputs/StructGenerator.cs): địa chỉ ScriptMethod/Addresses xuất qua `GetRVA`; profile cụ thể vẫn cần đối chiếu binary thực tế.
- `templates/Il2CppDumper/ghidra.py`, `ghidra_with_struct.py` local: phạm vi import, sourceType/comment handling hiện tại.
