export function validateStagedFiles(files: string[]): {
  ok: boolean;
  blocked: string[];
};

export function getStagedFiles(): string[];
