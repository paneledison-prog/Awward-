import { VIEWPORTS, loadAndSettle, openPage, screenshot } from '../browser';
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
import { NodeTree } from './tree';
import { buildFontFamilies, buildTypeScale, headingSizesFrom } from './typography';

const TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS ?? 60_000);

export type ProgressFn = (step: string, message: string, progress: number) => void;

interface Capture {
  harvest: HarvestResult;
  network: HarvestNetworkEntry[];
  screenshotPath?: string;
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
    await loadAndSettle(session.page, url, TIMEOUT_MS);
    const result = await harvest(session.page, url, viewport);

    let screenshotPath: string | undefined;
    if (takeScreenshot) {
      const buffer = await screenshot(session.page, true);
      const name = screenshotName(jobId, label);
      await writeScreenshot(name, buffer);
      screenshotPath = screenshotUrl(name);
    }

    return { harvest: result, network: session.network, screenshotPath };
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
  if (primary.harvest.stats.inaccessibleSheets > 0) {
    warnings.push(
      `${primary.harvest.stats.inaccessibleSheets} cross-origin stylesheet(s) could not be read directly. Their rendered effect is still captured, but media queries declared only in them are missing.`,
    );
  }

  const others: { label: ViewportLabel; harvest: HarvestResult }[] = [];
  let step = 26;
  for (const label of viewports.filter((v) => v !== primaryLabel)) {
    onProgress('render', `Rendering at ${label} (${VIEWPORTS[label].width}px)…`, step);
    const shot = await capture(options.url, label, jobId, true);
    others.push({ label, harvest: shot.harvest });
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

  onProgress('design', 'Inferring the design system…', 62);
  const design = buildDesignSystem(primary.harvest, primary.network, darkHarvest);

  onProgress('sections', 'Segmenting sections and detecting components…', 74);
  const sections = buildSections(primary.harvest);
  mergeResponsive(sections, others);

  const screenshots: AssetManifest['screenshots'] = {};
  if (primary.screenshotPath) screenshots[primaryLabel] = primary.screenshotPath;
  for (const label of viewports.filter((v) => v !== primaryLabel)) {
    screenshots[label] = screenshotUrl(screenshotName(jobId, label));
  }

  onProgress('assets', 'Cataloguing fonts, icons and images…', 82);
  const assets = buildAssetManifest(primary.harvest, design.families, screenshots);

  const page: PageMeta = {
    requestedUrl: options.url,
    finalUrl: primary.harvest.finalUrl,
    title: primary.harvest.title,
    description: primary.harvest.description,
    lang: primary.harvest.lang,
    themeColor: primary.harvest.meta.themeColor,
    documentHeight: primary.harvest.documentHeight,
    extractedAt: new Date().toISOString(),
    durationMs: 0,
    warnings,
  };

  onProgress('emit', 'Generating tokens, components and the agent brief…', 90);

  const prompt = emitAgentPrompt(page, design, sections, assets, options.contentMode);
  const compact = emitCompactPrompt(page, design, sections, options.contentMode);

  const files: EmittedFile[] = [
    prompt,
    compact,
    emitDesignTokens(design),
    emitTokensCss(design),
    emitTailwindConfig(design),
    emitTailwindTheme(design),
  ];

  if (options.emitReact) files.push(...emitReactSections(design, sections, options.contentMode));
  if (options.emitHtml) {
    files.push(...emitHtml(design, sections, options.contentMode, page.title, page.description));
  }

  files.push({
    path: 'spec.json',
    contents: JSON.stringify({ page, design, sections, assets }, null, 2),
    language: 'json',
    description: 'The complete extraction as machine-readable JSON.',
  });

  page.durationMs = Date.now() - startedAt;

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
      nodesAnalyzed: primary.harvest.nodes.length,
      colorsFound: design.palette.tokens.length,
      sectionsFound: sections.length,
      componentsDetected: sections.filter((s) => s.repeat).length,
      inaccessibleSheets: primary.harvest.stats.inaccessibleSheets,
    },
  };
}
