import {
	buildWeeklyStepContract,
	type WeeklyRefreshStepContract,
	type WeeklyRefreshStepStatus,
} from "./weekly-refresh-contract.js";

export interface ProjectMarkdownRefreshContractInput {
	live: boolean;
	blockedMarkdownProjectPages: number;
	writableMarkdownProjectPagesWouldChange: number;
	portfolioSectionWouldChange: boolean;
	summaryCounts: Record<string, number>;
	warnings: string[];
	status?: WeeklyRefreshStepStatus;
}

export function buildProjectMarkdownRefreshContract(
	input: ProjectMarkdownRefreshContractInput,
): WeeklyRefreshStepContract {
	const hasNewBlockedMarkdown = input.blockedMarkdownProjectPages > 0;
	const hasWritableMarkdownDrift =
		input.writableMarkdownProjectPagesWouldChange > 0;

	return buildWeeklyStepContract({
		live: input.live,
		status: input.status ?? (hasNewBlockedMarkdown ? "partial" : undefined),
		wouldChange:
			hasNewBlockedMarkdown ||
			hasWritableMarkdownDrift ||
			input.portfolioSectionWouldChange,
		summaryCounts: input.summaryCounts,
		warnings: input.warnings,
	});
}
