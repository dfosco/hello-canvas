# hello-canvas

A public example notebook for Hypercanvas 0.30, intended to become the source for the bundled demo notebook.

## Contents

- `canvas/`: Storyboard Demo and Component Showcase canvases.
- `prototypes/`: Loopline Signup and Silo Dashboard, including their flow data and metadata.
- `components/`: Base UI examples, charts, navigation, and component stories.
- `templates/`: Application layout template.
- `assets/`: Canvas images and published terminal snapshots from the source notebook.
- `hypercanvas.notebook.json`: Notebook identity and page index.

`storyboard.canvas.json` maps its content directories. Open this folder with Hypercanvas 0.30 as a Notebook; the manifest includes both canvases and both prototypes.

## Source

Notebook artifacts originated in [dfosco/storyboard-starter](https://github.com/dfosco/storyboard-starter/tree/66db28e90d778cede84e84d045752f757c3b0674) at commit `66db28e90d778cede84e84d045752f757c3b0674`. Compatibility updates replace legacy `@dfosco/storyboard` imports with the 0.30 `@dfosco/hypercanvas` API, resolve notebook-local assets without the starter's `@content` alias, and provide notebook-owned Tailwind CSS. ChartSet stories use inline SVG; Silo Dashboard utilization charts use Recharts.

The starter's `.backstage` application, agent tooling, and GitHub deployment workflows are not included. The imported canvas prototype URLs and hash variants have been verified in the 0.30 runtime.

Hypercanvas 0.30 includes Notebook publishing, but this Notebook is not yet publish-ready: the current portable-site generator copies prototypes and assets, not `components/`, while Silo Dashboard imports `components/SiloChart` and `@primer/octicons-react`. A disposable generation check confirms the missing component copy; publishing support for Notebook component dependencies needs separate work. The bundled demo also remains the app-owned `fixtures/notebooks/demo-notebook` source configured by `packaging/hypercanvas-desktop/notebook-files.json`; this public repository has not been wired into that packaging flow.
