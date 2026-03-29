declare module "../scripts/check-staged-files.mjs" {
  export function validateStagedFiles(files: string[]): {
    ok: boolean;
    blocked: string[];
  };

  export function getStagedFiles(): string[];
}
