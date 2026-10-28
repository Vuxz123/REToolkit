# Bounded native event accessor observations

`evidence capture --kind instructions` reads one explicit inclusive range from
the owned native session. The provider enforces a maximum range of 64 KiB and
rejects an end address splitting an instruction. It does not disassemble bytes,
create functions, alter flow, or follow a call to prove it cannot return.

```powershell
retk evidence capture Game --kind instructions --selector 0xSTART --end-address 0xEND --limit 1000 --json
```

The corresponding workspace MCP tool is `evidence_capture` with
`{kind:"instructions",selector:"0xSTART",endAddress:"0xEND",limit:1000}`.
Bare hex and qualified `ram:0x...` addresses are accepted. Capture binds the
selected build, exact Program, run and revision; retain the returned envelope
and its evidence fingerprint. A saved arbitrary disassembly JSON is not a
capture envelope. More results or missing instructions mean incomplete coverage.

The `event-storage` source route accepts either its existing whole decompile
observation or this narrower alternative:

- Exact authenticated raw EventDefinition, delegate field and CompilerGenerated
  accessor associations remain required.
- The instruction window starts at imageBase + verified accessor RVA and ends
  immediately before the next nonzero distinct RVA in the verified dump.
- All AArch64 instructions in that window must be present, ordered, contiguous
  and four bytes long; at most 4096 bytes, no cursor or omitted page.
- The proof records `controlFlowComplete:false`. The dump boundary defines an
  observation window only, not exclusive function ownership or a valid return
  boundary. Unknown exception/call dependencies remain explicit.

This allows structural restoration of existing compiler generated event storage
when an error helper prevents full function qualification. Independently review
field use and Combine/Remove/CompareExchange semantics before applying source.
The route still preserves all other declarations and bodies and runs the bundled
compiler storage fixture. Fresh exact-candidate Unity and behavior checks remain
required. Constructor initialization still requires its existing full native
decompile envelope; this change does not broaden that route.
