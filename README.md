# hello-canvas

A public example notebook for Hypercanvas, intended to become the source for the bundled demo notebook.

## Contents

- `canvas/`: Storyboard Demo and Component Showcase canvases.
- `prototypes/`: Loopline Signup and Silo Dashboard, including their flow data and metadata.
- `components/`: Base UI examples, charts, navigation, and component stories.
- `templates/`: Application layout template.
- `assets/`: Canvas images and published terminal snapshots from the source notebook.

`hypercanvas.notebook.json` identifies the notebook and indexes its canvases and prototypes. `storyboard.canvas.json` maps its content directories.

## Source

Notebook artifacts were imported unchanged from [dfosco/storyboard-starter](https://github.com/dfosco/storyboard-starter/tree/66db28e90d778cede84e84d045752f757c3b0674) at commit `66db28e90d778cede84e84d045752f757c3b0674`. The imported `storyboard.config.json` uses this repository's identity rather than the starter's.

The starter's `.backstage` application, agent tooling, and GitHub deployment workflows are not included. This is a content import, not a completed runtime migration: legacy package imports, Tailwind setup, and historical canvas URLs still need compatibility work before the notebook is ready as a bundled demo. Publishing and bundle integration are not configured yet.
