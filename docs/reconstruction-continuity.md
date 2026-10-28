# Phiên tái dựng gameplay

`workflow` giữ mục tiêu/checklist qua nhiều lượt agent và job. `recovery` quản lý
project/revision; `workflow` theo dõi việc còn phải làm trên candidate đó. Nó
không tự dịch ngược code hay cấp thêm quyền chạy game.

## Bắt đầu từ nhiệm vụ đã được giao

Agent đọc nhiệm vụ và ledger hiện có, rồi tạo DTO giống ví dụ dưới. Đường dẫn
source phải thay bằng file thật đã truy vấn. Thêm `artifactId` nếu dùng project
của `recovery.create`, cùng `recovery.run` và domain operation cần dùng trong
`authorizedOperations`. Không trộn export trực tiếp với artifact.

```json
{
  "goal": "Khôi phục vòng chơi đã thống nhất",
  "authorizedOperations": ["assets.index", "assets.scripts", "assets.source", "reconstruct.plan", "reconstruct.apply", "reconstruct.verify", "reconstruct.validate", "reconstruct.validation"],
  "steps": [
    {"id":"pool", "label":"Source pool", "dimension":"source", "sourcePaths":["Assets/Game/Pool.cs"], "dependsOn":[]},
    {"id":"compile", "label":"Biên dịch feature", "dimension":"compilation", "dependsOn":["pool"]},
    {"id":"play", "label":"Chơi một vòng", "dimension":"gameplay", "dependsOn":["compile"], "scenario":{"entry":"Level đầu tiên", "actions":["Bắt đầu", "Tương tác", "Hoàn thành level"], "expected":"Vòng chơi tương tác và chuyển trạng thái đúng"}}
  ]
}
```

```text
retk workflow create Game --params-file goal.json --json
retk workflow status Game --json
retk workflow next Game --run <runId> --json
```

Mọi step đều bắt buộc. Source step yêu cầu `sourcePaths` chính xác trong Assets,
tối đa 16 file `.cs` cho một batch. Binding step dùng `dimension:"bindings"`
và `assetIds` thật. Gameplay step luôn có entry/actions/expected. Dependency
không được thiếu ID hoặc tạo chu trình. Việc điều tra/native evidence nằm trong
progress/ledger hỗ trợ các bước này, không có dimension investigation riêng.

## Agent nhận việc và ghi tiến trình

Các MCP tool dùng tên `workflow_status`, `workflow_claim`, `workflow_next`,
`workflow_checkpoint`, `workflow_wait`, `workflow_heartbeat`, `workflow_release`,
`workflow_pause`, `workflow_resume`, `workflow_cancel`. CLI nhận cùng DTO qua
`--params-file` hoặc `--params '<JSON>'`.

1. `workflow_status {}` tìm phiên chưa xong duy nhất; nhiều phiên cần `runId`.
   Status không hash lại project, trả `freshness:"not-rechecked"`, và đọc được
   khi engine đang giữ khóa. `workflow_next {runId}` đối chiếu job/candidate;
   nó có cập nhật sequence, nên phải giữ giá trị vừa trả về.
   Ưu tiên dùng `nextStep` vừa trả từ checkpoint; không gọi next lặp lại chỉ để
   lấy cùng bước. Gọi next khi bắt đầu/resume hoặc cần đối chiếu trạng thái mới.
2. `workflow_claim {runId, sequence, harness, threadId}` nhận việc. Dùng đúng
   identity harness, đặc biệt `CODEX_THREAD_ID` cho Codex. Lưu
   `controller.claimId`. Hai agent không nhận cùng một phiên; không đoán thread.
3. `workflow_checkpoint {runId, sequence, claimId, stepId,
   outcome:"progress", note:"..."}` ghi tiến triển. Dùng `outcome:"blocked"`
   và blocker cụ thể cho bước bị chặn; tiếp tục bước độc lập. Note không xác minh
   source, compile hoặc gameplay. Không thu nhỏ checklist để kết thúc sớm.
4. Sau job terminal, dùng checkpoint với `outcome:"job", jobId`. Toolkit kiểm
   tra đúng request/result, operation đã cho phép, candidate và receipt hiện tại.
   Source chỉ xác minh các file đã khai báo; compile/binding dùng verifier Unity
   hiện có. Job thành công không tự hoàn tất task.
5. Heartbeat bằng `{runId, sequence, claimId}` sau tiến triển có ý nghĩa; release
   cùng DTO trước handoff. Heartbeat quá 120 giây báo liveness chưa rõ, không cho
   người khác chiếm claim. Chủ cũ có thể heartbeat lại. Chưa có tự chiếm claim.

```text
retk workflow checkpoint Game --params-file checkpoint.json --json
retk workflow pause Game --run <runId> --sequence <sequence> --json
retk workflow resume Game --run <runId> --sequence <sequence> --json
retk workflow cancel Game --run <runId> --sequence <sequence> --json
```

Pause/cancel ngăn bước tiếp theo và thông báo mới; không kill engine đã chạy.
Cancel không tự resume. Pause cần resume rõ ràng. Mất controller cần kiểm tra
harness/ownership trước khi hủy phiên cũ và tạo nhiệm vụ mới nếu cần; giữ lịch sử.

## Chờ job và nhận lại đúng phiên

Gọi `workflow_wait {runId, sequence, claimId, stepId, jobId}` trong claim:

- Codex lưu ý định đăng ký trước, tạo watcher `agent.wake_after` với task
  `continue-reconstruction`, rồi nhường claim. Kiểm tra
  `continuation.watcherJobId` bằng `jobs_get`/`jobs_wait`: cần watcher running,
  wakeProgress waiting và transportReady true, hoặc kết quả queued, trước khi
  kết thúc lượt. Nếu preflight thất bại, nhận lại claim đúng thread và giữ active
  wait hoặc báo blocker cụ thể.
- Queued chỉ nghĩa CLI nhận thông báo. Agent phải `workflow_claim` lại, checkpoint
  job thật và tiếp tục dependency chưa xong. Chỉ claim/heartbeat mới ghi nhận
  agent đang nhận việc; đây không phải bằng chứng gameplay thành công.
- Claude/Gemini/OpenCode chưa có adapter resume. Continuation báo unsupported và
  giữ claim; agent cần active `jobs_wait`. Không hứa sẽ tự tỉnh dậy.
- Đăng ký/dispatch mất phản hồi được giữ unknown để kiểm tra. Không đăng ký lại
  cùng producer, replay apply hoặc chuyển sang thread đoán được.

Harness đang mở cần mở lại từ GUI/reconnect MCP để lấy tool/context mới. Không
tạo đăng ký hồi tố từ một lời hứa cũ.

## Chi phí và GUI

Gom source theo cụm dependency có bằng chứng trong giới hạn 16 file mỗi plan.
Verify mỗi apply; chạy Unity khi feature đủ phụ thuộc để compile và trước khi
dùng nó làm nền cho bước sau. Không validate mỗi method nếu không có gate yêu
cầu; không lặp setup/index còn current. Giữ native work cùng phiên Ghidra khi
phù hợp, đóng đúng owner trước khi chạy Unity.

Job worker lưu `phaseMetrics`: số lần, thời gian, file và byte đã xử lý. Các nhãn
gồm input.verify, inventory.verify, source.parser, graph.refresh, unity.stage,
unity.execute, engine.execute và total. Recovery còn có snapshot.copy,
snapshot.verify, fork và stage.adopt. Pha cha/con chồng thời gian, không cộng tất
cả để tính tổng. Unity execute hiện gộp import/compile/traversal; số liệu không
phải profiler của mọi lần đọc đĩa. Job cũ không có số liệu hồi tố.

GUI nhóm Tái dựng có tạo/đọc phiên, bước kế tiếp và thao tác bằng DTO JSON.
Evidence hiện checklist/continuation và bảng thời gian; chưa có trang quản lý
workflow riêng. Durable job detail đọc metrics cả khi thất bại.

## Điều kiện kết thúc và giới hạn

Run có active, waiting-job, waiting-agent, needs-inspection, blocked, paused,
canceled hoặc completed. Input/candidate stale và job unknown cần kiểm tra,
không tự rebase/replay. Source đã xác minh chỉ giữ hiệu lực qua batch khác khi
các file source/meta đã chứng minh vẫn nguyên. Thay đổi inventory làm stale các
kiểm chứng compile/binding. `next` kiểm tra lại cả candidate đã completed;
status chỉ trình bày trạng thái đã ghi, không tái xác minh completion. Completion
cũ đã stale là lịch sử (`recordedState:completed`), không nhận lại quyền sở hữu
khi một phiên mới đang xử lý cùng candidate. Unknown job giữ `inspection` với
jobId/stepId/operation để tiếp tục điều tra đúng thao tác sau restart.

Chưa có gameplay runner phổ quát. Agent không thể đặt gameplay verified bằng
prose hoặc compile xanh. Gameplay vẫn unverified/blocked khi thiếu đường quan
sát. Manual report vẫn lưu vào ledger để review, chưa tự trở thành bằng chứng
completed trong state machine. Scope chỉ yêu cầu source có thể completed sau
receipt hợp lệ; scope yêu cầu gameplay giữ nguyên bước chưa xong.

Bản này chưa thêm cache hash bền vững hoặc Unity runner giữ Library giữa các
generation. Các tối ưu đó theo số liệu đo trên game thật; không bỏ content hash,
snapshot isolation hay engine ownership. Không tuyên bố speedup từ fixture.

Status giữ đủ checklist và reference receipt, lược danh sách hash file nội bộ
trong từng proof để không tạo response lớn. Record có giới hạn đọc/ghi thống nhất
16 MiB; vượt giới hạn sẽ từ chối trước khi ghi đè trạng thái cũ.
