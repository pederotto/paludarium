---
description: Start a session cheaply - read only the master document's Start here tab and the live build, then begin the task
argument-hint: "[what to work on]"
---
Start this session with as few tokens as possible.

1. Read only the master document's Start here tab, in one call: Docs connector `read` with ref
   `{"object":"node","id":"02f6cee4-738b"}`, engine `prose`, container
   `{"kind":"project","id":"84818151-7698-4d92-b67d-4280866913ff"}`, payload `{"kind":"view"}`.
   Do not read the History tab, the boards' pages, the playbook or any other document now. When the task needs one,
   follow "The owner's documents" in CLAUDE.md (outline first, then one section).
2. Read the live build: `ArtifactData` `get`, url `https://claude.ai/artifact/UsHwHfZ5meb88MFqTADtPW`,
   collection `live`, doc_id `site`.
3. The task: $ARGUMENTS
   If a task is given, start it. If not, reply in at most 5 lines: what is live, the handoff's next items, what waits
   for the owner, and ask what to work on.
