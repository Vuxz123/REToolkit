# Quy tắc nghiệm thu UI và asset Unity tái dựng

Ngày: 2026-10-20. Trạng thái: thiết kế để review, chưa triển khai checker.
Người dùng chọn đối chiếu **quy tắc kỹ thuật + ảnh/video game gốc**.
Tiếp nối AssetRipper bridge và kiểm chứng Unity trên staging. Chưa có bộ ảnh/video
game gốc được cung cấp cho công việc này; thiếu baseline phải được báo rõ.

## Kết quả cần chứng minh

Một asset đạt khi định danh và dữ liệu còn đúng, Unity tải được nó, nó thực hiện
đúng vai trò trong trạng thái được yêu cầu, và kết quả có bằng chứng tương ứng.
Compile thành công hoặc không có missing reference không đủ chứng minh UI đúng.

Ba cách tiếp cận được cân nhắc:

1. Chỉ kiểm tra cấu trúc: nhanh, phát hiện asset mất liên kết, không chứng minh hình ảnh.
2. Chỉ so ảnh: phát hiện sai giao diện, không chứng minh click/scroll hoặc logic.
3. Kết hợp cấu trúc, render, tương tác và ảnh/video gốc: chọn hướng này; mỗi lớp
   giữ kết luận và coverage độc lập để xác định chính xác phần chưa được kiểm tra.

## Hợp đồng của màn hình và asset

Mỗi screen/state có một hợp đồng phiên bản hóa. Hợp đồng ghi:

- Build gốc, graph revision của bản tái dựng, scene/prefab đầu vào, UI framework.
- Trạng thái khởi tạo, locale, dữ liệu cố định, thao tác để đến trạng thái cần chụp.
- Độ phân giải, hướng màn hình, safe area, platform, render pipeline, color space,
  Unity/package versions, input backend và khả năng GPU thực tế.
- Các thành phần bắt buộc: vai trò, asset GUID/local fileID ở bản export, locator
  trong runtime, vùng đối chiếu ảnh, nội dung chữ và trạng thái hiển thị/tương tác.
- Asset phụ thuộc: sprite/texture, font/fallback, material/shader, animation,
  âm thanh hoặc resource tải động nếu trạng thái này cần chúng.
- Các giá trị nullable có chủ đích, phần tử được ẩn, vùng scroll/virtualization,
  mask và trạng thái disabled hợp lệ.
- Danh sách rule bắt buộc, mức lỗi, sai số cho phép và bằng chứng phải thu thập.

Tên object hoặc tọa độ click đơn lẻ không phải định danh ổn định. Locator phải
resolve duy nhất; mơ hồ thì unknown. GUID/fileID game export không được suy ra từ
ảnh hoặc gán bằng PathID nguồn AssetRipper. Object tạo động dùng locator ngữ nghĩa
đã khai báo và phạm vi screen/state, không tạo GUID giả.

Không bắt buộc mọi reference đều khác null, mọi object luôn active, mọi Image đều
có sprite, mọi anchor ở [0,1], hoặc mọi phần tử đều ở trong viewport. Những điều
kiện đó chỉ áp dụng khi vai trò trong hợp đồng yêu cầu; UI có thể dùng màu phẳng,
offscreen animation, mirrored scale, scroll clipping và trạng thái ẩn hợp lệ.

## Sáu nhóm quy tắc

| Nhóm / mã | Điều kiện và bằng chứng | Kết luận khi vi phạm |
| --- | --- | --- |
| A — ASSET | A01: GUID/fileID và hash của nguồn khớp snapshot; A02: dependency bắt buộc tải được; A03: đúng loại asset/subasset, importer và serialized values theo hợp đồng | fail với missing dependency bắt buộc hoặc đổi định danh ngoài plan; asset tùy chọn có ngoại lệ ghi rõ |
| B — RENDER | B01: đúng Canvas/Panel/camera và pipeline; B02: shader/material sử dụng được trên renderer đích; B03: sprite/atlas/font/glyph cần thiết resolve và render được; B04: asset 3D/animation/audio thuộc screen có thể được kiểm tra bởi adapter phù hợp | fail khi có quan sát chứng minh hỏng; thiếu GPU/adapter/resource runtime thì unknown |
| C — LAYOUT | C01: geometry hữu hạn và layout đã ổn định; C02: phần tử phải nhìn thấy nằm trong vùng cho phép; C03: critical controls tôn trọng safe area; C04: không che/clipping/text overflow trái hợp đồng; C05: đúng trên từng profile kích thước/locale | fail trên profile cụ thể, không gộp kết quả một kích thước cho mọi thiết bị |
| D — INPUT | D01: EventSystem/input module hoặc panel event routing đúng framework; D02: raycast/picking đến đúng control; D03: button/toggle/scroll/drag/focus/keyboard hoạt động theo scenario; D04: modal chặn và trả tương tác đúng | kiểm tra tĩnh chỉ chứng minh cấu hình; chỉ pass hành vi sau thao tác và assertion quan sát được |
| E — VISUAL | E01: đúng màn hình/trạng thái game gốc; E02: bố cục, sprite, chữ, màu và lớp hiển thị khớp vùng baseline trong sai số; E03: mọi vùng UI quan trọng đều được so; E04: diff có ảnh và metric truy nguyên được | thiếu baseline hoặc khác profile mà chưa được quy đổi có kiểm chứng thì unknown |
| F — TEMPORAL | F01: video/state transition đúng thứ tự; F02: animation thực sự tiến frame và đến trạng thái cuối; F03: input có phản hồi trong khoảng thời gian hợp đồng; F04: không phát sinh lỗi mới trong scenario | ảnh tĩnh hoặc lời gọi callback trực tiếp không đủ pass chuyển trạng thái |

Với uGUI, visibility/input phải xét cả cha, CanvasGroup, clipping, camera và
raycast; chỉ đọc `activeSelf` hoặc `Button.interactable` là chưa đủ. Với TMP, kiểm
tra đúng chuỗi/locale và fallback; không sửa atlas/font để khiến audit tự pass.
UI Toolkit dùng adapter UIDocument/PanelSettings/UXML/USS và picking riêng.
Framework không nhận diện được hoặc custom UI chưa có adapter phải báo unknown.

Giá trị opacity, touch target, scale, wrapping và thứ tự lớp lấy từ hợp đồng/bản
gốc. Không tự áp một bộ tiêu chuẩn thiết kế mới làm thay đổi giao diện game gốc.

## Ảnh/video chuẩn

Baseline có manifest: hash file, nguồn thu, phiên bản/build game, screen/state,
profile thiết bị, locale, dữ liệu, frame hoặc timestamp, loại baseline và người
duyệt. Ảnh game gốc dùng kiểm chứng độ trung thực. Ảnh fixture hoặc ảnh bản export
chỉ dùng kiểm chứng regression, không được gọi là giống bản gốc.

Trước khi so: xác nhận đúng trạng thái, viewport, tỉ lệ, safe area và cấu hình màu.
Crop/registration phải khai báo và lưu phép biến đổi; không kéo méo ảnh để ép khớp.
Thiết bị khác profile cần baseline tương ứng hoặc đánh giá được duyệt riêng.

So sánh gồm geometry/vùng ngữ nghĩa và metric hình ảnh. Tolerance khai báo rõ cho
từng vùng/profile, hiệu chỉnh từ các lần chụp lại game gốc; không dùng một ngưỡng
pixel/SSIM chung để chứng minh mọi asset đúng. Vùng bắt buộc vẫn phải đủ thành
phần, đúng chữ/trạng thái, ngay cả khi metric toàn ảnh đạt.

Mask chỉ dành cho dữ liệu biến động đã biết, có lý do, phạm vi và ngân sách diện
tích được duyệt. Không mask toàn bộ nút, nội dung cần nghiệm thu hoặc toàn màn
hình. Hệ thống không tự mở rộng mask, giảm tiêu chuẩn hoặc cập nhật ảnh chuẩn.
Thay baseline/tolerance/mask tạo phiên bản và review mới, làm stale kết quả cũ.

Video được đánh dấu mốc input và state/frame cần so, có thông tin fps/timestamp.
So trạng thái đầu/cuối, thứ tự và thời lượng trong sai số hợp đồng; ảnh chụp một
frame không chứng minh animation chạy. Frame thiếu hoặc không xác định được đúng
trạng thái phải là unknown. Chuẩn bị seed/time/data khi kiểm soát được; biến động
không kiểm soát được cần được ghi thành giới hạn thay vì tự bỏ qua.

Jev hiện có có thể nhận evidence bundle và câu hỏi có kiểu để hỗ trợ nhận xét
sai lệch. Đánh giá AI là bằng chứng bổ sung; không thay thế rule/metric/quan sát
input và không tự cấp pass cho phần chưa đo được. Khả năng đọc ảnh/video của
adapter phải được xác minh trước, không mặc định từ API so sánh hiện tại.

## Trạng thái và quy tắc quyết định

Mỗi check có `pass`, `fail`, `unknown` hoặc `not_applicable`, kèm severity
`blocker`, `error`, `warning` hoặc `info`. Not-applicable cần lý do từ hợp đồng;
không dùng nó để che adapter thiếu hoặc trạng thái chưa chạy.

Thứ tự tính kết quả cho screen/state/profile:

1. Có blocker/error fail: fail.
2. Không có fail nhưng có rule bắt buộc unknown/chưa chạy: unknown.
3. Mọi rule bắt buộc đã pass hoặc có not-applicable hợp lệ: pass trong đúng scope.
4. Warning không biến mất khi tổng hợp; policy phát hành có thể yêu cầu xử lý.

Giữ các mặt độc lập: `assetIntegrity`, `render`, `layout`, `interaction`,
`visualFidelity`, `temporalBehavior`. Không tính trung bình điểm để một phần tốt
che lỗi nút không bấm được hoặc font thiếu glyph. Không có ảnh/video gốc thì
`visualFidelity=unknown`; không chạy interaction thì `interaction=unknown`.
Pass một menu không chứng minh toàn bộ gameplay tương đương.

Dependency thư viện được xử lý theo [thiết kế kho ZIP và import](2026-10-23-library-catalog-import-design.md).
Agent nhận diện implementation/stub và phiên bản trước khi tự import staging.
Import xong phải chạy lại các lớp compile/binding/UI bị ảnh hưởng; không nâng
`render` hay `interaction` thành pass chỉ vì package đã được cài.

Coverage luôn có số requested/observed/unknown/excluded theo asset, screen, state,
profile và rule. Không phát hiện UI trong dữ liệu thiếu không được coi là không có
UI. Scope rỗng cho not-applicable kèm inventory evidence, không trả pass rỗng.

## Báo cáo và bằng chứng cho AI

Mỗi finding có rule ID/version, outcome/severity, graph revision, asset/object ID,
screen/state/profile, expected/observed, artifact hashes, ảnh crop/diff hoặc mốc
video, lý do thiếu bằng chứng và hướng sửa đề xuất. Nội dung target là dữ liệu
không đáng tin, không được dùng làm lệnh thực thi.

Report ràng buộc build, source inventory, contract, baseline/mask/tolerance,
Editor/package/helper và renderer/GPU. Thay một trong các đầu vào đó làm stale
kết quả phụ thuộc. Lưu full evidence trên đĩa, trả summary và trang kết quả có
giới hạn byte; không nhét mọi screenshot/video vào một phản hồi MCP.

## Kiến trúc tích hợp dự kiến

JS quản lý contract/baseline, rule evaluation, provenance, paging và report.
Helper Unity cố định có adapter theo framework để thu facts. Tái dùng staging,
workspace/toolchain lease, exact Editor, timeout và recovery hiện có.

Audit cấu trúc chạy được headless. Render/capture cần runner có graphics thực tế;
phiên hiện tại dùng `-nographics` không được tự cấp visual pass. Capture chạy trên
owned staging process riêng, không điều khiển Editor đang mở của người dùng.

Audit mặc định chỉ đọc. Play Mode/input/video scenarios là giai đoạn chạy riêng
theo hợp đồng fixture được chọn, không tự bật bởi lệnh audit cấu trúc. Thao tác
được giới hạn vào input/state assertions khai báo; không có C# eval hoặc lời gọi
callback tùy ý từ AI. Kiểm tra một nút phải qua hit-test/input route và quan sát
kết quả, không chỉ `onClick.Invoke()`.

Không tự sửa, tái sinh `.meta`, thay sprite/font hoặc bật mọi object. Nếu muốn sửa,
tạo plan riêng có trước/sau, revision guard, backup/rollback rồi chạy lại các rule
bị ảnh hưởng. Kiểm chứng UI không làm thay đổi receipt compile/binding cũ.

CLI/MCP dự kiến, **chưa tồn tại**:

```text
node re.js assets audit <Game> --contract <json>
node re.js assets audit-report <Game> --operation <UUID> --section findings
node re.js assets capture <Game> --scenario <id> --profile <id>
node re.js assets compare <Game> --operation <UUID> --baseline <id>
```

## Thứ tự triển khai và nghiệm thu fixture

1. Contract/schema + audit asset/uGUI/TMP cơ bản, chỉ đọc; fixture tốt và từng lỗi
   missing sprite/font/material, hidden parent, wrong camera, null có chủ đích.
2. Layout đa profile + GPU capture + ảnh chuẩn fixture; thử overflow, safe area,
   clipping, overlay, font thiếu dấu và scale sai. Fixture baseline chưa chứng minh
   độ trung thực với game gốc.
3. Input/state/video: click bị lớp trong suốt chắn, button disabled có chủ đích,
   scroll/drag, modal đóng/mở, animation đứng frame, phản hồi sai trạng thái.
4. Nhập bộ ảnh/video gốc đã duyệt; map screen/state/profile, hiệu chỉnh tolerance,
   nghiệm thu vùng UI quan trọng và xuất evidence cho AI/Jev khi adapter hỗ trợ.

Fixture bổ sung phải thử thiếu GPU/baseline/package/adapter, không có UI trong
scope, đường dẫn `.CS/.UNITY/.PREFAB` mixed case, dữ liệu bị cắt, output quá lớn,
cursor lệch revision, nguồn thay đổi, runner chết và baseline/mask bị sửa.
Mỗi lỗi có ca âm chứng minh không false pass; mọi run giữ nguyên asset nguồn.

Phạm vi hiện tại là thiết kế. Chưa chạy bộ rule UI mới, chưa nhập baseline game
gốc và chưa có kết luận giao diện/asset của game thực tế đã đạt.

## Tài liệu Unity đã đối chiếu

- [CanvasGroup: opacity, interactable và raycast](https://docs.unity3d.com/es/2018.3/Manual/class-CanvasGroup.html)
- [CanvasScaler](https://docs.unity3d.com/Packages/com.unity.ugui@1.0/manual/script-CanvasScaler.html)
- [GraphicRaycaster](https://docs.unity3d.com/Packages/com.unity.ugui@1.0/manual/script-GraphicRaycaster.html)
- [Screen.safeArea](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Screen-safeArea.html)
- [TMP Font HasCharacters và fallback](https://docs.unity3d.com/ja/Packages/com.unity.textmeshpro@3.0/api/TMPro.TMP_FontAsset.HasCharacters.html)
