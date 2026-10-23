# Khôi phục source: thân hàm, constructor và binding lớn

Body-mode giữ nguyên mọi declaration và chỉ thay executable body đã tồn tại.
Vì thế nó không thể tự thêm `.cctor`/`.ctor` bị AssetRipper bỏ khỏi source. Đây
là giới hạn đúng của body-mode; không sửa bằng cách chuyển khởi tạo sang một
caller, property hoặc `Awake` không có bằng chứng về thời điểm gọi.

Đường `initialization` riêng dùng cùng plan/apply, journal, backup và receipt.
Nó cho phép thêm constructor còn thiếu vào đúng class đang có; toàn bộ source
còn lại, kể cả thân hàm hiện tại, phải giữ nguyên token. Không thêm field,
backing field, helper method, serialized declaration hoặc tùy tiện đổi initializer.

Request dùng full source mới và declaration delta tường minh:

```json
{
  "kind": "retoolkit-reconstruction-request",
  "schemaVersion": 1,
  "graphRevision": "<revision hiện tại>",
  "changes": [{
    "scriptId": "<ID source từ assets_scripts>",
    "mode": "initialization",
    "source": "<toàn bộ source với constructor được khôi phục>",
    "constructors": [{
      "fullName": "GlobalStream+GameFlow",
      "kind": "static",
      "evidenceId": "<fingerprint của native evidence envelope>"
    }]
  }]
}
```

`fullName` là metadata name từ parser, dùng `+` cho nested type. `kind` là
`static` hoặc `instance`; đường đầu tiên chỉ hỗ trợ instance constructor không
tham số của class không generic. Khôi phục constructor đã có dùng body-mode,
không đánh dấu nó là thiếu.
Evidence envelope gốc truyền trong `evidence` của `reconstruct_plan`; không đưa
pseudocode hoặc địa chỉ tự suy đoán vào declaration DTO làm bằng chứng.

Toolkit cần dump đã xác minh còn khớp build và native evidence đầy đủ, đúng
Program/build, đúng constructor metadata và địa chỉ `imageBase + RVA`. Plan lưu
proof, source baseline và declaration delta. Apply kiểm tra lại với dump hiện
tại, inventory, parser và bằng chứng; một hash do caller tự điền không thay
được phép kiểm tra này. C++ pseudocode vẫn là dữ liệu không đáng tin cậy: proof
xác lập nguồn tham chiếu và phạm vi thay đổi, không tự chứng minh C# tương đương.

Nếu Dumper ghi header assembly thành `Il2CppDumper.TypeDefinitionIndex`, toolkit
đọc image/type ranges từ chính metadata đã chọn, đối chiếu hash/size và toàn bộ
range. Bộ đọc hiện hỗ trợ layout v29/v31, kể cả image `__Generated` không có đuôi
DLL. Không xác định assembly bằng tên type hoặc một summary do caller tự dựng.
Layout khác chưa xác minh vẫn bị chặn ở đường proof này.

CLI dùng cùng request JSON qua `retk reconstruct plan Game --request <file>`; MCP dùng
`reconstruct_plan` rồi `reconstruct_apply` theo operation UUID. Với thao tác dài,
dùng typed `jobs_start` và giữ job ID. Sau cập nhật toolkit cần khám phá lại schema
MCP trong session mới và dùng graph/source revision hiện tại để tạo plan mới.
Không replay một apply đang chạy hoặc có kết quả chưa xác định.

## Script có nhiều component

SQLite kiểm tra đầy đủ script binding theo luồng, không đưa toàn bộ node/edge
của một script vào RAM. Kết quả trả count chính xác, digest và mẫu ID/lỗi có
giới hạn. Mẫu không phải toàn bộ danh sách component; không suy luận phần bị
rút gọn là vắng mặt. Một lỗi GUID/fileID, cạnh script thiếu/trùng/sai đích, hoặc
binding chưa resolve ở cuối tập dữ liệu vẫn phải chặn source plan/apply.

Đường script giữ đủ file/source inventory và kiểm tra lại database đã seal ở
mỗi query/plan/apply. Summary do caller tự dựng không có giá trị xác minh.
Giới hạn materialization cho graph/tree khác được giữ nguyên; không cần nâng
20.000 node hoặc dùng một graph con để lách thiếu coverage.

## Giới hạn gameplay và thư viện

Khôi phục event constructor chỉ tạo/cấp phát field; nếu `Subject.Emit` hoặc
`Subscribe` trong DLL là stub, event vẫn không hoạt động. Tương tự, compile pass
không biến tween trả null, save getter trả null, Button/TMP rỗng thành runtime
thật. Cần implementation phù hợp và một migration riêng kiểm tra API/assembly,
GUID/local fileID, serialized data, collision, rollback và Editor observations.

Với trường hợp GoodSort đã báo, bằng chứng local ghi nhận DOTween 1.2.765 còn
snapshot chung từ YarnFever là 1.2.335. Không coi AssemblyVersion 1.0.0.0 hoặc
cùng namespace là tương thích. ZeroX Rx/save cần source/DLL phù hợp hoặc một
nhánh khôi phục native riêng. uGUI/TMP có trong Editor không tự cho phép xóa DLL
stub hay import đè mà bỏ qua binding migration.

Source integrity, biên dịch Unity, phạm vi binding và gameplay được báo độc lập.
Hai khả năng source/binding này không tự tạo ra một game chơi được.
