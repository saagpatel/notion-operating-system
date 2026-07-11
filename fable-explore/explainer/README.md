# One Writer, No Lies — standalone explainer

This directory contains the standalone DOM/CSS explainer for the shared deterministic simulation core and all six storyboard acts.

Compile the hand-written TypeScript from inside this directory with the repository's local TypeScript:

```sh
cd /Users/d/Projects/Notion/fable-explore/explainer && npx tsc
```

That command reproduces `dist/explainer.js`. Run `node check.mjs` afterward to exercise one reducer scenario per act headlessly.
