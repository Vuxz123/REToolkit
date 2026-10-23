# REToolkit

REToolkit là bộ công cụ Node.js để chuẩn bị build Unity IL2CPP, phân tích native
bằng Ghidra, đọc asset qua AssetRipper và tái dựng script trên project Unity export.
CLI `retk`, GUI Electron và MCP dùng chung lõi xử lý, workspace và receipt.

Luồng chính: **cài toolkit → nhập APK → chuẩn bị project → mở AI Agent → tái dựng
source/binding → kiểm chứng Unity, gameplay và hình ảnh**. Setup hoặc compile
thành công chưa xác nhận game chơi được.

Chỉ sử dụng build và dữ liệu bạn có quyền phân tích. Không phân phối lại source,
asset hoặc thư viện khi chưa có quyền tương ứng.

## 1. Cài nhanh trên máy mới

Trên Windows x64, clone hoặc giải nén repo vào thư mục cố định, ngắn, ví dụ
`C:\REToolkit`. Mở CMD tại thư mục đó:

```cmd
install.cmd
```

Bộ cài dùng Node.js >=24 kèm npm nếu đã có; nếu chưa có sẽ tải Node portable đã
khóa phiên bản và kiểm tra checksum. Profile mặc định `full` cài dependency,
Electron, JDK/Ghidra, Il2CppDumper, AssetRipper, Python/MCP và runtime desktop/.NET
cục bộ. Sau đó tạo shim `retk` và thêm thư mục shim vào **User PATH**.
Không cần cài sẵn Git/winget nếu dùng bản ZIP.

Mở **CMD mới** sau khi cài:

```cmd
where retk
retk --version
retk gui
```

Các lựa chọn khác:

```cmd
install.cmd --plan --json
install.cmd --profile desktop
install.cmd --profile cli
install.cmd --cache D:\RETK-packages
install.cmd --no-path
```

| Profile | Thành phần |
|---|---|
| `full` | CLI, GUI và engine/runtime |
| `desktop` | CLI + GUI, chưa cài engine |
| `cli` | CLI, chưa cài GUI hoặc engine |

`--plan` không tải hoặc ghi file. `--no-path` tạo shim nhưng không sửa PATH;
chạy trực tiếp `.cache\quickstart\bin\retk.cmd`. Giữ nguyên vị trí checkout vì
lệnh trỏ về đó. Báo cáo cài đặt: `.cache/quickstart/latest.json` và log từng bước.
Chạy lại bộ cài để kiểm tra/tái sử dụng thành phần hợp lệ; transaction chưa rõ
kết quả cần kiểm tra trước khi tiếp tục. Xem [cài nhanh và phục hồi](docs/quick-install.md).

Unity Editor/module/license phù hợp game, LDPlayer, CLI và đăng nhập của Agent,
Jev API key, thư viện ZIP, ảnh/video game gốc cần cấu hình riêng.

### Cài thủ công khi đã có Node.js

```cmd
npm ci
npm run cli:install
npm run gui:install
retk setup install --lock config/native-windows-x64.lock.json --json
retk desktop-runtime install --lock config/desktop-windows-x64.lock.json
retk doctor
retk gui
```

`cli:install` dùng npm link, đăng ký vào npm global prefix có sẵn; riêng lệnh này
không sửa PATH hay tải engine. Kiểm tra `npm prefix -g` nếu CMD chưa tìm thấy lệnh.
Để cài đồng thời cả Python/MCP CLI theo lock, dùng `retk quickstart --profile full`.
Không cần cài một package REToolkit chưa xác minh từ npm registry.
`node re.js <command>` và `re.cmd <command>` vẫn dùng được từ checkout.

## 2. Tạo và chuẩn bị project

Mở `retk gui`, chọn **Tạo project từ APK**:

1. Chọn APK/XAPK và đặt tên workspace mới.
2. Chọn chính sách chuẩn bị; mặc định chạy sau khi nhập. Chọn cách xử lý symbol
   và address mode phù hợp (`rva` hoặc `va`).
3. Xem lại rồi tạo project. Nếu cần lấy split, chọn đúng serial/package LDPlayer.

Archive gốc được giữ trong `00_OriginalBuild`; lần giải nén đầu tiên hoàn chỉnh
nằm trong `01_Extracted`. APK nhiều ABI tự ưu tiên **ARM64 → ARMv7 → x86_64 → x86**
khi binary ở ABI ưu tiên và metadata là duy nhất. Lựa chọn thủ công/đang lưu được
giữ lại. Trùng binary hoặc nhiều metadata vẫn cần chọn chính xác.

CLI tương đương:

```cmd
retk create-project MyGame "D:\Builds\game.xapk" --json
retk prepare MyGame --symbols plan --address-mode rva --json
retk preparation MyGame --json
```

`rva` trong ví dụ cần khớp bằng chứng địa chỉ của build. `--symbols plan` tạo plan;
`--symbols apply` cho phép apply qua backup/transaction/receipt;
`--symbols skip` bỏ bước symbol. `--profile native` chỉ chuẩn bị nhánh native.

Worker chạy nền: prerequisite/Android/input → dump → import/analysis Ghidra →
symbol → export AssetRipper → SQLite index → mapping script ban đầu.
Unity baseline là tùy chọn. Đóng GUI không dừng worker. Lệnh enqueue thoát thành
công chỉ có nghĩa đã giao việc; xem domain report để biết đã xong hay bị chặn.

```cmd
retk preparation MyGame --run <runId> --json
retk prepare MyGame --resume-run <runId> --json
retk inputs MyGame --json
retk inputs resolve MyGame --json
```

Resume giữ policy và chỉ tái sử dụng bằng chứng còn khớp input/tool.
Panel **Binary / ABI và metadata** hỗ trợ project cũ chờ ABI và phục hồi extraction
hoàn chỉnh về `01_Extracted`. `inputs select`/`inputs recover` yêu cầu revision
vừa kiểm tra; không chuyển staging thủ công. Xem
[chuẩn bị và freshness](docs/project-preparation.md), [đầu vào/recovery](docs/project-agent.md).

`retk flow MyGame "D:\Builds\game.apk" --dry-run` là đường ngắn để xem kế hoạch
dump/import; `--resume --no-open` chạy mà không mở Ghidra. `flow` không thay
pipeline chuẩn bị đầy đủ; import `-noanalysis` chưa xác nhận analysis đã chạy.

## 3. Dùng GUI và theo dõi tiến trình

| Khu vực | Dùng để |
|---|---|
| Tổng quan | Bước tiếp theo và readiness từng nhánh |
| Tái dựng | Plan/apply source, binding và workflow Agent |
| Tài nguyên | Input, chuẩn bị, LDPlayer, Ghidra và asset/index |
| Kiểm chứng | Source integrity, Unity, migration và ảnh/video |
| Tác vụ & bằng chứng | Tiến trình, kết quả, lỗi và log của GUI/worker/MCP |
| Kho thư viện | Folder ZIP, catalog, plan/import vào staging |
| Cài đặt | Công cụ/runtime, Agent và Jev |

Kết quả hiển thị bằng bảng, trạng thái và trường có nhãn; JSON kỹ thuật được thu
gọn. Kết quả lớn có đường dẫn file đầy đủ. Mở job trong **Tác vụ & bằng chứng** để
xem stage, elapsed time, log và receipt. **Làm mới/Kiểm tra bằng chứng** xác minh
freshness tại thời điểm bấm.

Thẻ **Ghidra · Tác vụ và tiến độ** quan sát cả job CLI/Agent, owner/PID và log gần
nhất. Log yên lặng hoặc PID còn sống chưa đủ kết luận tiến triển hay bị treo.
Không có phần trăm/ETA giả cho engine không cung cấp tổng khối lượng.
Xem [GUI và giới hạn quan sát](docs/desktop.md).

## 4. Mở AI Agent và MCP

Cài và đăng nhập harness trước. Trong header project, chọn **Codex CLI**, **Claude
Code**, **Gemini CLI** hoặc **OpenCode**, rồi bấm **Mở AI Agent**.
Terminal mở tại đúng workspace với context, workflow và MCP riêng phiên:

- `retoolkit_assets`: asset, source reconstruction, validation, thư viện, ADB và job.
- `retoolkit_ghidra`: bridge tới Ghidra GUI đang mở; cần runtime, đúng Program
  và server GhidraMCP đang chạy để truy vấn live.

Phiên lưu trong `04_Notes/agent-sessions/<UUID>/`. Terminal mở chưa xác nhận
đăng nhập/MCP thành công. Agent đọc `preparation_status` và checklist/task đã lưu
trước, dùng bằng chứng hiện hành rồi xử lý blocker, không lặp setup. Ví dụ giao việc:

> Tiếp tục project theo workflow đi kèm. Đọc task ledger và preparation status;
> tái dựng cụm item–slot, lập plan source có evidence, kiểm tra integrity rồi
> validation đúng các asset liên quan. Báo riêng compile, binding và gameplay.

Thao tác dài dùng `jobs_start`; lưu `jobId`, đọc bằng `jobs_get`/`jobs_wait`.
Kết quả có stage, log giới hạn và result/`resultReference`. Job tiếp tục khi MCP
ngắt kết nối. Ba lời gọi MCP riêng:

```json
{"name":"jobs_start","arguments":{"operation":"workspace.dump","params":{}}}
```

```json
{"name":"jobs_get","arguments":{"jobId":"<UUID>"}}
```

```json
{"name":"jobs_wait","arguments":{"jobId":"<UUID>","timeoutSeconds":25}}
```

Codex CLI có `agent.wake_after` để gửi tiếp việc vào **đúng thread** sau job.
Agent phải xác nhận watcher `running`, `wakeProgress.state: waiting` và
`transportReady: true` trước khi kết thúc lượt. `queued` chưa chứng minh Agent đã
thức dậy. Ba harness còn lại chưa có adapter tự đánh thức; lời nhắn “Next…” không
tự tạo continuation. Xem [Agent/MCP](docs/project-agent.md),
[continuation và delivery](docs/agent-continuations.md).

### Agent Skills And Older Installations

[Workflow tái dựng](skills/retoolkit-game-reconstruction/SKILL.md) chứa mapping
asset/script, native evidence, plan/apply, thư viện, migration và các gate kiểm chứng.
Các skill khác: [cài đặt](skills/retoolkit-install/SKILL.md),
[chuẩn bị build](skills/retoolkit-flow/SKILL.md),
[Ghidra/MCP](skills/retoolkit-mcp-analysis/SKILL.md).
Launcher đóng gói workflow từng phiên, không tự ghi đè skill/config toàn máy.
Cấu hình MCP thủ công và cập nhật integration cũ theo
[hướng dẫn cài skill](prompts/install-ghidra-skill.md).

## 5. Thiếu split hoặc dữ liệu tải thêm

Toolkit đọc manifest/dependency split. Thiếu `libil2cpp.so` chưa đủ chứng minh thiếu
split. Với serial/package đã chọn, pipeline kiểm tra package/version/base hash/
chữ ký trước khi phục hồi từ LDPlayer; không trộn build khác. Input đã có kết quả
downstream cần review trước khi thay.

```cmd
retk adb devices --adb C:\LDPlayer\LDPlayer9\adb.exe --json
retk adb packages --serial emulator-5554 --json
retk pull-ldplayer MyGame com.example.game --serial emulator-5554 --skip-launch --include-data --json
```

Nếu ADB chưa được tìm thấy, truyền `--adb <đường-dẫn-adb.exe>` cho lệnh tương ứng.
Chọn serial/package thật từ discovery. Hoàn thành download trong game trước khi
capture; GUI/MCP không mở game. APK/split/OBB vào XAPK; external/private data có
quyền đọc vào ZIP riêng. Bị từ chối quyền được báo partial. Không thể chứng minh
offline toàn bộ PAD/CDN đã tải. Xem [capture và coverage](docs/adb-capture.md).

## 6. Đọc asset và tái dựng source

Nếu chưa dùng preparation, chạy nhánh AssetRipper riêng:

```cmd
retk assets session start MyGame --json
retk assets session status MyGame --json
retk assets export MyGame --json
retk assets index MyGame --json
retk assets scripts MyGame --query Namespace.Type --json
retk assets session stop MyGame
```

Chờ load/export job thực sự hoàn tất. Project Unity export nằm dưới
`05_ReconstructedSource`. Có export rồi thì index trực tiếp. Export lớn dùng
SQLite theo [hướng dẫn lưu trữ](docs/assets-storage.md); Agent đọc query/trang
có giới hạn thay vì đưa cả graph vào context. SQLite cần Node.js 24.15 trở lên;
Node portable của bộ cài nhanh đã đáp ứng điều kiện này.

Source request dùng revision/script ID hiện tại; xem
[schema và ví dụ](docs/assetripper-ai.md). Sau khi xem xét plan:

```cmd
retk reconstruct plan MyGame --request request.json --json
retk reconstruct apply MyGame --operation <UUID> --json
retk reconstruct verify MyGame --operation <UUID> --json
```

`mode: bodies` thay thân hàm hiện có và giữ declaration, hỗ trợ nhiều source có
generic/nested/property. `mode: initialization` dành riêng cho constructor bị
thiếu, cần dump/native evidence đúng build. Không chuyển khởi tạo tùy ý sang
`Awake` để vượt gate. Xem [source recovery](docs/source-recovery.md).
Receipt apply chưa chứng minh logic, compilation hoặc gameplay đúng.
Class dữ liệu không generic thiếu `.meta` có route riêng khi không có base clause
và component binding, vẫn cần proof constructor đúng build. Apply source-only
refresh script/index thay vì dựng lại toàn graph; SQLite vẫn cần copy/hash database.
Xem `graphRefresh` và `assetProgress` để phân biệt ghi source với cập nhật index.

## 7. Thư viện Unity và migration

Đăng ký folder chứa ZIP thư viện; mặc định chưa có root:

```cmd
retk libraries roots add "D:\UnityLibraries"
retk libraries scan --json
retk libraries list --query dotween --limit 20 --json
retk libraries identify MyGame --section requirements --limit 100 --json
retk libraries plan MyGame --json
```

Agent ưu tiên thử **phiên bản thực có trong catalog**, ghi riêng requirement gốc
và version thử. Khi lỗi compile/integration do version mới tìm bản đúng. Import
saved plan vào staging rồi verify, vẫn kiểm tra dependency/collision/binding.
UPM/engine module dùng đường cài riêng; xem
[bản đồ package](skills/retoolkit-game-reconstruction/references/unity-packages.md)
và [catalog/import](docs/libraries.md). Thư viện ZIP local không đi kèm source repo.

DLL stub không thành implementation thật chỉ vì compile pass. Đổi DLL, rebinding
hoặc rename field cần migration có Editor observation, plan, staging và verify;
không xóa DLL/sửa GUID để né lỗi. Chưa hỗ trợ tự chuyển toàn bộ DLL sang C#,
arrays/nested/managed-reference field hoặc đổi kiểu tùy ý. Xem
[phạm vi migration](docs/desktop.md#script-and-field-migration).

## 8. Kiểm chứng Unity, gameplay và giao diện

Validation dùng bản sao staging và Editor khớp project, giữ export gốc:

```cmd
retk reconstruct validate MyGame --json
retk reconstruct validation MyGame --operation <UUID> --section assets --limit 20 --json
retk reconstruct validate MyGame --resume-operation <UUID> --json
```

Scope nhận scene `.unity`, prefab `.prefab` và bảng `.asset`, gồm main/subasset.
Chọn đúng ID từ index qua trường `assetIds` trong GUI/MCP. Mọi source vẫn tham gia
compile; `scopeBindingsVerified` chỉ xác nhận binding scope, không phải toàn project.
Giới hạn/lỗi load giữ asset pending và báo partial. Resume chỉ tái sử dụng
checkpoint khớp source/Editor/helper/scope.

Sau cập nhật helper hỗ trợ `.asset`, **khởi động lại MCP/GUI và tạo validation mới
với policy cũ**, giữ các file bảng; không resume receipt của helper cũ.
Xem [validation và resume](docs/unity-validation.md).

| Bằng chứng | Điều được xác minh |
|---|---|
| Source integrity | File áp dụng khớp plan/receipt |
| Compile | Compiler Unity thành công |
| Binding | Script/reference hợp lệ trong scope đã kiểm tra |
| Gameplay | Hành vi chạy thực qua ca kiểm thử được ghi nhận |
| Visual | Ảnh/frame khớp baseline gốc đúng profile và trạng thái |

Request ảnh/video cần baseline, candidate, screen/state, resolution/profile,
vùng kiểm tra và ngưỡng:

```cmd
retk visual compare MyGame --request visual-request.json --json
retk visual report MyGame --operation <UUID> --json
```

Video cần ffmpeg được chọn rõ và timestamp căn chỉnh. Không có ảnh/video gốc thì
visual fidelity vẫn `unverified`; fixture chỉ kiểm tra cơ chế so sánh.
Xem [schema ảnh/video và diff](src/visual/README.md).

## 9. Ghidra, symbol và native evidence

Chọn một owner: GUI hoặc headless. Lưu/đóng project GUI trước khi mở write session;
không chạy cạnh tranh hai đường trên cùng project.

```cmd
retk session start MyGame
retk function list MyGame --query Board --limit 20
retk decompile MyGame 0x123456 --json
retk session stop MyGame
```

Địa chỉ trên là ví dụ; dùng địa chỉ thật từ query. Apply symbol thủ công:

```cmd
retk session start MyGame --write
retk symbols plan MyGame --address-mode rva
retk symbols apply MyGame --plan "<saved-plan-path>"
retk session stop MyGame
retk open MyGame
```

Xem plan/conflict/coverage trước khi apply. Write có backup/transaction;
`USER_DEFINED` giữ theo policy. Partial coverage chưa xác nhận toàn bộ symbol.
MCP typed job yêu cầu đúng plan/hash/operation ID. Xem [bridge](docs/ghidra-bridge.md).

Đường GUI: mở đúng Program, hoàn thành Auto Analysis, áp script Il2CppDumper nếu
dùng quy trình thủ công, enable GhidraMCP và Start MCP Server rồi kết nối Agent.
`retk doctor MyGame --task mcp --probe --json` kiểm tra discovery; không tự chọn
Program. [Python/MCP](docs/python-runtime.md) và
[toolchain lock](docs/toolchain-and-release.md) mô tả profile cài nâng cao.

## 10. Cấu hình Jev và bàn giao

Trong **Cài đặt → Jev**, lưu model và tên biến môi trường, mặc định
`TYPESAFE_API_KEY`. Key nhập trong GUI chỉ giữ cho phiên hiện tại;
`config/jev.json` không chứa key và bị loại khỏi Git. **Kiểm tra kết nối** gửi
một câu hỏi tổng hợp nhỏ, không gửi nội dung game.

Key GUI nằm trong bộ nhớ riêng của Settings, chỉ cấp cho thao tác Jev; terminal
Agent và job khác không nhận namespace `TYPESAFE_`/`JEV_`. Sau cập nhật cần mở lại
GUI/Agent để áp dụng cho tiến trình mới. Cấu hình qua CMD:

```cmd
retk jev-settings save --request config/jev.example.json
set TYPESAFE_API_KEY=<your-key>
retk jev-settings test --json
```

Tạo handoff nội dung đã chọn, xem request trước khi gọi dịch vụ:

```cmd
retk handoff create MyGame --out exports/MyGame.zip
retk handoff verify exports/MyGame.zip
retk jev request exports/MyGame.zip --questions config/jev-questions.example.json --out exports/request.json
retk jev run exports/request.json --out exports/result.json
```

Mặc định không kèm toàn bộ binary/asset. Native evidence cần capture rồi chọn thêm
bằng `--evidence`; so sánh build dùng `--against`. Jev không bắt buộc cho Agent/MCP.
Xem [settings](docs/jev-settings.md), [handoff](docs/diagnostics-and-jev.md) và
[schema](docs/handoff-schema.md).

## Dữ liệu, chuyển máy và lỗi thường gặp

Workspace nằm tại `workspaces/<Game>/`, gồm `project.re.json` và các thư mục số.
Task ledger, job, plan, backup, receipt và evidence nằm dưới `04_Notes`.
Không xóa chúng khi sửa gate. Workspace, cache/runtime, exports và ZIP thư viện
local không phải thành phần source cần push lên Git.

```cmd
retk path MyGame
retk status MyGame --json
retk export MyGame
retk import "D:\Transfers\MyGame.re" MyGameCopy
```

`.re` là archive workspace; `handoff` là gói evidence đã chọn. Import vào tên có
sẵn cần `--force` và tạo backup. Đổi binary cần xem lại downstream/reimport;
không giữ evidence cũ như hiện hành.

| Triệu chứng | Cách xử lý |
|---|---|
| CMD không thấy `retk`/mở bản cũ | Mở CMD mới, xem `where retk`, dùng shim trong báo cáo; kiểm tra PATH/npm prefix |
| GUI không hiện hoặc giao diện cũ | Xem checkout qua `where retk`; cài `npm run gui:install` nếu thiếu Electron rồi mở lại `retk gui` |
| Workspace is busy | Xem owner/job/log, chờ đúng job; không xóa lock hoặc chạy lại write |
| Job `unknown`/`cleanup_pending` | Kiểm tra receipt, lease và child gốc trước khi retry mutation |
| Compile pass nhưng validation partial | Xem pending/traversal; resume checkpoint hợp lệ hoặc tạo mới khi helper/source đổi |
| Policy có `.asset` bị từ chối | Nạp MCP/GUI mới rồi validation mới, giữ nguyên scope |
| Agent nói “Next…” rồi đứng | Active `jobs_wait` hoặc watcher Codex đã sẵn sàng; kiểm tra đúng thread/delivery |
| Claude nhận chuỗi prompt làm MCP config | Đóng phiên lỗi, mở GUI/Agent mới để nạp launcher mới |
| Thiếu RAM Ghidra | Xem diagnostics/heap/RAM trống; preparation chọn heap theo RAM, tôn trọng cấu hình tường minh |

## Phát triển và kiểm thử

```cmd
npm test
node re.js --help
```

Suite Node dùng fixture/workspace tạm. Helper C# có fixture API Unity; không thay
nghiệm thu trong Editor thật. Hai test ZIP DOTween local được bỏ qua nếu chưa có
archive; các test descriptor/catalog bằng fixture vẫn chạy. Các lệnh `test:ghidra`, `test:mcp`,
`test:unity-validation`, `test:desktop` và acceptance script có prerequisite/phạm
vi riêng; đọc tài liệu tương ứng trước khi chạy. `npm run test:legacy` dành cho
adapter PowerShell cũ.

GUI chính là Electron/Node. `re.ps1`, WinForms và [Tutorial.md](Tutorial.md) được
giữ cho tương thích; ví dụ PowerShell cũ không phải luồng khuyến nghị.
