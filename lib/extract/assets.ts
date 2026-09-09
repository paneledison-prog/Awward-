import type {
  AssetManifest,
  FontFamilySpec,
  HarvestNode,
  HarvestResult,
  IconSpec,
  ImageSpec,
} from '../types';
import { NodeTree } from './tree';

/**
 * Icon-library fingerprints.
 *
 * Naming the library beats emitting raw SVG paths: an agent told "Lucide, 24px,
 * stroke 2" writes `<Check />`, whereas a wall of path data gets copied
 * verbatim and never matches the rest of the icon set.
 */
const ICON_SIGNATURES: { library: IconSpec['library']; test: (n: HarvestNode) => boolean }[] = [
  {
    library: 'lucide',
    test: (n) =>
      n.svg?.viewBox === '0 0 24 24' &&
      n.styles.fill === 'none' &&
      n.styles.stroke !== 'none' &&
      /lucide/i.test(n.cls),
  },
  { library: 'feather', test: (n) => /feather/i.test(n.cls) && n.svg?.viewBox === '0 0 24 24' },
  { library: 'heroicons', test: (n) => /heroicon/i.test(n.cls) },
  { library: 'font-awesome', test: (n) => /\bfa[-srlbd]?\b|fontawesome/i.test(n.cls) },
  { library: 'material', test: (n) => /material-icons|mui-/i.test(n.cls) },
];

const BRAND_HINTS = /logo|brand|wordmark|favicon|icon-\d|app-icon/i;

export function classifyImage(node: HarvestNode): ImageSpec {
  const img = node.img!;
  const width = img.naturalWidth || node.box[2];
  const height = img.naturalHeight || node.box[3];
  const src = img.src;
  const alt = img.alt;

  let role: ImageSpec['role'] = 'photo';
  if (img.isBackground) role = 'background';
  else if (BRAND_HINTS.test(src) || BRAND_HINTS.test(alt) || BRAND_HINTS.test(node.cls)) role = 'logo';
  else if (width <= 48 && height <= 48) role = 'icon';
  // A small square in a testimonial or byline is a face, not an icon.
  else if (width <= 96 && Math.abs(width - height) <= 4) role = 'avatar';
  else if (node.box[1] < 900 && node.box[2] > 400) role = 'hero';

  return {
    src,
    alt,
    width,
    height,
    role,
    // Logos and favicons carry the source site's identity and must be swapped
    // before the extracted design is used for anything real.
    isBrandAsset: role === 'logo' || BRAND_HINTS.test(src) || BRAND_HINTS.test(alt),
  };
}

export function collectImages(nodes: HarvestNode[]): ImageSpec[] {
  const seen = new Set<string>();
  const out: ImageSpec[] = [];
  for (const node of nodes) {
    if (!node.img?.src) continue;
    // Inline data URIs are already embedded; key on a prefix rather than the
    // whole payload, but keep alt text in the key — a logo cloud often repeats
    // one placeholder image whose alt is the only thing naming each company.
    const key = node.img.src.startsWith('data:')
      ? `${node.img.src.slice(0, 64)}|${node.img.alt}`
      : node.img.src;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(classifyImage(node));
    if (out.length >= 120) break;
  }
  return out;
}

export function detectIcons(nodes: HarvestNode[]): IconSpec {
  const svgNodes = nodes.filter((n) => n.svg);
  if (svgNodes.length === 0) {
    return { library: 'custom', confidence: 0, count: 0, samples: [] };
  }

  for (const signature of ICON_SIGNATURES) {
    const matches = svgNodes.filter(signature.test);
    if (matches.length >= 2) {
      return {
        library: signature.library,
        confidence: Number((matches.length / svgNodes.length).toFixed(2)),
        count: svgNodes.length,
        samples: matches.slice(0, 4).map(describeSvg),
      };
    }
  }

  // No library matched, but a consistent viewBox and stroke still tells an
  // agent what to match when it picks a set.
  const uniform = svgNodes.filter((n) => n.svg?.viewBox === '0 0 24 24');
  return {
    library: 'custom',
    confidence: svgNodes.length ? Number((uniform.length / svgNodes.length).toFixed(2)) : 0,
    count: svgNodes.length,
    samples: svgNodes.slice(0, 4).map(describeSvg),
  };
}

function describeSvg(node: HarvestNode): string {
  const svg = node.svg!;
  return `<svg viewBox="${svg.viewBox}" width="${svg.width}" height="${svg.height}" paths="${svg.pathCount}" d="${svg.firstPathD.slice(0, 60)}${svg.firstPathD.length > 60 ? '…' : ''}">`;
}

export function buildAssetManifest(
  harvest: HarvestResult,
  fonts: FontFamilySpec[],
  screenshots: AssetManifest['screenshots'],
): AssetManifest {
  return {
    images: collectImages(harvest.nodes),
    icons: detectIcons(harvest.nodes),
    fonts,
    favicon: harvest.meta.favicon,
    ogImage: harvest.meta.ogImage,
    screenshots,
  };
}

export type { NodeTree };
