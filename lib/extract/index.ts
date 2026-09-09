import { VIEWPORTS, describeHttpFailure, loadAndSettle, openPage, screenshot } from '../browser';
import { screenshotName, screenshotUrl, writeScreenshot } from '../screenshots';
import { checkRobots } from '../resolve';
import { emitAgentPrompt, emitCompactPrompt } from '../emit/prompt';
import { emitHtml } from '../emit/html';
import { emitReactSections } from '../emit/react';
import {
  emitDesignTokens,
  emitTailwindConfig,
  emitTailwindTheme,
  emitTokensCss,
} from '../emit/tokens';
import type {
  AssetManifest,
  DesignSystem,
  EmittedFile,
  ExtractOptions,
  ExtractionResult,
  HarvestNetworkEntry,
  HarvestResult,
  PageMeta,
  ResponsiveBehavior,
  SectionSpec,
  ViewportLabel,
} from '../types';
import { buildAssetManifest } from './assets';
import { challengeMessage, detectChallenge } from './challenge';
import { buildPalette } from './colors';
import { columnCount, findLayoutContainer } from './components';
import {
  buildBorderWidths,
  buildBreakpoints,
  buildContainer,
  buildMotion,
  buildRadii,
  buildShadows,
  readCssVariables,
} from './effects';
import { harvest } from './harvest';
import { buildSections } from './sections';
import { buildSpacingScale } from './spacing';
import { recoverMediaQueries } from './stylesheets';
import { NodeTree } from './tree';
import { buildFontFamilies, buildTypeScale, headingSizesFrom } from './typography';

const TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS ?? 60_000);

export type ProgressFn = (step: string, message: string, progress: number) => void;

interface Capture {
  harvest: HarvestResult;
  network: HarvestNetworkEntry[];
  screenshotPath?: string;
  /** Set when the render succeeded but the screenshot did not. */
  screenshotError?: string;
}

async function capture(
  url: string,
  label: ViewportLabel,
  jobId: string,
  takeScreenshot: boolean,
  colorScheme: 'light' | 'dark' = 'light',
): Promise<Capture> {
  const viewport = VIEWPORTS[label];
  const session = await openPage(viewport, colorScheme);
  try {
    const { status } = await loadAndSettle(session.page, url, TIMEOUT_MS);
    const failure = describeHttpFailure(status, url);
    if (failure) throw new Error(failure);

    const result = await harvest(session.page, url, viewport);

    let screenshotPath: string | undefined;
    let screenshotError: string | undefined;
    if (takeScreenshot) {
      try {
        const buffer = await screenshot(session.page, result.documentHeight);
        const name = screenshotName(jobId, label);
        await writeScreenshot(name, buffer);
        screenshotPath = screenshotUrl(name);
      } catch (error) {
        // A screenshot is a reference image; the design system is the product.
        // Losing the whole extraction — every token, section and component
        // already measured — because one capture timed out is a bad trade.
        screenshotError = error instanceof Error ? error.message.split('\n')[0] : String(error);
      }
    }

    return { harvest: result, network: session.network, screenshotPath, screenshotError };
  } finally {
    await session.close();
  }
}

function buildDesignSystem(
  primary: HarvestResult,
  network: HarvestNetworkEntry[],
  dark?: HarvestResult,
): DesignSystem {
  const palette = buildPalette(primary.nodes);
  const { scale } = buildTypeScale(primary.nodes);
  const families = buildFontFamilies(primary.nodes, network, headingSizesFrom(scale));

  let darkPalette = dark ? buildPalette(dark.nodes) : undefined;
  // Sites that ignore the media query return an identical palette; reporting it
  // as "dark mode support" would send an agent building a theme that is a copy.
  if (darkPalette && darkPalette.roles.background === palette.roles.background) {
    darkPalette = undefined;
  }

  return {
    palette,
    darkPalette,
    families,
    typeScale: scale,
    spacing: buildSpacingScale(primary.nodes),
    radii: buildRadii(primary.nodes),
    shadows: buildShadows(primary.nodes),
    borderWidths: buildBorderWidths(primary.nodes),
    motion: buildMotion(primary.nodes, primary.keyframes),
    breakpoints: buildBreakpoints(primary.mediaQueries),
    container: buildContainer(primary.nodes, primary.viewport.width),
    sourceVariables: readCssVariables(primary),
  };
}

/**
 * Record how each section behaves at a narrower viewport.
 *
 * Sections are matched by their position in the flow rather than by selector,
 * because responsive CSS routinely swaps which element carries the layout —
 * a desktop grid becomes a mobile flex column on a different node entirely.
 */
function mergeResponsive(
  sections: SectionSpec[],
  others: { label: ViewportLabel; harvest: HarvestResult }[],
): void {
  const desktopColumns = new Map(sections.map((s) => [s.order, s.layout.columns]));

  for (const section of sections) {
    section.responsive.desktop = {
      columns: section.layout.columns,
      display: section.layout.display,
      visible: true,
      paddingX: section.layout.paddingX,
      paddingY: section.layout.paddingTop,
      stacks: false,
    };
  }

  for (const { label, harvest: other } of others) {
    const otherSections = buildSections(other);
    const tree = new NodeTree(other.nodes);

    for (const section of sections) {
      const match = otherSections.find((s) => s.order === section.order && s.kind === section.kind)
        ?? otherSections.find((s) => s.order === section.order);

      if (!match) {
        // Absent at this width means the section is hidden, which is itself a
        // design decision worth reporting (mobile nav collapse, for instance).
        section.responsive[label] = {
          columns: 0,
          display: 'none',
          visible: false,
          paddingX: 0,
          paddingY: 0,
          stacks: false,
        };
        continue;
      }

      // The same section can sit at a different index in a narrower render, so
      // re-find it by selector and fall back to the section's own reading when
      // the selector no longer resolves.
      const nodeIndex = tree.nodes.findIndex((n) => n.sel === match.selector);
      const columns =
        nodeIndex >= 0
          ? columnCount(findLayoutContainer(tree, nodeIndex), tree)
          : match.layout.columns;

      const behavior: ResponsiveBehavior = {
        columns,
        display: match.layout.display,
        visible: true,
        paddingX: match.layout.paddingX,
        paddingY: match.layout.paddingTop,
        stacks: columns < (desktopColumns.get(section.order) ?? columns),
      };
      section.responsive[label] = behavior;
    }
  }
}

export async function runExtraction(
  jobId: string,
  options: ExtractOptions,
  onProgress: ProgressFn,
): Promise<ExtractionResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  onProgress('robots', 'Checking robots.txt…', 4);
  const robots = await checkRobots(options.url);
  if (!robots.allowed) {
    throw new Error(
      `${robots.reason}. DesignDNA honors robots.txt; extract a page the site permits instead.`,
    );
  }
  if (robots.reason.includes('unreachable')) warnings.push('robots.txt could not be fetched.');

  const viewports = options.viewports.length ? options.viewports : (['desktop'] as ViewportLabel[]);
  const primaryLabel: ViewportLabel = viewports.includes('desktop') ? 'desktop' : viewports[0];

  onProgress('render', `Rendering at ${primaryLabel} (${VIEWPORTS[primaryLabel].width}px)…`, 12);
  const primary = await capture(options.url, primaryLabel, jobId, true);

  if (primary.harvest.stats.truncated) {
    warnings.push(
      `The page exceeded the ${primary.harvest.nodes.length}-element analysis cap; very deep subtrees were skipped.`,
    );
  }

  if (primary.screenshotError) {
    warnings.push(`Screenshot at ${primaryLabel} failed: ${primary.screenshotError}`);
  }

  const others: { label: ViewportLabel; harvest: HarvestResult; failed?: boolean }[] = [];
  let step = 26;
  for (const label of viewports.filter((v) => v !== primaryLabel)) {
    onProgress('render', `Rendering at ${label} (${VIEWPORTS[label].width}px)…`, step);
    const shot = await capture(options.url, label, jobId, true);
    others.push({ label, harvest: shot.harvest, failed: Boolean(shot.screenshotError) });
    if (shot.screenshotError) {
      warnings.push(`Screenshot at ${label} failed: ${shot.screenshotError}`);
    }
    step += 12;
  }

  onProgress('dark', 'Checking for a dark theme…', 52);
  let darkHarvest: HarvestResult | undefined;
  try {
    darkHarvest = (await capture(options.url, primaryLabel, jobId, false, 'dark')).harvest;
  } catch {
    // A dark-mode pass is a bonus; failing it must not fail the extraction.
    warnings.push('Dark-mode capture failed; only the light palette was extracted.');
  }

  const screenshots: AssetManifest['screenshots'] = {};
  if (primary.screenshotPath) screenshots[primaryLabel] = primary.screenshotPath;
  for (const label of viewports.filter((v) => v !== primaryLabel)) {
    // Listing a URL for a capture that failed would hand the UI a broken image
    // and put a 404 in every bundle.
    const shot = others.find((o) => o.label === label);
    if (shot && !shot.failed) screenshots[label] = screenshotUrl(screenshotName(jobId, label));
  }

  return analyze({
    jobId,
    requestedUrl: options.url,
    primary: primary.harvest,
    others,
    dark: darkHarvest,
    network: primary.network,
    screenshots,
    contentMode: options.contentMode,
    source: 'server',
    emitReact: options.emitReact,
    emitHtml: options.emitHtml,
    warnings,
    startedAt,
    onProgress,
  });
}

export interface AnalysisInput {
  jobId: string;
  requestedUrl: string;
  primary: HarvestResult;
  others: { label: ViewportLabel; harvest: HarvestResult }[];
  dark?: HarvestResult;
  network: HarvestNetworkEntry[];
  screenshots: AssetManifest['screenshots'];
  contentMode: ExtractOptions['contentMode'];
  /** Which browser rendered this. Decides what a bot check means and advises. */
  source?: 'server' | 'browser';
  emitReact: boolean;
  emitHtml: boolean;
  warnings: string[];
  startedAt: number;
  onProgress: ProgressFn;
}

/**
 * Everything after rendering: inference, structure, and emitted output.
 *
 * Split out from `runExtraction` because the harvest does not have to come from
 * this server's browser. A page behind bot protection will never render here,
 * but it renders perfectly well in the browser of someone who can already view
 * it — so the same harvest can arrive from a console snippet or the extension
 * and take exactly this path, producing identical output.
 */
export async function analyze(input: AnalysisInput): Promise<ExtractionResult> {
  const { jobId, primary, others, dark, network, warnings, onProgress } = input;

  // Before any inference, whichever browser rendered this: everything
  // downstream would otherwise describe the interstitial rather than the site,
  // and would look entirely normal doing it.
  const challenge = detectChallenge(primary);
  if (challenge) {
    throw new Error(challengeMessage(challenge, primary.finalUrl, input.source ?? 'server'));
  }

  // Breakpoints declared only in a cross-origin stylesheet are invisible to the
  // page but not to the server, which is not bound by the same-origin policy.
  if (primary.stats.inaccessibleSheets > 0) {
    onProgress('design', 'Reading stylesheets the page could not…', 58);
    const recovered = await recoverMediaQueries(network, primary.finalUrl);
    if (recovered.queries.length > 0) {
      primary.mediaQueries = [...new Set([...primary.mediaQueries, ...recovered.queries])];
      warnings.push(
        `${primary.stats.inaccessibleSheets} cross-origin stylesheet(s) were unreadable from the page; ` +
          `${recovered.queries.length} media queries were recovered by fetching them directly.`,
      );
    } else {
      warnings.push(
        `${primary.stats.inaccessibleSheets} cross-origin stylesheet(s) could not be read from the page ` +
          `or fetched directly. Their rendered effect is still captured, but breakpoints declared only ` +
          `inside them are missing.`,
      );
    }
  }

  onProgress('design', 'Inferring the design system…', 62);
  const design = buildDesignSystem(primary, network, dark);

  onProgress('sections', 'Segmenting sections and detecting components…', 74);
  const sections = buildSections(primary);
  mergeResponsive(sections, others);

  onProgress('assets', 'Cataloguing fonts, icons and images…', 82);
  const assets = buildAssetManifest(primary, design.families, input.screenshots);

  const page: PageMeta = {
    requestedUrl: input.requestedUrl,
    finalUrl: primary.finalUrl,
    title: primary.title,
    description: primary.description,
    lang: primary.lang,
    themeColor: primary.meta.themeColor,
    documentHeight: primary.documentHeight,
    extractedAt: new Date().toISOString(),
    durationMs: 0,
    warnings,
  };

  onProgress('emit', 'Generating tokens, components and the agent brief…', 90);

  // The brief describes the bundle it ships in, so everything else is emitted
  // first and the manifest is handed to it.
  const generated: EmittedFile[] = [
    emitDesignTokens(design),
    emitTokensCss(design),
    emitTailwindConfig(design),
    emitTailwindTheme(design),
  ];

  if (input.emitReact) generated.push(...emitReactSections(design, sections, input.contentMode));
  if (input.emitHtml) {
    generated.push(...emitHtml(design, sections, input.contentMode, page.title, page.description));
  }

  generated.push({
    path: 'spec.json',
    contents: JSON.stringify({ page, design, sections, assets }, null, 2),
    language: 'json',
    description: 'The complete extraction as machine-readable JSON.',
  });

  const prompt = emitAgentPrompt(page, design, sections, assets, input.contentMode, generated);
  const compact = emitCompactPrompt(page, design, sections, input.contentMode, assets);

  const files: EmittedFile[] = [prompt, compact, ...generated];

  page.durationMs = Date.now() - input.startedAt;

  // The completion event is emitted by the job store when this resolves;
  // announcing it here too would deliver "done" twice to every SSE client.
  return {
    id: jobId,
    page,
    design,
    sections,
    assets,
    files,
    agentPrompt: prompt.contents,
    agentPromptCompact: compact.contents,
    stats: {
      nodesAnalyzed: primary.nodes.length,
      colorsFound: design.palette.tokens.length,
      sectionsFound: sections.length,
      componentsDetected: sections.filter((s) => s.repeat).length,
      inaccessibleSheets: primary.stats.inaccessibleSheets,
    },
  };
}
