/**
 * Shared contract for the whole extraction pipeline.
 *
 * Flow: HarvestResult (raw, produced inside the browser)
 *         -> DesignSystem + SectionSpec[] (inferred, pure functions)
 *         -> emitted files (tokens / React / HTML / agent prompt)
 */

/* ------------------------------------------------------------------ */
/* Harvest — raw data collected inside the page                        */
/* ------------------------------------------------------------------ */

/** Style properties captured per element. Kept short to bound payload size. */
export interface HarvestStyles {
  display: string;
  position: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  gap: string;
  gridTemplateColumns: string;
  gridAutoFlow: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  borderTopColor: string;
  borderTopWidth: string;
  borderTopStyle: string;
  borderBottomColor: string;
  borderBottomWidth: string;
  borderBottomStyle: string;
  borderLeftWidth: string;
  borderRightWidth: string;
  borderTopLeftRadius: string;
  borderStyle: string;
  boxShadow: string;
  opacity: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  textAlign: string;
  textDecorationLine: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  marginTop: string;
  marginBottom: string;
  width: string;
  maxWidth: string;
  height: string;
  minHeight: string;
  transitionDuration: string;
  transitionTimingFunction: string;
  transitionProperty: string;
  animationName: string;
  animationDuration: string;
  transform: string;
  fill: string;
  stroke: string;
  overflow: string;
  zIndex: string;
  textShadow: string;
  backdropFilter: string;
  objectFit: string;
}

export interface HarvestImage {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  /** True when the element is a CSS background rather than an <img>. */
  isBackground: boolean;
  loading?: string;
}

export interface HarvestSvg {
  viewBox: string;
  pathCount: number;
  /** First path's `d`, truncated — used to fingerprint icon libraries. */
  firstPathD: string;
  width: number;
  height: number;
}

export interface HarvestNode {
  /** Index into HarvestResult.nodes. */
  i: number;
  /** Parent index, or -1 for the root. */
  p: number;
  tag: string;
  id: string;
  /** Original class attribute, truncated. */
  cls: string;
  role: string;
  ariaLabel: string;
  /** Stable-ish CSS path used to re-find the node and to label output. */
  sel: string;
  /** Document coordinates: [x, y, width, height]. */
  box: [number, number, number, number];
  /** width * height, in CSS px. Drives area-weighted inference. */
  area: number;
  depth: number;
  /** Text belonging directly to this element (not descendants). */
  text: string;
  /** Full subtree text, collapsed and truncated. */
  subtreeText: string;
  /** Number of element children. */
  childCount: number;
  href: string;
  styles: HarvestStyles;
  img?: HarvestImage;
  svg?: HarvestSvg;
  /** True when this element renders a visible border on any side. */
  hasBorder: boolean;
  /** Structural fingerprint used for repeated-component detection. */
  sig: string;
}

export interface HarvestFont {
  family: string;
  weight: string;
  style: string;
  status: string;
}

export interface HarvestNetworkEntry {
  url: string;
  type: string;
  status: number;
}

export interface HarvestResult {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  description: string;
  lang: string;
  viewport: { width: number; height: number; label: ViewportLabel };
  documentHeight: number;
  /** Where the walk started. `found: false` means the requested selector
   *  matched nothing — the harvest is empty rather than the whole page. */
  root?: { selector: string; found: boolean; box: [number, number, number, number] };
  nodes: HarvestNode[];
  /** Raw `@media` condition text from every reachable stylesheet. */
  mediaQueries: string[];
  /** `@keyframes` names, for motion notes. */
  keyframes: string[];
  /** CSS custom properties declared on :root — a site's own tokens, when exposed. */
  cssVariables: Record<string, string>;
  fonts: HarvestFont[];
  meta: {
    themeColor: string;
    ogImage: string;
    favicon: string;
    generator: string;
  };
  stats: {
    sheetCount: number;
    ruleCount: number;
    /** Stylesheets unreadable due to CORS — signals how much was inaccessible. */
    inaccessibleSheets: number;
    nodeCount: number;
    truncated: boolean;
  };
}

export type ViewportLabel = 'desktop' | 'tablet' | 'mobile';

export interface ViewportConfig {
  label: ViewportLabel;
  width: number;
  height: number;
  isMobile: boolean;
}

/* ------------------------------------------------------------------ */
/* Design system — inferred                                            */
/* ------------------------------------------------------------------ */

export type ColorRole =
  | 'background'
  | 'surface'
  | 'foreground'
  | 'muted'
  | 'primary'
  | 'accent'
  | 'border'
  | 'neutral';

export interface ColorToken {
  /** Token name, e.g. "primary" or "neutral-400". */
  name: string;
  hex: string;
  rgb: [number, number, number];
  /** 0-1. Below 1 the color is only ever seen composited over something. */
  alpha: number;
  oklch: { l: number; c: number; h: number };
  /** Total rendered area (px^2) this color covers. */
  area: number;
  /** Number of elements using it. */
  count: number;
  roles: ColorRole[];
  /** Which CSS properties it appeared in. */
  properties: string[];
}

export interface Palette {
  tokens: ColorToken[];
  /** Named role -> hex, the practical output most consumers use. */
  roles: Partial<Record<ColorRole, string>>;
  /** True when the page's dominant background is dark. */
  isDark: boolean;
}

export interface FontFamilySpec {
  /** Full CSS stack as authored. */
  stack: string;
  /** First non-generic family. */
  primary: string;
  source: 'google' | 'self-hosted' | 'system' | 'adobe' | 'unknown';
  /** Weights actually observed in use. */
  weights: number[];
  /** Font file URLs seen on the network. */
  urls: string[];
  /** Ready-to-paste import code for the detected source. */
  importCode: string;
  /** Rendered area using this family — identifies the body vs. display face. */
  area: number;
  usage: 'body' | 'display' | 'mono' | 'accent';
}

export interface TypeToken {
  name: string;
  fontSize: number;
  /** Unitless where derivable, else px. */
  lineHeight: number;
  fontWeight: number;
  letterSpacing: string;
  family: string;
  textTransform: string;
  /** Tags this token was observed on. */
  tags: string[];
  count: number;
  sample: string;
}

export interface SpacingScale {
  /** Inferred base unit in px (2 / 4 / 6 / 8). */
  baseUnit: number;
  /** Share of observed values that are multiples of baseUnit. */
  confidence: number;
  /** Distinct spacing values in use, ascending. */
  values: number[];
  /** Tailwind-style step name -> px. */
  named: Record<string, number>;
}

export interface RadiusToken {
  name: string;
  value: string;
  px: number;
  count: number;
}

export interface ShadowToken {
  name: string;
  value: string;
  count: number;
}

export interface MotionSpec {
  durations: { value: string; count: number }[];
  easings: { value: string; count: number }[];
  keyframes: string[];
  /** True when transitions are widespread enough to be a design decision. */
  usesTransitions: boolean;
}

export interface ContainerSpec {
  /** Most common max-width among wide content wrappers, in px. */
  maxWidth: number | null;
  /** Horizontal padding at each viewport. */
  paddingX: Partial<Record<ViewportLabel, number>>;
}

export interface DesignSystem {
  palette: Palette;
  /** Present when the site responds to prefers-color-scheme: dark. */
  darkPalette?: Palette;
  families: FontFamilySpec[];
  typeScale: TypeToken[];
  spacing: SpacingScale;
  radii: RadiusToken[];
  shadows: ShadowToken[];
  borderWidths: { value: string; count: number }[];
  motion: MotionSpec;
  /** Breakpoint widths in px, ascending. */
  breakpoints: number[];
  container: ContainerSpec;
  /** CSS custom properties the site itself declared, when readable. */
  sourceVariables: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Structure — sections and repeated components                        */
/* ------------------------------------------------------------------ */

export type SectionKind =
  | 'nav'
  | 'hero'
  | 'feature-grid'
  | 'logo-cloud'
  | 'testimonial'
  | 'pricing'
  | 'faq'
  | 'stats'
  | 'gallery'
  | 'cta'
  | 'content'
  | 'footer';

export interface CtaSpec {
  label: string;
  href: string;
  /** Filled background vs. outline vs. plain text link. */
  variant: 'primary' | 'secondary' | 'link';
  background: string;
  color: string;
  radius: string;
  paddingX: number;
  paddingY: number;
}

export interface ImageSpec {
  src: string;
  alt: string;
  width: number;
  height: number;
  role: 'logo' | 'hero' | 'icon' | 'avatar' | 'photo' | 'background';
  /** True when this looks like the source site's own branding. */
  isBrandAsset: boolean;
}

export interface RepeatItem {
  /** Text lines within the item, in document order. */
  lines: string[];
  heading: string;
  body: string;
  image?: ImageSpec;
  href: string;
  hasIcon: boolean;
}

export interface RepeatSpec {
  count: number;
  signature: string;
  /** Columns at the desktop viewport. */
  columns: number;
  gap: number;
  itemLayout: {
    display: string;
    padding: string;
    background: string;
    radius: string;
    border: string;
    shadow: string;
  };
  items: RepeatItem[];
  /** Suggested component name, e.g. "FeatureCard". */
  componentName: string;
}

export interface SectionLayout {
  display: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  gap: number;
  gridTemplateColumns: string;
  columns: number;
  maxWidth: number | null;
  paddingTop: number;
  paddingBottom: number;
  paddingX: number;
  textAlign: string;
  minHeight: number;
}

export interface ResponsiveBehavior {
  columns: number;
  display: string;
  /** False when the section is hidden at this viewport. */
  visible: boolean;
  paddingX: number;
  paddingY: number;
  /** Stacking detected by comparing against the desktop layout. */
  stacks: boolean;
}

export interface SectionSpec {
  id: string;
  kind: SectionKind;
  /** Human label used in output, e.g. "Hero". */
  label: string;
  order: number;
  selector: string;
  box: [number, number, number, number];
  background: string;
  backgroundImage: string;
  textColor: string;
  layout: SectionLayout;
  eyebrow: string;
  heading: string;
  headingLevel: number;
  subheading: string;
  bodyText: string[];
  ctas: CtaSpec[];
  navLinks: { label: string; href: string }[];
  images: ImageSpec[];
  repeat?: RepeatSpec;
  responsive: Partial<Record<ViewportLabel, ResponsiveBehavior>>;
  /** Free-form notes the emitters surface to the agent. */
  notes: string[];
}

export interface IconSpec {
  library: 'lucide' | 'feather' | 'heroicons' | 'font-awesome' | 'material' | 'custom';
  confidence: number;
  count: number;
  /** Inline SVG markup for a few representative icons. */
  samples: string[];
}

export interface AssetManifest {
  images: ImageSpec[];
  icons: IconSpec;
  fonts: FontFamilySpec[];
  favicon: string;
  ogImage: string;
  screenshots: Partial<Record<ViewportLabel, string>>;
}

/* ------------------------------------------------------------------ */
/* Job + result                                                        */
/* ------------------------------------------------------------------ */

export type ContentMode = 'verbatim' | 'placeholder';

/**
 * A capture an agent asked a person's browser to perform, because the server's
 * own renderer cannot reach the page.
 */
export interface CaptureRequest {
  id: string;
  url: string;
  /** CSS selector for one element, when the agent wants a component. */
  selector?: string;
  /** Why the agent wants it — shown to the person deciding. */
  note?: string;
  viewport?: ViewportLabel;
  /** The extraction job the agent polls; the capture completes it. */
  jobId: string;
  status: 'pending' | 'claimed' | 'done' | 'declined' | 'expired';
  createdAt: number;
  updatedAt: number;
  resultId?: string;
  /** Why it was declined, or how it failed. */
  message?: string;
}

export interface ExtractOptions {
  url: string;
  /** CSS selector scoping the extraction to one element. Omitted, the whole
   *  page is extracted. */
  selector?: string;
  contentMode: ContentMode;
  viewports: ViewportLabel[];
  /** Emit React/Tailwind component files. */
  emitReact: boolean;
  /** Emit plain HTML + CSS. */
  emitHtml: boolean;
}

export interface PageMeta {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  description: string;
  lang: string;
  themeColor: string;
  documentHeight: number;
  extractedAt: string;
  /** Milliseconds the whole extraction took. */
  durationMs: number;
  /** Warnings worth showing the user (CORS-blocked CSS, robots notes, ...). */
  warnings: string[];
}

export interface EmittedFile {
  path: string;
  contents: string;
  language: 'json' | 'css' | 'tsx' | 'ts' | 'html' | 'markdown' | 'javascript';
  /** Short description shown in the UI file tree. */
  description: string;
}

export interface ExtractionResult {
  id: string;
  page: PageMeta;
  design: DesignSystem;
  sections: SectionSpec[];
  assets: AssetManifest;
  files: EmittedFile[];
  /** The headline deliverable, also present in `files`. */
  agentPrompt: string;
  agentPromptCompact: string;
  stats: {
    nodesAnalyzed: number;
    colorsFound: number;
    sectionsFound: number;
    componentsDetected: number;
    inaccessibleSheets: number;
  };
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobEvent {
  step: string;
  message: string;
  /** 0-100. */
  progress: number;
  at: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  options: ExtractOptions;
  events: JobEvent[];
  result?: ExtractionResult;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}
