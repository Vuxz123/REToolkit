# REToolkit

REToolkit là một bộ script/toolkit portable cho Windows, dùng để chuẩn bị môi trường và chạy pipeline phân tích kỹ thuật game Unity IL2CPP. Toolkit tập trung vào workflow:

```text
Unity IL2CPP build
→ tìm native binary + global-metadata.dat
→ Il2CppDumper
→ dump.cs / DummyDll / ghidra.py
→ import binary vào Ghidra project
→ mở PyGhidra GUI
→ Auto Analysis + apply ghidra.py thủ công
→ đọc pseudo-code / xrefs / reconstruct C# tham khảo
```

> Chỉ dùng toolkit cho game/build mà bạn có quyền nghiên cứu. Không dùng để bypass DRM, anti-cheat, payment/IAP, license, hoặc phát tán source/assets không thuộc quyền sở hữu.

---

## Mục tiêu

REToolkit giúp gom các bước rời rạc của quá trình reverse engineering Unity IL2CPP thành một workflow dễ chạy hơn:

- Tạo workspace chuẩn cho từng game/project.
- Tự giải nén APK/XAPK/AAB/ZIP nếu cần.
- Tự scan `libil2cpp.so` / `GameAssembly.dll` và `global-metadata.dat`.
- Chạy Il2CppDumper để sinh `dump.cs`, `DummyDll`, `script.json`, `il2cpp.h`, `ghidra.py`.
- Import native binary vào Ghidra project bằng `analyzeHeadless -import -overwrite -noanalysis`.
- Mở PyGhidra GUI để người dùng tự chạy Auto Analysis và apply `ghidra.py`.
- Sinh note hỗ trợ agent/reconstruct như `candidates.md` và `agent-context.md`.

Flow mặc định hiện tại **không chạy headless analyze tự động** để tránh treo lâu, bridge lỗi hoặc lock project. Analysis nên được chạy trong Ghidra/PyGhidra GUI.

---

## Cấu trúc thư mục

Sau khi clone/copy toolkit, thư mục nên có dạng:

```text
REToolkit/
├── re.ps1
├── install-re-toolkit.ps1
├── tools/
│   ├── ghidra/
│   ├── ghidra-cli/
│   ├── Il2CppDumper/
│   ├── AssetRipper/
│   └── ghidra-mcp/
├── runtime/
│   ├── java/
│   │   └── jdk-21/
│   └── python/
├── workspaces/
├── workspace-template/
│   ├── 00_OriginalBuild/
│   ├── 01_Extracted/
│   ├── 02_Il2CppDumperOutput/
│   ├── 03_GhidraProject/
│   ├── 04_Notes/
│   └── 05_ReconstructedSource/
├── config/
└── prompts/
```

Mỗi project/game sẽ nằm trong:

```text
workspaces/<GameName>/
├── project.re.json
├── 00_OriginalBuild/
├── 01_Extracted/
├── 02_Il2CppDumperOutput/
├── 03_GhidraProject/
├── 04_Notes/
└── 05_ReconstructedSource/
```

---

## Yêu cầu môi trường

Toolkit ưu tiên Windows + PowerShell.

Khuyến nghị:

- Windows 10/11.
- Windows PowerShell 5.1 hoặc PowerShell 7.
- Ghidra bản mới, chạy bằng JDK 21.
- JDK 21 portable trong `runtime/java/jdk-21`.
- Python 3 cho PyGhidra/Ghidra MCP.
- .NET Desktop Runtime phù hợp với bản Il2CppDumper đang dùng.
- `uv` nếu dùng Ghidra MCP bridge.
- Rust/Cargo nếu muốn build/cài `ghidra-cli`.

Toolkit cố gắng dùng JDK 21 theo kiểu local/portable qua `JAVA_HOME_OVERRIDE`, không cần đổi `JAVA_HOME` global của máy.

---

## Cài đặt nhanh

Clone repo:

```powershell
git clone https://github.com/Vuxz123/REToolkit.git
cd REToolkit
```

Nếu PowerShell chặn script unsigned:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Unblock-File .\re.ps1
Unblock-File .\install-re-toolkit.ps1
```

Chạy kiểm tra trước:

```powershell
.\install-re-toolkit.ps1
.\re.ps1 doctor
```

Cài runtime portable:

```powershell
.\install-re-toolkit.ps1 -InstallRuntime
```

Cài các tool chính:

```powershell
.\install-re-toolkit.ps1 -InstallGhidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper
```

Cài tool phụ nếu cần:

```powershell
.\install-re-toolkit.ps1 -InstallGhidraCli
.\install-re-toolkit.ps1 -InstallAssetRipper
```

Kiểm tra lại:

```powershell
.\re.ps1 doctor
```

---

## Quick start

### Cách 1: Chạy full flow với file APK/XAPK/AAB/ZIP

```powershell
.\re.ps1 flow FoodHunt "D:\Builds\FoodHunt.apk"
```

Flow sẽ thực hiện:

```text
init/reuse workspace
→ extract build vào 01_Extracted
→ scan libil2cpp.so/GameAssembly.dll + global-metadata.dat
→ run Il2CppDumper
→ import binary vào Ghidra project, không analyze
→ generate notes
→ in path project
→ mở PyGhidra GUI
```

### Cách 2: Chạy full flow với thư mục đã giải nén

```powershell
.\re.ps1 flow FoodHunt "D:\Builds\FoodHunt_Extracted"
```

### Cách 3: Chạy từng bước

```powershell
.\re.ps1 init FoodHunt
.\re.ps1 scan FoodHunt "D:\Builds\FoodHunt_Extracted"
.\re.ps1 dump FoodHunt
.\re.ps1 import FoodHunt
.\re.ps1 open FoodHunt
```

Sau khi GUI mở lên, chọn project theo path mà toolkit đã in ra.

---

## Bước thủ công trong Ghidra/PyGhidra

Sau khi `flow` hoặc `open` mở PyGhidra GUI:

1. Mở Ghidra project trong `workspaces/<GameName>/03_GhidraProject`.
2. Mở program, thường là:
   - Android: `libil2cpp.so`
   - Windows: `GameAssembly.dll`
3. Cho Ghidra chạy Auto Analysis trong GUI.
4. Mở Script Manager và chạy `ghidra.py` từ:

```text
workspaces/<GameName>/02_Il2CppDumperOutput/ghidra.py
```

5. Dùng `dump.cs` hoặc `DummyDll` làm skeleton C# khi đọc decompiled code.
6. Dùng `04_Notes/candidates.md` để tìm class đáng chú ý như `GameManager`, `MainController`, `LevelManager`, `BoardController`, `AdsManager`, `IAPManager`, `RemoteConfig`, `Controller`, `Service`, `View`.

---

## Command chính của `re.ps1`

| Command | Ý nghĩa |
|---|---|
| `doctor` | Kiểm tra tool path, JDK, Ghidra, Il2CppDumper, ghidra-cli. |
| `init <GameName>` | Tạo workspace và `project.re.json`. |
| `add <GameName> <apk/xapk/aab/zip>` | Giải nén build vào `01_Extracted`, xử lý APK/OBB lồng nhau, rồi scan. |
| `scan <GameName> <ExtractedPath>` | Scan thư mục đã giải nén để tìm native binary và metadata. |
| `dump <GameName>` | Chạy Il2CppDumper. |
| `import <GameName>` | Import native binary vào Ghidra bằng `analyzeHeadless -import -overwrite -noanalysis`. |
| `flow <GameName> <apk-or-ExtractedPath>` | Chạy pipeline chính: add/scan → dump → import → notes → open PyGhidra. |
| `open <GameName>` | In path project và mở PyGhidra GUI. |
| `path <GameName>` | In project folder, file link và `.gpr` path để mở bằng GUI. |
| `status <GameName>` | Xem trạng thái `project.re.json`. |
| `notes <GameName>` | Sinh `candidates.md` + `agent-context.md`. |
| `candidates <GameName>` | Parse `dump.cs` và nhóm class đáng chú ý. |
| `context <GameName>` | Sinh context file cho AI agent. |
| `analyze <GameName>` | Optional/manual; chạy analysis ngoài flow. Không khuyến nghị nếu GUI đang mở project. |
| `symbols <GameName>` | Optional/manual; thử apply `ghidra.py` tự động. Nếu fail, chạy thủ công trong PyGhidra GUI. |

---

## Tool wrapper commands

| Command | Ý nghĩa |
|---|---|
| `ghidra-gui` | Mở Ghidra GUI thường bằng local JDK. |
| `pyghidra-gui` | Mở PyGhidra GUI bằng `support/pyghidraRun.bat`. |
| `ghidra-cli <args...>` | Gọi Rust Ghidra CLI trực tiếp. |
| `ghidra <args...>` | Alias của `ghidra-cli`. |
| `il2cppdumper <args...>` | Gọi Il2CppDumper raw. |
| `mcp` | Chạy Ghidra MCP bridge nếu có. |
| `install-skill` | In nội dung prompt hướng dẫn cài skill Ghidra CLI cho AI agent. |

Nếu PowerShell nuốt flag của CLI, dùng `--%`:

```powershell
.\re.ps1 ghidra-cli --% import --help
```

---

## Prompt cài skill Ghidra CLI cho AI agent

Repo có thư mục `prompts/`, trong đó file quan trọng hiện tại là:

```text
prompts/install-ghidra-skill.md
```

File này **không phải PowerShell script** và không chạy trực tiếp như `re.ps1`. Nó là một file prompt/instruction dành cho AI agent như Codex, Claude Code hoặc các client có hỗ trợ skill. Mục đích của nó là giúp agent hiểu cách điều khiển Ghidra CLI trong bộ REToolkit.

Nói ngắn gọn:

```text
re.ps1
= command runner thật của toolkit

install-re-toolkit.ps1
= installer/bootstrap để tải runtime và tool local

prompts/install-ghidra-skill.md
= hướng dẫn cho AI agent biết cách dùng ghidra-cli qua REToolkit
```

### Khi nào dùng file prompt này?

Dùng khi muốn AI agent hỗ trợ các tác vụ reverse engineering qua Ghidra CLI, ví dụ:

- liệt kê function trong binary đã import;
- decompile một function;
- tìm xrefs;
- query strings/symbols;
- chạy command `ghidra-cli` thông qua wrapper;
- đọc context từ `project.re.json`, `candidates.md`, `agent-context.md`;
- hỗ trợ reconstruct C# tham khảo từ pseudo-code.

### Cách xem prompt từ toolkit

```powershell
.\re.ps1 install-skill
```

Lệnh này **không tự cài skill vào Codex/Claude**. Nó chỉ in nội dung prompt ra terminal để người dùng copy sang agent hoặc dùng làm instruction khi cài skill.

### Cài skill thủ công cho agent

Nếu client không có nút cài skill tự động, có thể copy nội dung prompt hoặc upstream agent docs vào thư mục skill của agent.

Ví dụ với Codex:

```text
%USERPROFILE%\.codex\skills\ghidra-reverse-engineering-cli\SKILL.md
```

Ví dụ với Claude Code:

```text
%USERPROFILE%\.claude\skills\ghidra-reverse-engineering-cli\SKILL.md
```

Sau khi copy, restart agent để nó đọc lại skill.

### Agent nên gọi Ghidra CLI như thế nào?

Agent nên gọi Ghidra CLI qua wrapper của toolkit:

```powershell
.\re.ps1 ghidra-cli <args...>
```

Không nên gọi trực tiếp:

```powershell
ghidra.exe <args...>
```

Vì wrapper `re.ps1` đã xử lý các phần dễ sai như:

- dùng JDK 21 portable trong `runtime/java/jdk-21`;
- normalize path của toolkit;
- chạy trong context REToolkit;
- tránh phụ thuộc `JAVA_HOME` global của máy.

Ví dụ:

```powershell
.\re.ps1 ghidra-cli doctor
.\re.ps1 ghidra-cli --% function list --project FoodHunt --program libil2cpp.so
```

Với workflow có project state, nên ưu tiên command cấp cao của toolkit:

```powershell
.\re.ps1 status FoodHunt
.\re.ps1 path FoodHunt
.\re.ps1 open FoodHunt
```

`ghidra-cli` raw chỉ nên dùng cho query thủ công hoặc khi agent cần chạy subcommand đặc biệt.

### Lưu ý về flow hiện tại

Flow hiện tại của REToolkit là:

```text
init/reuse workspace
→ add/scan
→ dump bằng Il2CppDumper
→ import binary vào Ghidra project với -noanalysis
→ generate notes
→ in path project
→ mở PyGhidra GUI
```

Nó **không tự chạy headless analyze** và **không tự apply `ghidra.py`** trong flow mặc định. Auto Analysis và apply symbol nên được chạy thủ công trong PyGhidra GUI để tránh treo lâu, bridge lỗi hoặc lock project.

Nếu file prompt/skill cũ còn ghi rằng `flow` sẽ chạy:

```text
import → analyze → symbols
```

thì cần hiểu đó là mô tả cũ. Mô tả đúng hiện tại là:

```text
import -noanalysis → mở PyGhidra GUI → người dùng tự Auto Analysis + chạy ghidra.py
```

---

## Output quan trọng

Sau khi chạy `flow`, xem các file sau:

```text
workspaces/<GameName>/project.re.json
workspaces/<GameName>/02_Il2CppDumperOutput/dump.cs
workspaces/<GameName>/02_Il2CppDumperOutput/DummyDll/
workspaces/<GameName>/02_Il2CppDumperOutput/ghidra.py
workspaces/<GameName>/04_Notes/import.log
workspaces/<GameName>/04_Notes/candidates.md
workspaces/<GameName>/04_Notes/agent-context.md
```

---

## Lưu ý về Ghidra project lock

Ghidra project thường chỉ cho một process giữ lock tại một thời điểm. Nếu gặp lỗi:

```text
LockException: Unable to lock project
```

hãy đóng Ghidra GUI đang mở project đó rồi chạy lại lệnh CLI/headless.

Flow mặc định đã tránh chạy headless analyze để giảm rủi ro lock/treo. Tuy vậy, bước `import` vẫn cần ghi vào Ghidra project, nên cũng không nên mở GUI của cùng project khi đang import.

---

## Troubleshooting

### PowerShell báo script unsigned

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Unblock-File .\re.ps1
Unblock-File .\install-re-toolkit.ps1
```

### Không thấy Ghidra/PyGhidra mở lên

Test launcher trực tiếp:

```powershell
.\re.ps1 pyghidra-gui
```

Nếu lệnh này mở được GUI, dùng:

```powershell
.\re.ps1 path <GameName>
```

rồi mở project thủ công trong Ghidra bằng path được in ra.

### Ghidra CLI báo bridge lỗi

Các lệnh `summary`, `strings`, `functions`, `stats`, `analyze`, `symbols` có thể dùng `ghidra-cli` hoặc bridge. Nếu GUI đang mở project, project có thể bị lock. Đóng GUI hoặc dùng bridge/plugin đúng instance trước khi chạy CLI.

### Il2CppDumper báo `This file may be protected`

Đây là cảnh báo thường gặp với một số binary IL2CPP. Nếu Il2CppDumper vẫn in `Done!` và sinh `dump.cs`, `DummyDll`, `ghidra.py` thì pipeline vẫn có thể tiếp tục.

### Không tìm thấy `global-metadata.dat`

Kiểm tra build đã giải nén đúng chưa. Android IL2CPP thường có:

```text
assets/bin/Data/Managed/Metadata/global-metadata.dat
```

Windows IL2CPP thường có:

```text
<GameName>_Data/il2cpp_data/Metadata/global-metadata.dat
```

### Không tìm thấy native binary

Android IL2CPP thường có:

```text
lib/arm64-v8a/libil2cpp.so
lib/armeabi-v7a/libil2cpp.so
```

Windows IL2CPP thường có:

```text
GameAssembly.dll
```

Toolkit ưu tiên `arm64-v8a` nếu có cả `arm64-v8a` và `armeabi-v7a`.

---

## Gợi ý workflow reconstruct

1. Mở `dump.cs` để tìm class chính.
2. Search các keyword:

```text
MainController
GameManager
LevelManager
BoardController
AdsManager
IAPManager
RemoteConfig
Service
Controller
Presenter
View
```

3. Mở function tương ứng trong Ghidra.
4. Dùng Xrefs/Call Graph để trace flow.
5. Viết lại C# tham khảo từ pseudo-code.
6. Ghi rõ độ tin cậy: `High`, `Medium`, `Low`.

---

## Phạm vi và đạo đức sử dụng

REToolkit phục vụ học tập, phân tích kỹ thuật, đọc kiến trúc và reconstruct logic ở mức tham khảo. Không dùng toolkit cho mục đích phá bảo vệ, bypass thương mại, gian lận, hoặc phân phối lại tài sản/source không thuộc quyền sở hữu.
