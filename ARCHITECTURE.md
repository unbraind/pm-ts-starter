# SDK contract checking

The checker copies the installed dependency layout and changes only the selected
SDK. The consumer’s own TypeScript API supplies structured diagnostics and cached
resolver identities. Compilation is read-only, isolated and fresh for every bound.

Project references receive `unsupported_project_shape` before Program creation.
The refusal names both configs and recommends checking each referenced project
separately as its own root or flattening references. Reusing declarations built
against another SDK can hide drift; treating referenced roots as package identities
can bypass isolation. Reference traversal and referenced-root exemptions are absent.
Standalone composite roots consume no referenced outputs and remain checked directly.
Future support must regenerate declarations per bound and preserve package identity;
tracked by `pm-ts-starter-project-references`, linked to `pm-ts-starter-min-sdk-drift`.
