# Hướng dẫn sử dụng REToolkit

Pipeline hỗ trợ phân tích Unity IL2CPP bằng Il2CppDumper, Ghidra và PyGhidra.

## Phạm vi

Chỉ dùng toolkit cho mục đích học tập, phân tích kỹ thuật hoặc build/game mà bạn có quyền nghiên cứu. Không dùng để bypass DRM, anti-cheat, payment/IAP, license hoặc phát tán source/assets không thuộc quyền sở hữu.

## Flow khuyến nghị

```powershell
cd C:\Users\DPC00176\REToolkit
Unblock-File .\re.ps1
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

.\re.ps1 doctor
.\re.ps1 pyghidra-gui
.\re.ps1 flow FoodHunt "D:\Path\To\FoodHunt.apk"
```

Flow hiện tại:

1. Tạo/reuse workspace.
2. Scan hoặc extract build.
3. Tìm `libil2cpp.so`/`GameAssembly.dll` và `global-metadata.dat`.
4. Chạy Il2CppDumper.
5. Import Ghidra project bằng `analyzeHeadless -import -overwrite -noanalysis`.
6. Tạo `candidates.md` và `agent-context.md`.
7. In path/link mở project.
8. Mở PyGhidra GUI.

Flow không chạy headless analyze và không tự apply symbol. Auto Analysis và `ghidra.py` làm thủ công trong GUI.

## Lệnh chính

```powershell
.\re.ps1 doctor
.\re.ps1 init <GameName>
.\re.ps1 add <GameName> <apk-or-xapk-or-aab-or-zip>
.\re.ps1 scan <GameName> <ExtractedPath>
.\re.ps1 dump <GameName>
.\re.ps1 import <GameName>
.\re.ps1 flow <GameName> <apk-or-ExtractedPath>
.\re.ps1 open <GameName>
.\re.ps1 path <GameName>
.\re.ps1 status <GameName>
.\re.ps1 candidates <GameName>
.\re.ps1 context <GameName>
.\re.ps1 notes <GameName>
.\re.ps1 pyghidra-gui
```

## Output quan trọng

- `project.re.json`: trạng thái project.
- `01_Extracted`: build đã giải nén.
- `02_Il2CppDumperOutput/dump.cs`: skeleton/search class.
- `02_Il2CppDumperOutput/DummyDll`: DLL giả.
- `02_Il2CppDumperOutput/ghidra.py`: script apply symbol.
- `03_GhidraProject`: Ghidra project.
- `04_Notes/candidates.md`: class gợi ý.
- `04_Notes/agent-context.md`: context cho agent/AI.

## Sau khi GUI mở

1. File > Open Project...
2. Chọn `workspaces/<GameName>/03_GhidraProject`.
3. Mở program `libil2cpp.so` hoặc `GameAssembly.dll`.
4. Chạy Auto Analysis trong GUI.
5. Chạy `ghidra.py` từ `02_Il2CppDumperOutput` nếu cần rename symbol.
6. Dùng `dump.cs`, `DummyDll`, `candidates.md` để trace và reconstruct.

## Lỗi thường gặp

- `re.ps1 is not digitally signed`: chạy `Unblock-File .\re.ps1` hoặc `Set-ExecutionPolicy -Scope Process Bypass -Force`.
- `Unable to lock project`: đóng Ghidra GUI/bridge đang mở project đó.
- `Bridge not responding to ping`: tránh dùng Ghidra CLI khi GUI đang lock project; flow hiện tại không dùng CLI import.
- PyGhidra không mở từ `open`: thử trực tiếp `.\re.ps1 pyghidra-gui`, sau đó mở project thủ công.
- Il2CppDumper báo `This file may be protected`: kiểm tra xem `dump.cs`/`DummyDll` có sinh ra không trước khi kết luận fail.
