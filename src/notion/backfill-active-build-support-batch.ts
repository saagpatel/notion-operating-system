import "dotenv/config";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  datePropertyValue,
  fetchAllPages,
  multiSelectValue,
  relationIds,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";

const TODAY = losAngelesToday();

interface Flags {
  live: boolean;
  today: string;
  config: string;
  batch: string;
}

interface ResearchSeed {
  title: string;
  projectTitles: string[];
  repoNames: string[];
  relatedToolTitles: string[];
  category: string;
  summary: string;
  keyFindings: string;
  actionable: string;
  confidence: string;
  tags: string[];
  researchType: string;
  decisionImpact: string;
  revalidationCadence: string;
  whyItMatters: string[];
}

interface TargetProject {
  projectTitle: string;
  repoName: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
}

interface ActiveBuildBatchDefinition {
  researchSeeds: ResearchSeed[];
  targetProjects: TargetProject[];
}

const FIRST_BATCH_RESEARCH_SEEDS: ResearchSeed[] = [
  {
    title: "Jira Export Tools Need Secure Credential Storage, Pagination Control, and Audit Manifests",
    projectTitles: ["JSM Ticket Analytics Export"],
    repoNames: ["JSMTicketAnalyticsExport"],
    relatedToolTitles: ["GitHub", "Jira Service Management"],
    category: "Operations",
    summary:
      "Jira export tooling becomes more trustworthy when it handles credential storage, rate-limited pagination, and export auditability as first-class product requirements.",
    keyFindings:
      "The repo evidence shows that the differentiator is not simply pulling tickets. It is secure Keychain-backed auth, reliable pagination beyond native export caps, and manifest-style output that makes downstream analytics auditable.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["jira", "export", "operations", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This project is stronger when framed as a trustworthy data-extraction lane rather than a one-off script.",
      "The evidence clarifies what future export or analytics tools should inherit by default.",
    ],
  },
  {
    title: "Local API Reverse Engineering Needs Dual Capture Modes and Structured Export",
    projectTitles: ["API Reverse"],
    repoNames: ["APIReverse"],
    relatedToolTitles: ["GitHub", "Anthropic API", "Chrome"],
    category: "Engineering",
    summary:
      "API reverse-engineering tools gain leverage when they combine traffic capture, endpoint-pattern normalization, and exportable structured artifacts in one local workflow.",
    keyFindings:
      "The repo shows that browser extension capture and MITM proxy capture solve different discovery cases, while grouped endpoint patterns and Postman export turn raw traffic into a reusable developer artifact.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["api", "reverse-engineering", "desktop", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This clarifies that the value is not packet capture alone, but conversion into durable API understanding.",
      "It also creates a reusable pattern for future local inspection tools that need exportable output.",
    ],
  },
  {
    title: "Financial Infrastructure Education Lands Better as Stepwise Interactive Simulation",
    projectTitles: ["How Money Moves"],
    repoNames: ["HowMoneyMoves"],
    relatedToolTitles: ["GitHub"],
    category: "Product",
    summary:
      "Complex financial systems become far more teachable when the product turns them into stepwise, replayable simulations instead of static explanation text.",
    keyFindings:
      "The repo evidence points to a strong pattern: model each payment rail as a discrete walkthrough, visualize failure cases directly, and let the user scrub forward and backward through the explanation.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["finance", "education", "visualization", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This is useful for any future explainer product that needs comprehension, not just correct facts.",
      "It gives the project a clearer product thesis than 'React app with animations.'",
    ],
  },
  {
    title: "Local AI Writing Tools Work Best as Assistive Margin Notes, Not Cursor Hijacks",
    projectTitles: ["ink"],
    repoNames: ["ink"],
    relatedToolTitles: ["GitHub", "Ollama"],
    category: "AI / LLM",
    summary:
      "Writing tools feel more usable when AI suggestions behave like optional editorial notes around the text instead of competing directly with the writer's cursor.",
    keyFindings:
      "The repo shows a clear design stance: keep the workspace local, surface suggestions in the margin, and preserve explicit accept or dismiss control so the writer's flow stays primary.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["writing", "local-first", "ai", "github"],
    researchType: "Workflow",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This is a concrete product pattern for local AI tools that want to feel supportive rather than intrusive.",
      "It also gives the project a stronger UX rationale than 'Markdown editor with AI.'",
    ],
  },
  {
    title: "Interruption Recovery Tools Need Context Snapshots and Fast Resume Cards",
    projectTitles: ["Interruption Resume Studio"],
    repoNames: ["InterruptionResumeStudio"],
    relatedToolTitles: ["GitHub"],
    category: "Productivity",
    summary:
      "Focus-recovery tools work best when they optimize for rapid state capture before interruption and low-friction state restoration when work resumes.",
    keyFindings:
      "The repo evidence shows that the real product value is not generic note-taking. It is structured context capture, a quick-entry overlay, and a resume surface tuned for rapid re-entry into deep work.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["focus", "productivity", "desktop", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This helps separate the product from generic task managers or note apps.",
      "It also creates a useful design doctrine for other interruption-heavy workflows in the portfolio.",
    ],
  },
  {
    title: "Job Market Analytics Need Local NLP Extraction and Geographic Visualization",
    projectTitles: ["Job Market Heatmap"],
    repoNames: ["JobMarketHeatmap"],
    relatedToolTitles: ["GitHub"],
    category: "Data",
    summary:
      "Job-market products become more decision-useful when they combine local NLP extraction, role normalization, and geography-aware visualization in one workflow.",
    keyFindings:
      "The repo shows that the value comes from combining raw posting ingestion with skill extraction, map-based exploration, salary distributions, and trend views rather than any one chart alone.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["job-market", "nlp", "visualization", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This gives the project a clearer product frame than 'dashboard with multiple charts.'",
      "It also creates reusable guidance for future local analytics tools that combine Python extraction and UI visualization.",
    ],
  },
  {
    title: "Atmospheric Rule-Discovery Games Need Synchronized SceneKit, Metal, and Audio Feedback",
    projectTitles: ["Liminal"],
    repoNames: ["Liminal"],
    relatedToolTitles: ["GitHub"],
    category: "Game Design",
    summary:
      "Exploration games built around hidden rules feel stronger when visual, audio, and state-evaluation systems all react to the same rule engine in sync.",
    keyFindings:
      "The repo evidence shows a strong pattern: JSON-configured spaces, runtime rule evaluation, and tightly synchronized SceneKit, Metal, and audio modulation create a coherent discovery loop without HUD-heavy explanation.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["game-design", "ios", "metal", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This frames the product around experiential systems design rather than isolated graphics features.",
      "It also gives a reusable architecture pattern for future audiovisual exploration work.",
    ],
  },
  {
    title: "MCP Security Audits Need Permission Mapping, Injection Detection, and Drift Baselines",
    projectTitles: ["MCP Audit"],
    repoNames: ["MCPAudit"],
    relatedToolTitles: ["GitHub", "Anthropic API"],
    category: "Security",
    summary:
      "Useful MCP security audits need to do more than list tools. They need permission classification, prompt-risk review, and baseline drift tracking in one local inspection lane.",
    keyFindings:
      "The repo evidence shows the most valuable audit pattern is a combination of capability enumeration, prompt-injection heuristics, schema diffing against a saved baseline, and local-first execution.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["security", "mcp", "audit", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This turns MCP audit work into a repeatable operational pattern instead of a one-time inspection.",
      "It also informs future governance tools for agentic environments.",
    ],
  },
  {
    title: "Local Network Tools Need Capture, Decode, and Risk Views in One Workflow",
    projectTitles: ["Network Decoder", "Network Mapper"],
    repoNames: ["NetworkDecoder", "NetworkMapper"],
    relatedToolTitles: ["GitHub"],
    category: "Security",
    summary:
      "Network tools are more useful when they combine raw capture or discovery with higher-level visual and risk-oriented views instead of forcing the user to stitch together separate utilities.",
    keyFindings:
      "The two repos point to a shared pattern: one product benefits from layered protocol decode and view switching, while the other benefits from topology, service enrichment, and CVE-aware risk surfacing. Both work best as local operator workflows.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["network", "security", "visualization", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This creates a stronger shared portfolio lane for network tooling instead of treating each repo in isolation.",
      "It also clarifies what future operator-facing network tools should include by default.",
    ],
  },
];

const FIRST_BATCH_TARGET_PROJECTS: TargetProject[] = [
  {
    projectTitle: "JSM Ticket Analytics Export",
    repoName: "JSMTicketAnalyticsExport",
    researchTitles: ["Jira Export Tools Need Secure Credential Storage, Pagination Control, and Audit Manifests"],
    skillTitles: ["Python", "REST APIs", "Jira / JSM"],
    toolTitles: ["GitHub", "Jira Service Management"],
  },
  {
    projectTitle: "API Reverse",
    repoName: "APIReverse",
    researchTitles: [
      "Local API Reverse Engineering Needs Dual Capture Modes and Structured Export",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: [
      "Rust",
      "React",
      "TypeScript",
      "REST APIs",
      "Local-First Product Design",
      "Anthropic API Integration",
    ],
    toolTitles: ["GitHub", "Anthropic API", "Chrome"],
  },
  {
    projectTitle: "How Money Moves",
    repoName: "HowMoneyMoves",
    researchTitles: ["Financial Infrastructure Education Lands Better as Stepwise Interactive Simulation"],
    skillTitles: ["React", "TypeScript"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "ink",
    repoName: "ink",
    researchTitles: [
      "Local AI Writing Tools Work Best as Assistive Margin Notes, Not Cursor Hijacks",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Local-First Product Design"],
    toolTitles: ["GitHub", "Ollama"],
  },
  {
    projectTitle: "Interruption Resume Studio",
    repoName: "InterruptionResumeStudio",
    researchTitles: [
      "Interruption Recovery Tools Need Context Snapshots and Fast Resume Cards",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Job Market Heatmap",
    repoName: "JobMarketHeatmap",
    researchTitles: ["Job Market Analytics Need Local NLP Extraction and Geographic Visualization"],
    skillTitles: ["Python", "FastAPI", "React", "TypeScript", "REST APIs"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Liminal",
    repoName: "Liminal",
    researchTitles: ["Atmospheric Rule-Discovery Games Need Synchronized SceneKit, Metal, and Audio Feedback"],
    skillTitles: ["Swift", "Metal", "SceneKit 3D Globe Rendering"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "MCP Audit",
    repoName: "MCPAudit",
    researchTitles: ["MCP Security Audits Need Permission Mapping, Injection Detection, and Drift Baselines"],
    skillTitles: ["Python", "MCP Protocol", "Security Review"],
    toolTitles: ["GitHub", "Anthropic API"],
  },
  {
    projectTitle: "Network Decoder",
    repoName: "NetworkDecoder",
    researchTitles: [
      "Local Network Tools Need Capture, Decode, and Risk Views in One Workflow",
      "Security Audit Gates Need Deliberate Upgrade Plans",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Network Troubleshooting"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Network Mapper",
    repoName: "NetworkMapper",
    researchTitles: [
      "Local Network Tools Need Capture, Decode, and Risk Views in One Workflow",
      "Security Audit Gates Need Deliberate Upgrade Plans",
    ],
    skillTitles: ["Python", "FastAPI", "React", "TypeScript", "Network Troubleshooting", "Security Review"],
    toolTitles: ["GitHub"],
  },
];

const SECOND_BATCH_RESEARCH_SEEDS: ResearchSeed[] = [
  {
    title: "Simultaneous-Resolution Strategy Games Need Deterministic Shared Simulation and Fast Local Previews",
    projectTitles: ["BattleGrid"],
    repoNames: ["BattleGrid"],
    relatedToolTitles: ["GitHub"],
    category: "Game Design",
    summary:
      "Competitive strategy games with simultaneous turns feel fairer and more legible when browser previews and server authority share the same deterministic core.",
    keyFindings:
      "The repo evidence shows the strongest pattern is a shared Rust simulation compiled to WASM for local previews and reused by the Axum server for authoritative resolution, which removes turn-order drift and keeps replays stable.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["game-design", "rust", "wasm", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This turns BattleGrid into a reusable architecture example, not just an isolated game prototype.",
      "It also gives future multiplayer experiments a clearer standard for fairness, replayability, and low-latency feedback.",
    ],
  },
  {
    title: "AI Critique Tools Work Better With Structured Opposition and Persistent Follow-Up Context",
    projectTitles: ["Devils Advocate"],
    repoNames: ["devils-advocate"],
    relatedToolTitles: ["GitHub", "Anthropic API"],
    category: "AI / LLM",
    summary:
      "Idea-critique products are more useful when they produce a structured adversarial review and preserve that reasoning for follow-up conversation instead of restarting from blank chat each time.",
    keyFindings:
      "The repo shows that the product value comes from fixed critique dimensions, severity-rated blind spots, and a drill-down chat anchored to the saved critique rather than generic brainstorming.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["ai", "critique", "anthropic", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This clarifies that the product differentiator is rigorous structure, not just another Claude wrapper.",
      "It also creates a repeatable pattern for future decision-support tools across the portfolio.",
    ],
  },
  {
    title: "Portfolio Audit Systems Need Multi-Axis Scoring, Quick Wins, and Historical Drift Tracking",
    projectTitles: ["GitHub Repo Auditor"],
    repoNames: ["GithubRepoAuditor"],
    relatedToolTitles: ["GitHub", "Notion", "Anthropic API"],
    category: "Operations",
    summary:
      "Repo portfolio audits become actionable when they score maturity and interest separately, translate gaps into next best actions, and retain history for regression detection.",
    keyFindings:
      "The repo evidence shows that the useful leap is not collecting repo stats, but combining multiple analyzers, quick-win recommendations, exportable dashboards, Notion sync, and history-aware diffs in one operating loop.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["github", "audit", "portfolio", "notion"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This frames the project as a decision system for portfolio governance rather than a reporting script.",
      "It also creates a reusable pattern for turning large repo sprawl into prioritized follow-up work.",
    ],
  },
  {
    title: "Natural-Language MCP Server Generation Needs Structured Plans, Schema Validation, and Safe Extension Loops",
    projectTitles: ["MCP Forge"],
    repoNames: ["mcpforge"],
    relatedToolTitles: ["GitHub", "Anthropic API"],
    category: "Developer Tools",
    summary:
      "Prompt-to-code MCP generators are stronger when they translate natural language into validated server plans, scaffold a full runnable project, and support safe iterative extension instead of full regeneration.",
    keyFindings:
      "The repo shows that dependable generation depends on Pydantic validation, FastMCP-native templates, inspect mode for schema review, and extend mode for incremental growth without wiping manual edits.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["mcp", "codegen", "anthropic", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This gives the project a clearer operating thesis than 'AI code generator for MCP.'",
      "It also informs safer patterns for future prompt-driven scaffolding tools.",
    ],
  },
  {
    title: "Browser ML Playgrounds Teach Better With Live Training Visuals and Zero-Backend Sharing",
    projectTitles: ["Neural Network"],
    repoNames: ["NeuralNetwork"],
    relatedToolTitles: ["GitHub"],
    category: "Education",
    summary:
      "Machine-learning learning tools are more compelling when training, visualization, and sharing all happen client-side, removing setup friction while keeping the concepts visible.",
    keyFindings:
      "The repo evidence shows the product strength comes from browser-native TensorFlow.js training, live heatmaps and charts, dataset caching, and shareable configurations rather than static ML explainers.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["ml", "education", "browser", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This reframes the project as an interactive teaching instrument instead of a demo app.",
      "It also creates a useful pattern for future no-backend learning tools.",
    ],
  },
  {
    title: "Notion Becomes a Real Project OS When Publishing, Control-Tower Logic, and Governance Live in Code",
    projectTitles: ["Notion Operating System"],
    repoNames: ["notion-operating-system"],
    relatedToolTitles: ["GitHub", "Notion"],
    category: "Operations",
    summary:
      "Notion workflows become more durable when publishing, project-state rules, and review logic are codified locally instead of living in manual workspace habits.",
    keyFindings:
      "The repo shows that the durable value is a code-backed operating layer: schema-aware publishing, saved-view planning, control-tower logic, external-signal mapping, and governed workflows that can be versioned and rebuilt.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["notion", "operations", "automation", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This gives the project a stronger product identity than 'Notion publisher CLI.'",
      "It also serves as a blueprint for turning manual workspace operations into code-backed systems.",
    ],
  },
  {
    title: "Assistant-Safe Personal Control Planes Need Shared Context, Approval Gates, and Local Audit Trails",
    projectTitles: ["Personal Ops"],
    repoNames: ["personal-ops"],
    relatedToolTitles: ["GitHub"],
    category: "Productivity",
    summary:
      "Personal workflow control planes become trustworthy when assistants can read shared context freely but must pass through approval gates for anything that mutates real inbox, calendar, or draft state.",
    keyFindings:
      "The repo evidence shows a strong design pattern: local sync for context, MCP tools split between safe reads and gated writes, and explicit approval flows so assistants stay useful without becoming over-permissioned.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["productivity", "mcp", "workflow", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This frames the project as a safety architecture for assistant-powered operations, not just a personal dashboard.",
      "It also creates a reusable control-plane pattern for future agentic systems.",
    ],
  },
  {
    title: "Menu Bar System Monitors Need Fast Sampling, Local History, and Thresholded Alerts",
    projectTitles: ["Pulse Orbit"],
    repoNames: ["Pulse-Orbit"],
    relatedToolTitles: ["GitHub"],
    category: "Developer Tools",
    summary:
      "System-monitor utilities feel more valuable when they combine live metrics, local history, and configurable alerts in a compact always-available surface instead of separate heavy dashboards.",
    keyFindings:
      "The repo shows that the important pattern is tight macOS menu-bar delivery with Rust-powered metric collection, SQLite-backed history, and alert thresholds that turn raw telemetry into useful operator feedback.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["macos", "monitoring", "rust", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This gives the project a clearer product thesis than 'menu bar monitor built in Tauri.'",
      "It also establishes a reusable local-observability pattern for future lightweight operator tools.",
    ],
  },
  {
    title: "Local Sentiment Monitors Need Scheduled Ingestion, Lightweight NLP, and Optional Escalation for Ambiguous Cases",
    projectTitles: ["Reddit Sentiment Analyzer"],
    repoNames: ["RedditSentimentAnalyzer"],
    relatedToolTitles: ["GitHub", "Anthropic API"],
    category: "Data",
    summary:
      "Sentiment-monitoring products become more practical when a low-cost local NLP baseline handles most traffic and a higher-cost model is reserved for ambiguous edge cases.",
    keyFindings:
      "The repo evidence shows a useful architecture: scheduled Reddit ingestion, VADER-based baseline scoring, FastAPI plus React visualization, and optional Claude escalation only when heuristics are insufficient.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["sentiment", "reddit", "nlp", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This makes the project a reusable pattern for cost-aware social monitoring rather than a one-off dashboard.",
      "It also clarifies how cloud AI should layer on top of local analytics instead of replacing it.",
    ],
  },
  {
    title: "Data Extraction Extensions Should Try DOM First and Use Vision Only for Hard Cases",
    projectTitles: ["Screenshot to Data Select"],
    repoNames: ["ScreenshottoDataSelect"],
    relatedToolTitles: ["GitHub", "Chrome", "Anthropic API"],
    category: "Developer Tools",
    summary:
      "Browser extraction tools become faster and cheaper when they attempt structural DOM capture first and reserve vision models for charts, canvases, and non-semantic layouts.",
    keyFindings:
      "The repo shows that the differentiator is the layered extraction strategy: selection overlay, DOM-first parsing, Claude Vision fallback, and multi-format export with local history and cost awareness.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["chrome-extension", "data-extraction", "vision", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This creates a reusable pattern for practical multimodal extraction products.",
      "It also gives the project a stronger product doctrine than 'screenshot to CSV extension.'",
    ],
  },
];

const SECOND_BATCH_TARGET_PROJECTS: TargetProject[] = [
  {
    projectTitle: "BattleGrid",
    repoName: "BattleGrid",
    researchTitles: ["Simultaneous-Resolution Strategy Games Need Deterministic Shared Simulation and Fast Local Previews"],
    skillTitles: ["Rust", "React", "TypeScript", "Axum"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Devils Advocate",
    repoName: "devils-advocate",
    researchTitles: ["AI Critique Tools Work Better With Structured Opposition and Persistent Follow-Up Context"],
    skillTitles: ["Next.js", "TypeScript", "Anthropic API Integration", "Prompt Engineering", "SQLite"],
    toolTitles: ["GitHub", "Anthropic API"],
  },
  {
    projectTitle: "GitHub Repo Auditor",
    repoName: "GithubRepoAuditor",
    researchTitles: ["Portfolio Audit Systems Need Multi-Axis Scoring, Quick Wins, and Historical Drift Tracking"],
    skillTitles: ["Python", "REST APIs", "Anthropic API Integration"],
    toolTitles: ["GitHub", "Notion", "Anthropic API"],
  },
  {
    projectTitle: "MCP Forge",
    repoName: "mcpforge",
    researchTitles: ["Natural-Language MCP Server Generation Needs Structured Plans, Schema Validation, and Safe Extension Loops"],
    skillTitles: ["Python", "MCP Protocol", "Anthropic API Integration"],
    toolTitles: ["GitHub", "Anthropic API"],
  },
  {
    projectTitle: "Neural Network",
    repoName: "NeuralNetwork",
    researchTitles: ["Browser ML Playgrounds Teach Better With Live Training Visuals and Zero-Backend Sharing"],
    skillTitles: ["React", "TypeScript", "Next.js"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Notion Operating System",
    repoName: "notion-operating-system",
    researchTitles: ["Notion Becomes a Real Project OS When Publishing, Control-Tower Logic, and Governance Live in Code"],
    skillTitles: ["TypeScript", "REST APIs", "Prompt Engineering"],
    toolTitles: ["GitHub", "Notion"],
  },
  {
    projectTitle: "Personal Ops",
    repoName: "personal-ops",
    researchTitles: ["Assistant-Safe Personal Control Planes Need Shared Context, Approval Gates, and Local Audit Trails"],
    skillTitles: ["TypeScript", "MCP Protocol", "SQLite", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Pulse Orbit",
    repoName: "Pulse-Orbit",
    researchTitles: [
      "Menu Bar System Monitors Need Fast Sampling, Local History, and Thresholded Alerts",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "SQLite", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Reddit Sentiment Analyzer",
    repoName: "RedditSentimentAnalyzer",
    researchTitles: ["Local Sentiment Monitors Need Scheduled Ingestion, Lightweight NLP, and Optional Escalation for Ambiguous Cases"],
    skillTitles: ["Python", "FastAPI", "React", "TypeScript", "Anthropic API Integration"],
    toolTitles: ["GitHub", "Anthropic API"],
  },
  {
    projectTitle: "Screenshot to Data Select",
    repoName: "ScreenshottoDataSelect",
    researchTitles: [
      "Data Extraction Extensions Should Try DOM First and Use Vision Only for Hard Cases",
      "Focused Chrome Extensions Are a Fast Way to Ship Browser Utilities",
    ],
    skillTitles: ["TypeScript", "React", "Chrome Extension Development", "Anthropic API Integration"],
    toolTitles: ["GitHub", "Chrome", "Anthropic API"],
  },
];

const THIRD_BATCH_RESEARCH_SEEDS: ResearchSeed[] = [
  {
    title: "Local Spec-Writing Assistants Need Structured Artifacts, Version Diffs, and Offline Model Flow",
    projectTitles: ["AuraForge"],
    repoNames: ["AuraForge"],
    relatedToolTitles: ["GitHub", "Ollama"],
    category: "Productivity",
    summary:
      "Spec-planning tools are stronger when they guide scope step by step, generate durable artifacts, and keep the whole planning loop local instead of requiring cloud sessions.",
    keyFindings:
      "The repo shows that the product value comes from artifact generation, linting, diff tracking, and codebase import around a local Ollama planning loop, not just chat-based idea expansion.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["planning", "local-first", "ollama", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This clarifies that AuraForge is a planning system, not just another local chat shell.",
      "It also gives future specification tools a stronger product pattern for structured output and traceable revision.",
    ],
  },
  {
    title: "Historical Photo Matching Works Best With Multi-Stage On-Device Ranking and Clear Comparison Modes",
    projectTitles: ["Afterimage"],
    repoNames: ["Afterimage"],
    relatedToolTitles: ["GitHub"],
    category: "Product",
    summary:
      "Then-and-now photo experiences feel stronger when matching happens through layered spatial and visual ranking on-device, followed by comparison modes that make the reveal emotionally immediate.",
    keyFindings:
      "The repo evidence shows the useful pattern is staged filtering by location and heading, final image similarity re-ranking, and multiple comparison views instead of a single static overlay.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["ios", "vision", "historical-photos", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This frames Afterimage as a strong on-device matching product instead of just a camera experiment.",
      "It also provides a reusable pattern for other local media-matching interfaces.",
    ],
  },
  {
    title: "Geospatial Flavor Maps Need Dense Environmental Grids and Expressive Globe Interfaces",
    projectTitles: ["Terroir"],
    repoNames: ["Terroir"],
    relatedToolTitles: ["GitHub"],
    category: "Data",
    summary:
      "Data products that translate geography into an interpretive vocabulary land better when dense precomputed grids power a tactile globe and compact explanatory visualizations.",
    keyFindings:
      "The repo shows that the key product pattern is a prebuilt environmental grid, instant location lookup, and a SceneKit globe paired with radar-style profile visualization.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["geospatial", "ios", "visualization", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This gives Terroir a clearer product thesis than 'interesting map app with flavor vectors.'",
      "It also creates a pattern for future interpretive geospatial products in the portfolio.",
    ],
  },
  {
    title: "Timeline Workbenches Need Infinite-Canvas Performance and Optional Local Research Assistance",
    projectTitles: ["Chronomap"],
    repoNames: ["Chronomap"],
    relatedToolTitles: ["GitHub", "Ollama"],
    category: "Productivity",
    summary:
      "Timeline tools become more useful when they combine high-scale direct manipulation with optional local research help, instead of forcing users to choose between rigid data entry and generic AI output.",
    keyFindings:
      "The repo evidence points to a strong pattern: Canvas 2D performance, local SQLite persistence, rich event types, and Ollama-assisted event generation within the same local-first workflow.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["timeline", "canvas", "ollama", "github"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This clarifies that Chronomap is a serious thinking tool, not just a visualization demo.",
      "It also creates a reusable pattern for blending structured authoring with local AI assist.",
    ],
  },
  {
    title: "Agent Workflow Observability Needs Session Discovery, Delegation Graphs, and Tool-Level Inspection",
    projectTitles: ["Conductor"],
    repoNames: ["Conductor"],
    relatedToolTitles: ["GitHub"],
    category: "Developer Tools",
    summary:
      "Agentic workflow debugging becomes tractable when sessions, delegations, and tool calls are visualized as an explorable graph instead of buried in raw logs.",
    keyFindings:
      "The repo shows that the valuable pattern is automatic session discovery, typed JSONL parsing, force-directed graph layout, and synchronized detail views for tool inputs, outputs, and subagent structure.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["agentic", "observability", "swift", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This makes Conductor a workflow observability product rather than a one-off graph viewer.",
      "It also establishes a stronger pattern for understanding multi-agent execution behavior.",
    ],
  },
  {
    title: "Simulation Sandboxes Feel Richer When Genetics, Progression, and Optional Narration Share One Event Stream",
    projectTitles: ["DeepTank"],
    repoNames: ["DeepTank"],
    relatedToolTitles: ["GitHub", "Ollama"],
    category: "Game Design",
    summary:
      "Digital life simulations become more compelling when inheritance, progression systems, and optional AI narration all react to the same evolving simulation state.",
    keyFindings:
      "The repo evidence shows that the strongest loop comes from a Rust simulation core feeding breeding previews, phylogenetic history, replay controls, and optional local narration from the same event stream.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["simulation", "ollama", "desktop", "github"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This frames DeepTank as a systems-rich simulation product instead of an aquarium novelty.",
      "It also offers a reusable structure for future event-driven simulation experiences.",
    ],
  },
  {
    title: "Ambient Focus Companions Need Persistent World State Tied to Real Activity Signals",
    projectTitles: ["DesktopTerrarium"],
    repoNames: ["DesktopTerrarium"],
    relatedToolTitles: ["GitHub"],
    category: "Productivity",
    summary:
      "Ambient productivity companions feel more motivating when visible environmental changes are driven by real focus behavior and persist across sessions.",
    keyFindings:
      "The repo shows that the product strength comes from mapping keyboard activity and time progression into plant growth, weather, critter visits, and persistent terrarium state.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["focus", "bevy", "desktop", "github"],
    researchType: "Workflow",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This clarifies why Desktop Terrarium is more than a cozy visual toy.",
      "It also provides a pattern for behavior-linked ambient interfaces.",
    ],
  },
  {
    title: "Productivity Pets Work Best When Rewards, Overlay Presence, and Focus Guardrails Share One Loop",
    projectTitles: ["DesktopPEt"],
    repoNames: ["DesktopPEt"],
    relatedToolTitles: ["GitHub"],
    category: "Productivity",
    summary:
      "Gamified focus tools work better when pet progression, visible desktop presence, and distraction guardrails all reinforce the same habit loop.",
    keyFindings:
      "The repo evidence shows that the useful pattern is not just Pomodoro rewards, but a connected system of overlay behavior, quest progression, unlocks, and host-based focus interventions.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["focus", "desktop", "gamification", "github"],
    researchType: "Workflow",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This gives DesktopPEt a stronger product identity than 'cute focus timer with a penguin.'",
      "It also creates a reusable pattern for behavior-change tools with playful surfaces.",
    ],
  },
  {
    title: "Cadence Ledgers Need a Middle Layer Between Calendar Events and Habit Streaks",
    projectTitles: ["Life Cadence Ledger"],
    repoNames: ["LifeCadenceLedger"],
    relatedToolTitles: ["GitHub"],
    category: "Productivity",
    summary:
      "Recurring-life management tools become more useful when they model commitments and rhythms that are too soft for calendars but more structured than generic habit trackers.",
    keyFindings:
      "Even in early repo form, the product framing is clear: it is a ledger for cadence and obligations, aimed at the middle layer between scheduled events and lightweight habit streaks.",
    actionable: "Yes - Near-Term",
    confidence: "Medium",
    tags: ["habits", "productivity", "local-first", "github"],
    researchType: "Workflow",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This gives the project a sharper framing while the implementation surface is still early.",
      "It also captures the product thesis now so future build decisions stay coherent.",
    ],
  },
  {
    title: "Constraint-Based Writing Tools Need Irreversible Flow, Reveal Rituals, and Lightweight Session Stats",
    projectTitles: ["Redact"],
    repoNames: ["Redact"],
    relatedToolTitles: ["GitHub"],
    category: "Product",
    summary:
      "Writing tools built around creative constraint work best when they make the rule emotionally clear, preserve momentum, and save reflection for a distinct post-writing reveal.",
    keyFindings:
      "The repo shows that the value comes from the forward-only rule, the reveal interaction, and small post-session stats that reinforce the behavior without turning the app into a heavy editor.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["writing", "ios", "productivity", "github"],
    researchType: "Workflow",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This gives Redact a clearer product doctrine than 'minimal writing app.'",
      "It also offers a reusable pattern for tools where constraint is the core benefit.",
    ],
  },
];

const THIRD_BATCH_TARGET_PROJECTS: TargetProject[] = [
  {
    projectTitle: "AuraForge",
    repoName: "AuraForge",
    researchTitles: [
      "Local Spec-Writing Assistants Need Structured Artifacts, Version Diffs, and Offline Model Flow",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Local-First Product Design", "Prompt Engineering"],
    toolTitles: ["GitHub", "Ollama"],
  },
  {
    projectTitle: "Afterimage",
    repoName: "Afterimage",
    researchTitles: ["Historical Photo Matching Works Best With Multi-Stage On-Device Ranking and Clear Comparison Modes"],
    skillTitles: ["Swift", "SQLite", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Terroir",
    repoName: "Terroir",
    researchTitles: ["Geospatial Flavor Maps Need Dense Environmental Grids and Expressive Globe Interfaces"],
    skillTitles: ["Swift", "SceneKit 3D Globe Rendering", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Chronomap",
    repoName: "Chronomap",
    researchTitles: [
      "Timeline Workbenches Need Infinite-Canvas Performance and Optional Local Research Assistance",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Local-First Product Design", "SQLite"],
    toolTitles: ["GitHub", "Ollama"],
  },
  {
    projectTitle: "Conductor",
    repoName: "Conductor",
    researchTitles: ["Agent Workflow Observability Needs Session Discovery, Delegation Graphs, and Tool-Level Inspection"],
    skillTitles: ["Swift", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "DeepTank",
    repoName: "DeepTank",
    researchTitles: [
      "Simulation Sandboxes Feel Richer When Genetics, Progression, and Optional Narration Share One Event Stream",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Local-First Product Design"],
    toolTitles: ["GitHub", "Ollama"],
  },
  {
    projectTitle: "DesktopTerrarium",
    repoName: "DesktopTerrarium",
    researchTitles: ["Ambient Focus Companions Need Persistent World State Tied to Real Activity Signals"],
    skillTitles: ["Rust", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "DesktopPEt",
    repoName: "DesktopPEt",
    researchTitles: [
      "Productivity Pets Work Best When Rewards, Overlay Presence, and Focus Guardrails Share One Loop",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "React", "TypeScript", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Life Cadence Ledger",
    repoName: "LifeCadenceLedger",
    researchTitles: ["Cadence Ledgers Need a Middle Layer Between Calendar Events and Habit Streaks"],
    skillTitles: ["TypeScript", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
  {
    projectTitle: "Redact",
    repoName: "Redact",
    researchTitles: ["Constraint-Based Writing Tools Need Irreversible Flow, Reveal Rituals, and Lightweight Session Stats"],
    skillTitles: ["Swift", "Local-First Product Design"],
    toolTitles: ["GitHub"],
  },
];

const BATCH_DEFINITIONS: Record<string, ActiveBuildBatchDefinition> = {
  first: {
    researchSeeds: FIRST_BATCH_RESEARCH_SEEDS,
    targetProjects: FIRST_BATCH_TARGET_PROJECTS,
  },
  second: {
    researchSeeds: SECOND_BATCH_RESEARCH_SEEDS,
    targetProjects: SECOND_BATCH_TARGET_PROJECTS,
  },
  third: {
    researchSeeds: THIRD_BATCH_RESEARCH_SEEDS,
    targetProjects: THIRD_BATCH_TARGET_PROJECTS,
  },
};

function parseFlags(argv: string[]): Flags {
  let live = false;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let batch = "first";

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
      continue;
    }
    if (current === "--config") {
      config = argv[index + 1] ?? config;
      index += 1;
      continue;
    }
    if (current === "--batch") {
      batch = argv[index + 1] ?? batch;
      index += 1;
    }
  }

  return { live, today, config, batch };
}

async function main(): Promise<void> {
  try {
    const output = await runBackfillActiveBuildSupportBatch(parseFlags(process.argv.slice(2)));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runBackfillActiveBuildSupportBatch(flags: Flags): Promise<Record<string, unknown>> {
  const batchDefinition = BATCH_DEFINITIONS[flags.batch];
  if (!batchDefinition) {
    throw new AppError(
      `Unknown active-build support batch "${flags.batch}". Expected one of: ${Object.keys(BATCH_DEFINITIONS).join(", ")}`,
    );
  }
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for the active-build support backfill batch",
  );
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);

  const [projectSchema, researchSchema, skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, researchPagesBefore, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
  ]);

  const projectByTitle = new Map(projectPages.map((page) => [page.title, page]));
  const skillByTitle = new Map(skillPages.map((page) => [page.title, page]));
  const toolByTitle = new Map(toolPages.map((page) => [page.title, page]));

  validateTargets(batchDefinition.targetProjects, projectByTitle, skillByTitle, toolByTitle);

  const researchUpserts = [];
  for (const seed of batchDefinition.researchSeeds) {
    const existing = researchPagesBefore.find((page) => page.title === seed.title);
    if (flags.live) {
      const toolIds = seed.relatedToolTitles.map((title: string) => requirePage(toolByTitle, title, "tool").id);
      const projectIds = seed.projectTitles.map((title: string) => requirePage(projectByTitle, title, "project").id);
      const markdown = renderResearchMarkdown(seed);
      const result = await upsertPageByTitle({
        api,
        dataSourceId: config.relatedDataSources.researchId,
        titlePropertyName: researchSchema.titlePropertyName,
        title: seed.title,
        properties: {
          [researchSchema.titlePropertyName]: titleValue(seed.title),
          Category: selectPropertyValue(seed.category),
          Summary: richTextValue(seed.summary),
          "Key Findings": richTextValue(seed.keyFindings),
          Actionable: selectPropertyValue(seed.actionable),
          Confidence: selectPropertyValue(seed.confidence),
          Sources: richTextValue(renderSources(seed.repoNames)),
          "Source URLs": { url: `https://github.com/saagpatel/${seed.repoNames[0] ?? ""}` },
          "Date Researched": datePropertyValue(flags.today),
          "Last Verified": datePropertyValue(flags.today),
          Tags: multiSelectValue(seed.tags),
          "Related Tools": relationValue(toolIds),
          "Related Local Projects": relationValue(projectIds),
          "Related Projects": relationValue([]),
          "Research Type": selectPropertyValue(seed.researchType),
          "Decision Impact": selectPropertyValue(seed.decisionImpact),
          "Revalidation Cadence": selectPropertyValue(seed.revalidationCadence),
        },
        markdown,
      });
      researchUpserts.push({
        title: seed.title,
        existed: result.existed,
        id: result.id,
      });
      continue;
    }
    researchUpserts.push({
      title: seed.title,
      existed: Boolean(existing),
      id: existing?.id ?? `planned:${seed.title}`,
    });
  }

  const researchPages = flags.live
    ? await fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName)
    : [
        ...researchPagesBefore,
        ...batchDefinition.researchSeeds
          .filter((seed: ResearchSeed) => !researchPagesBefore.some((page) => page.title === seed.title))
          .map(
          (seed: ResearchSeed) =>
            ({
              id: `planned:${seed.title}`,
              url: "",
              title: seed.title,
              properties: {},
            }) satisfies DataSourcePageRef,
        ),
      ];
  const researchByTitle = new Map(researchPages.map((page) => [page.title, page]));

  const projectResults = [];
  const reverseResearchUpdates = new Map<string, Set<string>>();
  const reverseSkillUpdates = new Map<string, Set<string>>();
  const reverseToolUpdates = new Map<string, Set<string>>();

  for (const target of batchDefinition.targetProjects) {
    const projectPage = requirePage(projectByTitle, target.projectTitle, "project");
    const researchIds = uniqueIds(
      target.researchTitles.map((title: string) => requirePage(researchByTitle, title, "research").id),
    );
    const skillIds = uniqueIds(
      target.skillTitles.map((title: string) => requirePage(skillByTitle, title, "skill").id),
    );
    const toolIds = uniqueIds(target.toolTitles.map((title: string) => requirePage(toolByTitle, title, "tool").id));
    const currentResearchIds = relationIds(projectPage.properties["Related Research"]);
    const currentSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
    const currentToolIds = relationIds(projectPage.properties["Tool Stack Records"]);
    const nextResearchIds = uniqueIds([...currentResearchIds, ...researchIds]);
    const nextSkillIds = uniqueIds([...currentSkillIds, ...skillIds]);
    const nextToolIds = uniqueIds([...currentToolIds, ...toolIds]);

    if (flags.live) {
      await api.updatePageProperties({
        pageId: projectPage.id,
        properties: {
          "Date Updated": datePropertyValue(flags.today),
          "Related Research": relationValue(nextResearchIds),
          "Supporting Skills": relationValue(nextSkillIds),
          "Tool Stack Records": relationValue(nextToolIds),
          "Related Research Count": { number: nextResearchIds.length },
          "Supporting Skills Count": { number: nextSkillIds.length },
          "Linked Tool Count": { number: nextToolIds.length },
        },
      });
    }

    for (const researchId of nextResearchIds) {
      addReverseLink(reverseResearchUpdates, researchId, projectPage.id);
    }
    for (const skillId of nextSkillIds) {
      addReverseLink(reverseSkillUpdates, skillId, projectPage.id);
    }
    for (const toolId of nextToolIds) {
      addReverseLink(reverseToolUpdates, toolId, projectPage.id);
    }

    projectResults.push({
      projectTitle: target.projectTitle,
      researchAdded: nextResearchIds.length - currentResearchIds.length,
      skillsAdded: nextSkillIds.length - currentSkillIds.length,
      toolsAdded: nextToolIds.length - currentToolIds.length,
      totalResearch: nextResearchIds.length,
      totalSkills: nextSkillIds.length,
      totalTools: nextToolIds.length,
    });
  }

  const supportPromotions = summarizeSupportPromotions({
    researchPagesBefore,
    skillPages,
    toolPages,
    usedResearchIds: uniqueIds(Array.from(reverseResearchUpdates.keys())),
    usedSkillIds: uniqueIds(Array.from(reverseSkillUpdates.keys())),
    usedToolIds: uniqueIds(Array.from(reverseToolUpdates.keys())),
  });

  if (flags.live) {
    await applyReverseUpdates({
      api,
      pages: researchPages,
      updates: reverseResearchUpdates,
      propertyName: "Related Local Projects",
    });
    await applyReverseUpdates({
      api,
      pages: skillPages,
      updates: reverseSkillUpdates,
      propertyName: "Related Local Projects",
    });
    await applyReverseUpdates({
      api,
      pages: toolPages,
      updates: reverseToolUpdates,
      propertyName: "Linked Local Projects",
    });
  }

  return {
    ok: true,
    live: flags.live,
    today: flags.today,
    batch: flags.batch,
    targetProjectCount: batchDefinition.targetProjects.length,
    researchRowsPrepared: batchDefinition.researchSeeds.length,
    researchRowsUpserted: researchUpserts,
    projectResults,
    supportPromotions,
  };
}

function renderResearchMarkdown(seed: ResearchSeed): string {
  return [
    `# ${seed.title}`,
    "",
    "## Summary",
    seed.summary,
    "",
    "## Key findings",
    seed.keyFindings,
    "",
    "## Repo evidence",
    ...seed.repoNames.map((repoName) => `- ${repoName}: https://github.com/saagpatel/${repoName}`),
    "",
    "## Why it matters",
    ...seed.whyItMatters.map((line) => `- ${line}`),
    "",
    "## Related projects",
    ...seed.projectTitles.map((title) => `- ${title}`),
  ].join("\n");
}

function renderSources(repoNames: string[]): string {
  return `GitHub README audit on ${TODAY}: ${repoNames
    .map((repoName) => `https://github.com/saagpatel/${repoName}`)
    .join(", ")}`;
}

function validateTargets(
  targetProjects: TargetProject[],
  projectByTitle: Map<string, DataSourcePageRef>,
  skillByTitle: Map<string, DataSourcePageRef>,
  toolByTitle: Map<string, DataSourcePageRef>,
): void {
  for (const target of targetProjects) {
    requirePage(projectByTitle, target.projectTitle, "project");
    for (const title of target.skillTitles) {
      requirePage(skillByTitle, title, "skill");
    }
    for (const title of target.toolTitles) {
      requirePage(toolByTitle, title, "tool");
    }
  }
}

function requirePage(
  pages: Map<string, DataSourcePageRef>,
  title: string,
  kind: string,
): DataSourcePageRef {
  const page = pages.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page titled "${title}"`);
  }
  return page;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function addReverseLink(map: Map<string, Set<string>>, pageId: string, projectId: string): void {
  const existing = map.get(pageId) ?? new Set<string>();
  existing.add(projectId);
  map.set(pageId, existing);
}

async function applyReverseUpdates(input: {
  api: DirectNotionClient;
  pages: DataSourcePageRef[];
  updates: Map<string, Set<string>>;
  propertyName: string;
}): Promise<void> {
  const pageById = new Map(input.pages.map((page) => [page.id, page]));
  for (const [pageId, projectIds] of input.updates.entries()) {
    const page = pageById.get(pageId);
    if (!page) {
      continue;
    }
    const currentIds = relationIds(page.properties[input.propertyName]);
    const nextIds = uniqueIds([...currentIds, ...Array.from(projectIds)]);
    if (nextIds.length === currentIds.length) {
      continue;
    }
    await input.api.updatePageProperties({
      pageId,
      properties: {
        [input.propertyName]: relationValue(nextIds),
      },
    });
  }
}

function summarizeSupportPromotions(input: {
  researchPagesBefore: DataSourcePageRef[];
  skillPages: DataSourcePageRef[];
  toolPages: DataSourcePageRef[];
  usedResearchIds: string[];
  usedSkillIds: string[];
  usedToolIds: string[];
}): Record<string, unknown> {
  return {
    researchPromotedFromZeroLinks: countPromoted(
      input.researchPagesBefore,
      "Related Local Projects",
      input.usedResearchIds,
    ),
    skillPromotedFromZeroLinks: countPromoted(
      input.skillPages,
      "Related Local Projects",
      input.usedSkillIds,
    ),
    toolPromotedFromZeroLinks: countPromoted(
      input.toolPages,
      "Linked Local Projects",
      input.usedToolIds,
    ),
  };
}

function countPromoted(
  pages: DataSourcePageRef[],
  propertyName: string,
  usedIds: string[],
): Array<{ title: string; id: string }> {
  const used = new Set(usedIds);
  return pages
    .filter((page) => used.has(page.id))
    .filter((page) => relationIds(page.properties[propertyName]).length === 0)
    .map((page) => ({ title: page.title, id: page.id }));
}

if (process.argv[1]?.endsWith("backfill-active-build-support-batch.ts")) {
  void main();
}
