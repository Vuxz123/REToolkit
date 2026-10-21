# Nhận diện và import thư viện Unity từ kho ZIP cục bộ

Ngày: 2026-10-23. Trạng thái: thiết kế, chưa triển khai catalog/importer.
Người dùng muốn Agent nhận diện thư viện thông dụng và có thể import khi cần.
Hiện chưa có thư mục ZIP. Cấu hình mặc định `libraryRoots: []`; Agent không cần
đường dẫn giả và các chức năng REToolkit đang có vẫn hoạt động.

## Hướng chọn

Chọn catalog có bằng chứng + resolver dependency + import trên staging. So với
nhận diện bằng tên ZIP, hướng này phân biệt được phiên bản và gói chứa nhiều thư
viện. So với import thử mọi ZIP, nó giới hạn thay đổi vào dependency có nhu cầu
và đưa ra lý do chọn/bỏ từng gói. Kiến thức tên thư viện chỉ gợi ý tìm kiếm.

Đây là phần bổ sung cho thiết kế UI/asset: shader, font, tween, input, UI và các
dependency khác có thể cần thư viện trước khi audit/compare cho kết quả có nghĩa.
Import thành công là một bước; compile, binding, UI và hành vi vẫn kiểm riêng.

## Cấu hình và dữ liệu

Hỗ trợ nhiều thư mục do người dùng khai báo. Quét đệ quy có giới hạn, chỉ đọc
nguồn; không tự tìm khắp ổ đĩa hoặc tự tải một gói trên mạng để thay thế.

```json
{
  "libraryRoots": [],
  "libraryImportPolicy": "auto-staging-on-unique-match"
}
```

Một archive được định danh bằng SHA256+size, giữ nguyên đường dẫn nguồn và bằng
chứng metadata. Tên file có thể đổi mà nội dung vẫn được nhận ra; hai ZIP khác
hash không được coi là cùng bản chỉ vì cùng tên/phiên bản.

Catalog ghi cho từng package root bên trong ZIP:

- Package ID/tên, nhà cung cấp và phiên bản nếu có bằng chứng; metadata không rõ
  được giữ unknown, không tự đặt version hoặc khẳng định nguồn phát hành.
- Loại payload: UPM, Assets tree, `.unitypackage`, managed DLL, native plugin,
  hoặc mixed/unsupported. Một ZIP wrapper không mặc định là một UPM package.
- Assembly identity, namespaces, public type/API signatures có thể đọc tĩnh,
  `.asmdef`/references, scripting defines và dependency bắt buộc/tùy chọn.
- Unity/package compatibility được khai báo, platform/ABI, render pipeline,
  Mono/IL2CPP nếu có bằng chứng, đường dẫn plugin và importer settings.
- `.meta`/GUID inventory, source roots, tài liệu/changelog/API usage và hướng dẫn
  setup tìm thấy trong gói; hướng dẫn là dữ liệu tham khảo, không phải lệnh để chạy.
- Trạng thái nhận diện, nguồn bằng chứng, mâu thuẫn và giới hạn phân tích.

Đọc metadata DLL bằng parser tĩnh, không load/execute assembly chỉ để nhận diện.
AssemblyVersion đơn lẻ có thể không đủ xác định release của thư viện. Hash chứng
minh nội dung được chọn, không tự xác thực publisher hoặc chất lượng gói.

## Agent cần biết gì về thư viện

Mỗi thư viện có một descriptor/versioned knowledge record: tên và aliases, package
IDs/assembly identities, loại thành phần nó cung cấp, namespace/type/API signatures,
dependency, yêu cầu setup, dấu hiệu đã tích hợp, và kiểm tra cần chạy sau import.

Ví dụ nhóm hỗ trợ nhận diện gồm tweening, TMP/font, virtual camera, input, rendering,
serialization, async utilities, animation và UI toolkit bên thứ ba. Tên quen thuộc
như DOTween, UniTask hoặc Newtonsoft chỉ tạo candidate; không khẳng định phiên bản
hoặc tương thích từ tên. Descriptor phải đối chiếu nội dung ZIP thực tế.

Tách riêng **biết thư viện là gì**, **đã có gói cục bộ**, **gói phù hợp project**,
**đã import**, **đã tích hợp và kiểm chứng**. Agent có thể nhận ra một dependency
đang thiếu nhưng chưa có ZIP để cung cấp nó.

## Nhận diện trong project và chọn gói

Kết hợp package manifest/lock, DLL metadata, `.asmdef` references, type signatures,
component identity, serialized fields và lỗi compile. Namespace hoặc một lỗi
`CS0246` đơn lẻ chỉ là gợi ý; nguyên nhân có thể là define, assembly reference,
platform filter hoặc API khác phiên bản, không nhất thiết thiếu thư viện.

Trước khi thêm gói, phân loại thư viện hiện có: implementation, exported stub,
partial/modified, missing hoặc ambiguous. Giữ game-specific wrappers và bindings.
Không copy chồng thư viện chuẩn lên toàn bộ thư mục Scripts.

Resolver xây dependency graph và kiểm tra toàn bộ closure: phiên bản, API cần
dùng, Editor/platform/pipeline, optional module và xung đột. Không mặc định chọn
bản mới nhất. Dependency thiếu gói cục bộ được báo thiếu; không lặng lẽ dùng mạng.

Kết quả nhận diện: confirmed, candidate, unknown hoặc conflict, kèm lý do.
Candidate/unknown/conflict không được tự import. Metadata xác nhận nhận diện cũng
không chứng minh binary compatibility; điều đó cần kiểm chứng trong Unity.

## Quy tắc tự import đã được cho phép

Agent có thể tự tạo plan và import trên staging khi đồng thời thỏa:

1. Có nhu cầu cụ thể từ project/rule và nguồn evidence còn đúng revision.
2. Có một lựa chọn duy nhất được xác nhận bằng descriptor/nội dung, phiên bản
   hoặc content pin được chọn rõ, và dependency closure đầy đủ.
3. Không có xung đột chưa giải quyết về GUID, full type, assembly, package ID,
   defines, importer settings hoặc asset cùng đích.
4. Thay đổi nằm trong project staging được quản lý, có plan và receipt truy nguyên.

Chính sách này sử dụng quyền import người dùng đã nêu; không hỏi lại cho từng
gói đáp ứng điều kiện. Nếu nhiều phiên bản không phân biệt được, cần người dùng
chọn/pin hoặc bổ sung bằng chứng, thay vì đoán.

Gói giống hệt inventory đã cài được coi là satisfied. Gói chứa cả source và DLL
của cùng implementation phải chọn một dạng phù hợp, không cài cả hai. Nếu project
đã có exported stub hoặc DummyDll cùng type/assembly, thay thế nó là một migration
plan riêng: kiểm tra serialized fields và MonoScript GUID/fileID; không tự xóa stub
để làm compile hết lỗi. Trường hợp chưa hỗ trợ migration được đánh dấu blocked.

Plan liệt kê package/dependency chính xác, archive hash, package root, destination,
file thêm/đổi/bỏ, GUID/type collisions, manifest/lock/define changes, nguồn evidence
và kiểm tra phải chạy. Cấu hình project/SDK bên ngoài không được tự suy ra từ gói.

## Import theo payload

| Payload | Cách xử lý dự kiến |
| --- | --- |
| ZIP chứa UPM `package.json` | Giải nén package root được xác định vào vùng quản lý trong project staging; đăng ký/resolve bằng Unity PackageManager Client API, lưu dependency resolution |
| ZIP chứa Assets tree | Copy đúng payload đã duyệt, giữ nguyên `.meta` và importer metadata; kiểm tra collision trước khi publish, Unity reimport sau đó |
| ZIP chứa `.unitypackage` | Kiểm tra payload/pathnames và tác động, import noninteractive bằng helper cố định; chờ event hoàn tất/thất bại, không suy thành công từ lời gọi ban đầu |
| Managed DLL/source plugin | Kiểm tra API/assembly/define, chọn một implementation và giữ plugin settings; chứng minh tích hợp bằng compile/binding checks |
| Native plugin | Kiểm tra platform/CPU/ABI và importer filters; import không đồng nghĩa native runtime đã hoạt động, cần platform smoke test riêng |
| Nhiều package roots/mixed payload không rõ | Lập các candidate và adapter phù hợp; chưa xác định được đích thì không import |

ZIP không được đổi đuôi thành `.tgz` để giả định UPM chấp nhận. Không chép toàn bộ
ZIP wrapper/repo vào Assets. Unity Client API quản lý resolution, không chèn tay
dependency tùy tiện vào manifest để giả thành đã cài.

UPM/import là bất đồng bộ: helper chờ kết quả qua Editor update/events và tự thoát
khi xong; runner này không áp dụng `-quit` sớm như helper validation đồng bộ.
Deadline/exception/domain reload phải có journal/job state; child close mới cho
phép giải phóng ownership. Không chạy shell/postinstall tùy ý từ README/ZIP.

Staging không phải OS sandbox; Editor/import code của gói có thể chạy. Nguồn ZIP
được giữ nguyên. Từ staging đã kiểm chứng, áp sang export cần apply transaction
riêng với backup/guard/rollback; quyền auto-import staging không tự cấp quyền ghi
đè project gốc hoặc thay SDK account/service settings.

## Tích hợp trạng thái và guard hiện có

Kho ZIP chưa cấu hình: catalog=unconfigured; project audit báo dependency_missing
hoặc unknown ở đúng scope. Không làm mọi tác vụ khác của REToolkit bị blocked.

Chuỗi trạng thái: indexed -> recognized -> resolved -> import_planned -> imported
-> compile_verified -> bindings_verified -> ui_verified. Mỗi trạng thái chỉ ghi
khi có evidence tương ứng; native/runtime/UI chưa chạy vẫn unverified.

Thêm `libraries.lock` cho workspace: content hashes, package roots, phiên bản/API
fingerprints, dependency closure, normalized managed paths, Unity/profile và
import receipt. Mọi managed local dependency phải nằm trong inventory và có thể
copy portable sang staging tiếp theo; không ghi absolute đường dẫn máy cá nhân
vào bản publish. Current local-package guard chỉ được mở cho đúng managed entries
được lock xác minh, không nới cho mọi `file:` hoặc package Git.

Import làm stale graph/map/validation/UI evidence phụ thuộc. Chạy lại theo thứ tự:
index -> compile -> script/asset binding -> UI rules -> render/input/visual đối
chiếu game gốc trong scope bị ảnh hưởng. Native/metadata gốc không được thay đổi.
Receipt có before/after inventory, changed files, resolver/import log, source
hashes và coverage; report có paging/byte caps như API hiện có.

## CLI/MCP dự kiến, chưa tồn tại

```text
node re.js libraries scan
node re.js libraries list
node re.js libraries identify <Game>
node re.js libraries plan <Game>
node re.js libraries import <Game> --operation <UUID>
node re.js libraries verify <Game> --operation <UUID>
```

MCP chỉ truy vấn catalog/descriptor, resolve requirement và áp plan UUID đã lưu.
Không có arbitrary URL, shell, output path, C# eval hoặc cài package ngoài roots
đã cấu hình. Agent đọc report để hiểu thư viện và lý do cần import.

## Triển khai và fixture trước khi có ZIP thật

1. Catalog/descriptor: ZIP fixture UPM, Assets, DLL metadata; tên ZIP gây hiểu nhầm,
   wrapper nhiều cấp, nhiều phiên bản, version unknown và mixed package roots.
2. Resolver/planner: requirement thỏa, gói thiếu, API không tương thích, defines sai,
   duplicate source/DLL, stub collision, transitive dependencies và ambiguous pins.
3. Import adapters: good/fail/timeout/reload, idempotency, giữ nguyên source ZIP,
   `.meta` và game-specific files; actual Unity fixture kiểm chứng resolution.
4. UI pipeline: thiếu dependency làm audit unknown/fail đúng lý do, import thành
   công chỉ nâng trạng thái sau compile/binding/UI checks tương ứng.

Reuse kiểm tra archive hiện có: traversal/absolute paths, junction/symlink, CRC,
case collision, duplicate GUID, metadata/entry/unpacked-byte caps và zip bomb.
Giới hạn đọc ZIP lồng theo adapter; không giải nén đệ quy không giới hạn.

Chưa có ZIP vendor được cung cấp nên không có nhận diện/compatibility/import thật
được công bố. Fixture chỉ chứng minh cơ chế, không chứng minh mọi thư viện thông dụng.

## Nguồn Unity đối chiếu

- [Package manifest metadata](https://docs.unity3d.com/2022.3/Documentation/Manual/upm-manifestPkg.html)
- [PackageManager.Client.Add](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/PackageManager.Client.Add.html)
- [Import completion event](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/AssetDatabase-importPackageCompleted.html)
