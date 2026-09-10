import { buildPalette } from './colors';
import {
  buildBorderWidths,
  buildBreakpoints,
  buildContainer,
  buildMotion,
  buildRadii,
  buildShadows,
  readCssVariables,
} from './effects';
import { buildSpacingScale } from './spacing';
import { buildFontFamilies, buildTypeScale, headingSizesFrom } from './typography';
import type { DesignSystem, HarvestNetworkEntry, HarvestResult } from '../types';

export function buildDesignSystem(
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

