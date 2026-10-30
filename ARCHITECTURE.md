# SDK contract checking

The checker copies the installed dependency layout, changes only the selected SDK,
and runs the consumer TypeScript API read-only with structured diagnostics.

Two project shapes receive `unsupported_project_shape`:

- Project references are refused before Program creation because stale referenced
  declarations can hide bound drift. Check each project separately or flatten refs.
- Multiple SDK copies are refused after Program creation with reason
  `multiple_sdk_copies`. Every loaded file uses its own nearest named package.json,
  including vendored, nested, linked and relative SDKs. Roots are realpath-normalized;
  a second SDK root or an SDK-specifier target outside the selected root requires
  deduping to one `@unbrained/pm-cli`. Unnamed format metadata does not hide ownership.

There is no outer-package identity inheritance or relative-package identity heuristic.
Sources, config, caches and installed names are preserved. Future reference support
must regenerate declarations per bound (`pm-ts-starter-project-references`).
