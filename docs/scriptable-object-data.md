# Recover dữ liệu ScriptableObject

Source C#, dữ liệu `.asset`, binding và logic khởi tạo có kết quả riêng.
`data.capture` lưu baseline; `data.verify` dùng đúng Unity Editor trên staging
để đối chiếu schema, giá trị và reference. Không save asset hoặc vào Play Mode.
Import/OnEnable/deserialization vẫn có thể chạy khi Editor nạp staging.

## Sử dụng

Tìm các bảng/level/config bằng assets.list/get/tree; dùng assets.refs để truy
script và nơi sử dụng. Đuôi `.asset` không tự chứng minh kiểu ScriptableObject;
kiểu thật được quan sát khi Unity load. Chọn chính xác 1–64 ID có `.meta`/GUID.

Tạo `scope.json` (thay ID ví dụ bằng ID thật toolkit trả về):

```json
{"assetIds":["asset:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]}
```

```text
retk data capture Game --params-file scope.json --json
retk data report Game --operation <baselineId> --section objects --limit 20 --json
retk data report Game --operation <baselineId> --section properties --limit 30 --json
```

Lưu baselineId trước khi sửa. Recover source/runtime/binding bằng route hiện có,
giữ serialized declarations và identity. Sau batch đủ phụ thuộc để compile:

```text
retk data verify Game --baseline <baselineId> --json
retk data report Game --operation <verificationId> --section differences --limit 30 --json
```

Report có query/limit/cursor. Cursor gắn đúng operation/section/snapshot. Preview
field dài giữ byte count/hash và truncated; dữ liệu đầy đủ ở storedData. Float
có display dễ đọc cùng biểu diễn bit IEEE, giữ cả signed zero/NaN.

GUI nhóm Tái dựng có Lưu baseline ScriptableObject, Đối chiếu dữ liệu
ScriptableObject và Đọc dữ liệu và khác biệt. Evidence hiện coverage, field
khác biệt và trạng thái dữ liệu; Unity progress hiện khi job đang chạy.

## Agent và workflow

MCP: data_capture, data_verify, data_report. Với Editor operation dài, dùng
jobs_start operation data.capture/data.verify và chờ đúng job, giữ continuation
theo workflow; không replay timeout. Report summary là lịch sử, không tái xác
minh candidate hiện tại (freshness:not-rechecked).

Với shared artifact, gọi các operation trên qua recovery_run với artifactId và
revision hiện tại. Capture/verify fork generation; dùng revision vừa trả cho
bước sau. UUID baseline chỉ dùng trong cùng output branch/artifact.

Workflow có dimension data, yêu cầu baselineId và assetIds thật:

```json
{
  "id":"level-data", "label":"Bảo toàn Level_1", "dimension":"data",
  "baselineId":"11111111-1111-4111-8111-111111111111",
  "assetIds":["asset:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  "dependsOn":["source"]
}
```

Thay ID ví dụ trước khi tạo checklist. Thêm data.verify vào authorizedOperations,
và recovery.run khi dùng artifact. Capture không hoàn thành dimension data;
cần receipt verify mới, đúng scope và candidate còn current. Một job data.verify
cũng cung cấp compilation và binding đúng scope SO: checkpoint cùng job cho
các dimension tương ứng, tránh mở Unity thêm lần nữa. Scene/prefab ngoài scope
vẫn cần kiểm chứng riêng khi nhiệm vụ yêu cầu. Gameplay giữ tiêu chí riêng.

## Phạm vi kiểm chứng

- Inventory mọi object trong file đã chọn, gồm hidden subassets, GUID/fileID
  chuỗi 64-bit, compiled type/assembly. Non-SO subasset chỉ có identity coverage.
- Serialized property SO: path/type, scalar, enum names, array/list size và từng
  index, nested field, object reference, managed-reference identity/type và
  nội dung duyệt được. Không tự mở rộng sang asset ngoài scope.
- Float/double/vector/color/bounds/quaternion giữ bit; vector int giữ đủ int32.
  Reference không bị đổi thành Number JavaScript.
- Object/field thêm/mất, type/value/reference đổi đều có khác biệt. Tổng count
  xét toàn bộ dữ liệu; lưu tối đa 1000 ví dụ với differencesTruncated khi còn nữa.

schemaCompatible chỉ nói serialized schema đã quan sát khớp baseline.
dataPreserved yêu cầu coverage đầy đủ, script identity và scoped binding hợp lệ,
không có khác biệt. Chúng không chứng minh export ban đầu đúng với game gốc.

## Baseline thô và trường hợp bị chặn

Capture sao chép đúng `.asset`/`.meta` trước Editor, kiểm tra hash/size và giữ
raw snapshot. Thiếu đúng Editor/compile/coverage vẫn giữ raw bytes với state
blocked/partial, dataCaptureComplete false; chưa dùng để xác nhận typed data.
Chữa dependency/compile trước, giữ snapshot cũ. Khi cần baseline mới, đối chiếu
raw gốc và ghi lý do; không đổi baseline để che khác biệt.

Receipt, raw snapshot, request hoặc observation bị đổi làm provenance không hợp
lệ. Build/helper/source đổi có thể làm evidence stale. Không sửa receipt hoặc
ghi đè baseline. Dữ liệu lưu dưới 04_Notes/assets/data-contracts/<UUID> hoặc asset
scope của recovery artifact. Workflow acceptance kiểm tra lại candidate và các
validation artifact, không chỉ đọc cờ từ kết quả job.

### Qualification cho baseline đã giữ đủ typed data

Một baseline có thể `partial` do định danh source ngoài phạm vi dữ liệu chưa
được xác minh, dù mọi SO/property đã được quan sát đầy đủ. Dùng route rõ ràng:

```powershell
retk data qualify MyGame --baseline <baselineId> --json
retk data verify MyGame --baseline <baselineId> --json
```

Với recovery artifact, chạy `data.qualify` và `data.verify` qua `recovery.run`
trên đúng artifact/revision. Qualification không chạy Editor, không fork project
hay thay baseline. Nó kiểm tra lại raw `.asset/.meta`, receipt/request/observation
gốc, helper gốc, compile/process đã đóng, coverage và script identity của từng SO.
Kết quả được lưu riêng bên cạnh baseline; receipt `partial` và toàn bộ giá trị
gốc giữ nguyên. Verify vẫn dùng ID baseline cũ và so dữ liệu hiện tại với chính
snapshot gốc, đồng thời ghi ID/hash qualification đã sử dụng.

Coverage thực sự thiếu, property unsupported, missing script/reference, helper
không khớp hoặc bằng chứng đã đổi vẫn bị từ chối. Qualification chỉ chứng minh
baseline đủ cho đối chiếu data đã chọn; không xác nhận source identity toàn
project, binding ngoài phạm vi hay gameplay. Không dùng capture trên candidate
đã sửa để thay thế baseline ban đầu.

## Giới hạn

### ObjectReference và packet Editor đã lưu

Collector `scriptable-data-v2` coi ObjectReference là một giá trị nguyên tử:
GUID và local fileID bền vững. Nó không đi vào các trường con biểu diễn con trỏ
như `m_Script.m_FileID`. Đây không phải field `fileID` trong YAML của game.
Field người dùng tên `m_FileID` trong struct/list/managed reference vẫn được đọc
và so sánh bình thường. GUID, local fileID, type hoặc reference bị thay thật vẫn
là khác biệt. Xem [Unity GUID/local fileID](https://docs.unity3d.com/ja/current/ScriptReference/AssetDatabase.TryGetGUIDAndLocalFileIdentifier.html)
và [quy tắc Next](https://docs.unity3d.com/cn/current/ScriptReference/SerializedProperty.Next.html).

Packet v1 cũ vẫn được giữ nguyên và đọc theo phép so sánh đã ghi lúc tạo. Nếu
đã có một `data.verify` đầy đủ, Editor đã đóng và candidate/build/scope không
đổi, có thể đối chiếu lại bằng policy mới mà không mở Editor:

```powershell
retk data verify MyGame --baseline <baselineId> --reuse-verification <verifyId> --json
```

Với recovery artifact, dùng `recovery.run` operation `data.verify`, params gồm
`baselineId` và `reuseVerificationId`, trên revision hiện tại. Reanalysis không
fork hay đổi project revision. Nó tạo receipt mới, ghi policy/hash và tham chiếu
packet gốc; không sửa giá trị, baseline, qualification cũ hay kết quả khác biệt
lịch sử. Workflow vẫn dùng operation `data.verify` và baseline ID ban đầu.

Chỉ helper/encoding đã nhận diện và có hash hợp lệ được chuẩn hóa. Phép chiếu
loại các descendant đã được ghi dưới một ObjectReference có persistent identity;
`referenceNormalization` công bố số record bị loại ở hai phía. Không có parent
reference, hoặc field đó là dữ liệu người dùng, thì không loại theo tên. Coverage
unsupported vẫn không thể trở thành pass. Packet không đầy đủ, đã sửa, khác
candidate/scope hoặc đã là một reanalysis sẽ bị từ chối dùng lại.

### Các loại dữ liệu khác

Curve/gradient/ExposedReference/kiểu chưa biết, giá trị quá lớn hoặc thiếu
persistent identity để unsupported/partial. Capture giới hạn 100000 property và
ngân sách dữ liệu; phần bỏ qua không được coi là đã kiểm tra. Cần run mới, không
resume checkpoint data capture; reference-only validation vẫn resume như cũ.

Đọc nested/managed data không mở rộng migration. Rename/rebind có chủ đích hiện
vẫn trả khác biệt; chưa tự chuẩn hóa field/GUID giữa schema. Source route giữ
các gate cũ, không tạo `.meta` giả hay tự thêm class/member không được hỗ trợ.
OnEnable, cache/lookup runtime, progression và gameplay cần bằng chứng hành vi
riêng; runtimeInitialized/gameplay luôn unverified trong kết quả data contract.
