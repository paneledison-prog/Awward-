import { buildZip } from '../emit/bundle';
import { emitAgentPrompt } from '../emit/prompt';
import { emitHtml } from '../emit/html';
import { emitReactSections } from '../emit/react';
import { emitDesignTokens, emitTokensCss } from '../emit/tokens';
import { getFinishedJob } from '../jobs';
import { createJob } from '../jobs';
import { createRequest, listRequests } from '../requests';
import { normalizeUrl, resolveInput } from '../resolve';
import { nameFromUrl, readScreenshot } from '../screenshots';
import { startExtraction, waitForJob } from '../start';
import type {
  ContentMode,
  EmittedFile,
  ExtractOptions,
  ExtractionResult,
  Job,
  SectionSpec,
  ViewportLabel,
} from '../types';

export interface ToolContext {
  /** Absolute origin of this instance, for links back to screenshots and ZIPs. */
  origin: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });
const problem = (body: string): ToolResult => ({
  content: [{ type: 'text', text: body }],
  isError: true,
});

const VIEWPORTS: ViewportLabel[] = ['desktop', 'tablet', 'mobile'];

/** An MCP response travels through the agent's context window; a 4MB JPEG or a
 *  20k-line file helps nobody. Callers get a pointer past this size. */
const MAX_INLINE_BYTES = 700_000;

function asUrl(value: unknown, field = 'url'): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  const url = normalizeUrl(value.trim());
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${field} must be an http(s) URL.`);
  }
  return url;
}

function contentMode(value: unknown): ContentMode {
  return value === 'placeholder' ? 'placeholder' : 'verbatim';
}

function viewports(value: unknown, fallback: ViewportLabel[]): ViewportLabel[] {
  if (!Array.isArray(value)) return fallback;
  const picked = VIEWPORTS.filter((v) => (value as string[]).includes(v));
  return picked.length ? picked : fallback;
}

/** Seconds the caller is willing to hold the tool call open. */
function waitSeconds(value: unknown, fallback: number): number {
  const seconds = typeof value === 'number' ? value : fallback;
  return Math.max(0, Math.min(240, seconds));
}

async function requireResult(id: unknown): Promise<ExtractionResult> {
  if (typeof id !== 'string' || !id.trim()) throw new Error('extraction_id is required.');
  const job = await getFinishedJob(id.trim());
  if (!job) {
    throw new Error(`No extraction ${id}. It may have expired — run extract_page again.`);
  }
  if (job.status === 'error') throw new Error(job.error ?? 'That extraction failed.');
  if (!job.result) {
    throw new Error(`Extraction ${id} is still running (${job.status}). Call get_extraction.`);
  }
  return job.result;
}

function progressLine(job: Job): string {
  const last = job.events[job.events.length - 1];
  return last ? `${last.progress}% — ${last.message}` : 'queued';
}

/** What an agent needs to know about a finished extraction, in one screen. */
function summarize(result: ExtractionResult, ctx: ToolContext): string {
  const component = result.sections.length === 1 && result.sections[0].id.startsWith('component');
  const lines = [
    `extraction_id: ${result.id}`,
    `source: ${result.page.finalUrl}`,
    `title: ${result.page.title}`,
    '',
    component
      ? `Extracted one component (${result.sections[0].kind}) at \`${result.sections[0].selector}\`.`
      : `Extracted ${result.sections.length} sections, ${result.stats.componentsDetected} of them repeating groups.`,
    '',
    'Design system:',
    `- colors: ${Object.entries(result.design.palette.roles)
      .map(([role, hex]) => `${role} ${hex}`)
      .join(', ')}`,
    `- fonts: ${result.design.families.map((f) => `${f.primary} (${f.usage})`).join(', ') || 'none detected'}`,
    `- spacing base: ${result.design.spacing.baseUnit}px`,
    `- breakpoints: ${result.design.breakpoints.join(', ') || 'none declared'}`,
    '',
    'Next:',
    `- list_components({ extraction_id: "${result.id}" }) — what is in it`,
    `- get_brief({ extraction_id: "${result.id}" }) — the full build specification`,
    `- get_bundle({ extraction_id: "${result.id}" }) — every emitted file`,
  ];

  const shots = Object.keys(result.assets.screenshots);
  if (shots.length) {
    lines.push(`- get_screenshot({ extraction_id: "${result.id}", viewport: "${shots[0]}" })`);
  }
  if (result.page.warnings.length) {
    lines.push('', 'Caveats:', ...result.page.warnings.map((w) => `- ${w}`));
  }
  lines.push('', `Bundle: ${ctx.origin}/api/extract/${result.id}/download`);
  return lines.join('\n');
}

function fileBlock(file: EmittedFile): string {
  return [`--- ${file.path} ---`, '```' + file.language, file.contents, '```'].join('\n');
}

function componentFiles(
  result: ExtractionResult,
  section: SectionSpec,
  format: string,
  mode: ContentMode,
): EmittedFile[] {
  const files: EmittedFile[] = [];
  if (format === 'react' || format === 'all') {
    files.push(...emitReactSections(result.design, [section], mode));
  }
  if (format === 'html' || format === 'all') {
    files.push(...emitHtml(result.design, [section], mode, section.label, result.page.description));
  }
  if (format === 'tokens' || format === 'all') {
    files.push(emitTokensCss(result.design), emitDesignTokens(result.design));
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export const TOOLS: Tool[] = [
  {
    name: 'find_site',
    title: 'Find a site by name',
    description:
      'Resolve a company or product name to candidate URLs. Use this when the user names a ' +
      'site rather than giving a URL, then pass the chosen url to extract_page or extract_component.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'A site name, e.g. "stripe".' } },
      required: ['name'],
    },
    async handler(args) {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) return problem('name is required.');

      const found = await resolveInput(name);
      if (found.direct) return text(`Direct URL: ${found.direct}`);
      if (!found.candidates?.length) return problem(`Nothing resolved for "${name}".`);

      return text(
        ['Candidates (pick one and pass it as `url`):', '', ...found.candidates.map((c) => `- ${c.url} — ${c.title}`)].join('\n'),
      );
    },
  },

  {
    name: 'extract_page',
    title: 'Extract a whole page',
    description:
      'Render a page in a real browser at up to three viewports and measure its design system: ' +
      'colors, type scale, spacing, radii, shadows, motion, breakpoints, every section and every ' +
      'repeating component. Returns an extraction_id the other tools read. Takes 30-90 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page to extract.' },
        viewports: {
          type: 'array',
          items: { type: 'string', enum: VIEWPORTS },
          description: 'Defaults to all three (desktop 1440, tablet 768, mobile 390).',
        },
        content_mode: {
          type: 'string',
          enum: ['verbatim', 'placeholder'],
          description:
            'verbatim keeps the source copy; placeholder swaps it for stand-in text of the same ' +
            'length, which is what you want when building something of your own.',
        },
        wait_seconds: {
          type: 'number',
          description: 'How long to hold this call open for the result. Default 120, max 240.',
        },
      },
      required: ['url'],
    },
    async handler(args, ctx) {
      const options: ExtractOptions = {
        url: asUrl(args.url),
        contentMode: contentMode(args.content_mode),
        viewports: viewports(args.viewports, VIEWPORTS),
        emitReact: true,
        emitHtml: true,
      };
      return runAndReport(options, waitSeconds(args.wait_seconds, 120), ctx);
    },
  },

  {
    name: 'extract_component',
    title: 'Extract one component',
    description:
      'Render a page and measure only the element matching a CSS selector — a pricing card, a ' +
      'nav bar, a testimonial. Returns tokens and code for that component alone, not the page. ' +
      'If the selector matches nothing the call fails and says so rather than returning the page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page the component is on.' },
        selector: {
          type: 'string',
          description: 'CSS selector for the element, e.g. ".pricing-card" or "#hero > div".',
        },
        viewports: {
          type: 'array',
          items: { type: 'string', enum: VIEWPORTS },
          description: 'Defaults to desktop and mobile — enough to see how it stacks.',
        },
        content_mode: { type: 'string', enum: ['verbatim', 'placeholder'] },
        wait_seconds: { type: 'number', description: 'Default 120, max 240.' },
      },
      required: ['url', 'selector'],
    },
    async handler(args, ctx) {
      const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
      if (!selector) return problem('selector is required.');

      const options: ExtractOptions = {
        url: asUrl(args.url),
        selector,
        contentMode: contentMode(args.content_mode),
        viewports: viewports(args.viewports, ['desktop', 'mobile']),
        emitReact: true,
        emitHtml: true,
      };
      return runAndReport(options, waitSeconds(args.wait_seconds, 120), ctx);
    },
  },

  {
    name: 'get_extraction',
    title: 'Check or fetch an extraction',
    description:
      'Progress while it runs, the summary once it finishes. Call this after an extract_* tool ' +
      'returned before its extraction was done.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction_id: { type: 'string' },
        wait_seconds: { type: 'number', description: 'Hold the call open for this long. Default 0.' },
      },
      required: ['extraction_id'],
    },
    async handler(args, ctx) {
      const id = typeof args.extraction_id === 'string' ? args.extraction_id.trim() : '';
      if (!id) return problem('extraction_id is required.');

      const job = await waitForJob(id, waitSeconds(args.wait_seconds, 0) * 1000);
      if (!job) return problem(`No extraction ${id}. It may have expired.`);
      if (job.status === 'error') return problem(job.error ?? 'That extraction failed.');
      if (!job.result) return text(`Still running: ${progressLine(job)}`);

      return text(summarize(job.result, ctx));
    },
  },

  {
    name: 'list_components',
    title: 'List the components in an extraction',
    description:
      'Every section and repeating group found in an extraction, with the id to pass to ' +
      'get_component. Use this to pick a component out of a page you have already extracted, ' +
      'instead of re-rendering it with a selector.',
    inputSchema: {
      type: 'object',
      properties: { extraction_id: { type: 'string' } },
      required: ['extraction_id'],
    },
    async handler(args) {
      const result = await requireResult(args.extraction_id);

      const rows = result.sections.map((section) =>
        [
          `- ${section.id}`,
          `kind: ${section.kind}`,
          `size: ${section.box[2]}×${section.box[3]}px`,
          section.repeat ? `repeats: ${section.repeat.count}× <${section.repeat.componentName} />` : '',
          section.heading ? `heading: "${section.heading.slice(0, 60)}"` : '',
          `selector: ${section.selector}`,
        ]
          .filter(Boolean)
          .join(' · '),
      );

      return text(
        [
          `${result.sections.length} component(s) in ${result.id}:`,
          '',
          ...rows,
          '',
          `get_component({ extraction_id: "${result.id}", component_id: "${result.sections[0]?.id ?? ''}", format: "react" })`,
        ].join('\n'),
      );
    },
  },

  {
    name: 'get_component',
    title: 'Get one component code',
    description:
      'Code for a single component from an extraction: React + Tailwind, plain HTML + CSS, the ' +
      'tokens it uses, or a build brief written for that component alone.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction_id: { type: 'string' },
        component_id: { type: 'string', description: 'From list_components.' },
        format: {
          type: 'string',
          enum: ['react', 'html', 'tokens', 'brief', 'all'],
          description: 'Default react.',
        },
      },
      required: ['extraction_id', 'component_id'],
    },
    async handler(args) {
      const result = await requireResult(args.extraction_id);
      const componentId = typeof args.component_id === 'string' ? args.component_id : '';
      const section = result.sections.find((s) => s.id === componentId);
      if (!section) {
        return problem(
          `No component "${componentId}". Available: ${result.sections.map((s) => s.id).join(', ')}`,
        );
      }

      const format = typeof args.format === 'string' ? args.format : 'react';
      const mode = result.agentPrompt.includes('**Content:** placeholder')
        ? ('placeholder' as ContentMode)
        : ('verbatim' as ContentMode);

      if (format === 'brief') {
        const brief = emitAgentPrompt(result.page, result.design, [section], result.assets, mode, [], {
          kind: 'component',
          selector: section.selector,
          box: section.box,
        });
        return text(brief.contents);
      }

      const files = componentFiles(result, section, format, mode);
      if (!files.length) return problem(`Unknown format "${format}".`);

      const body = files.map(fileBlock).join('\n\n');
      if (body.length > MAX_INLINE_BYTES) {
        return text(
          [
            `${files.length} files, ${(body.length / 1024).toFixed(0)}KB — too large to inline.`,
            'Ask for a single format, or download the whole bundle:',
            files.map((f) => `- ${f.path}`).join('\n'),
          ].join('\n'),
        );
      }

      return text(body);
    },
  },

  {
    name: 'get_brief',
    title: 'Get the build brief',
    description:
      'The full build specification for an extraction as markdown: design system, page ' +
      'structure, every section in detail, the bundle layout and build instructions. This is the ' +
      'document to work from.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction_id: { type: 'string' },
        compact: { type: 'boolean', description: 'The trimmed version, for small context windows.' },
      },
      required: ['extraction_id'],
    },
    async handler(args) {
      const result = await requireResult(args.extraction_id);
      return text(args.compact === true ? result.agentPromptCompact : result.agentPrompt);
    },
  },

  {
    name: 'get_screenshot',
    title: 'Get a reference screenshot',
    description:
      'The full-page render taken during extraction, as an image. This is the visual ground ' +
      'truth: what the measurements describe.',
    inputSchema: {
      type: 'object',
      properties: {
        extraction_id: { type: 'string' },
        viewport: { type: 'string', enum: VIEWPORTS, description: 'Default desktop.' },
      },
      required: ['extraction_id'],
    },
    async handler(args, ctx) {
      const result = await requireResult(args.extraction_id);
      const wanted = (typeof args.viewport === 'string' ? args.viewport : 'desktop') as ViewportLabel;
      const url = result.assets.screenshots[wanted] ?? Object.values(result.assets.screenshots)[0];
      if (!url) return problem('No screenshot was captured for this extraction.');

      const data = await readScreenshot(nameFromUrl(url));
      if (!data) return problem(`That screenshot is no longer on disk. It was at ${ctx.origin}${url}`);

      if (data.length > MAX_INLINE_BYTES) {
        return text(
          `The ${wanted} screenshot is ${(data.length / 1024 / 1024).toFixed(1)}MB — too large to ` +
            `inline. Open it at ${ctx.origin}${url}`,
        );
      }

      return {
        content: [
          { type: 'text', text: `${wanted} screenshot of ${result.page.finalUrl}` },
          { type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' },
        ],
      };
    },
  },

  {
    name: 'get_bundle',
    title: 'Get the bundle',
    description:
      'The list of every emitted file and a URL to download them as a ZIP. Fetch the ZIP when ' +
      'you want the files on disk; use get_component or get_brief to read them inline.',
    inputSchema: {
      type: 'object',
      properties: { extraction_id: { type: 'string' } },
      required: ['extraction_id'],
    },
    async handler(args, ctx) {
      const result = await requireResult(args.extraction_id);
      const zip = await buildZip(result);

      return text(
        [
          `${ctx.origin}/api/extract/${result.id}/download — ${(zip.length / 1024).toFixed(0)}KB`,
          '',
          'Contents:',
          ...result.files.map((f) => `- ${f.path} — ${f.description}`),
          ...Object.keys(result.assets.screenshots).map((vp) => `- screenshots/${vp}.jpg`),
        ].join('\n'),
      );
    },
  },

  {
    name: 'request_browser_capture',
    title: 'Ask the human browser to capture a page',
    description:
      'Queue a capture for the DesignDNA browser extension. Use this when extract_page or ' +
      'extract_component failed because the site refuses automated browsers (a bot check, a 403 ' +
      'or a 429): the person running the extension can open that page normally. They see the ' +
      'request, and nothing runs until they click Capture — so tell them what you want and why. ' +
      'Returns an extraction_id that resolves once they do it.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page to capture.' },
        selector: {
          type: 'string',
          description: 'CSS selector to capture one element instead of the page. Optional.',
        },
        note: {
          type: 'string',
          description: 'One line for the person: what you are building and why you need this.',
        },
      },
      required: ['url'],
    },
    async handler(args) {
      const url = asUrl(args.url);
      const selector = typeof args.selector === 'string' ? args.selector.trim() : undefined;
      const note = typeof args.note === 'string' ? args.note.trim().slice(0, 200) : undefined;

      // The job exists from the moment the request does, so the agent has
      // something to poll while the request sits in the queue.
      const job = createJob({
        url,
        selector,
        contentMode: 'verbatim',
        viewports: ['desktop'],
        emitReact: true,
        emitHtml: true,
      });

      const request = await createRequest({ url, selector, note, jobId: job.id });

      return text(
        [
          `Queued. request_id: ${request.id}`,
          `extraction_id: ${job.id}`,
          '',
          `It is now waiting in the extension for ${selector ? `\`${selector}\` on ` : ''}${url}.`,
          'Nothing happens until the person clicks Capture, which may be minutes or never.',
          '',
          `Poll with get_extraction({ extraction_id: "${job.id}" }), or list_capture_requests().`,
          'If they decline, the extraction fails with their reason.',
        ].join('\n'),
      );
    },
  },

  {
    name: 'list_capture_requests',
    title: 'List queued browser captures',
    description:
      'Every capture you have queued and what became of it: waiting, being captured, done, or ' +
      'declined. Check here when an extraction from request_browser_capture has not resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'claimed', 'done', 'declined', 'expired'],
          description: 'Filter. Omitted, all of them.',
        },
      },
    },
    async handler(args) {
      const status = typeof args.status === 'string' ? args.status : undefined;
      const requests = await listRequests(status as never);
      if (!requests.length) return text('No capture requests.');

      const age = (at: number) => `${Math.round((Date.now() - at) / 60000)}m ago`;

      return text(
        requests
          .map((request) =>
            [
              `- ${request.status.toUpperCase()} ${request.url}`,
              request.selector ? `selector: ${request.selector}` : '',
              `extraction_id: ${request.jobId}`,
              `asked ${age(request.createdAt)}`,
              request.message ? `note back: ${request.message}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
          )
          .join('\n'),
      );
    },
  },
];


/**
 * Point a blocked extraction at the one path that still works.
 *
 * The underlying messages tell a person to use the front page's in-browser
 * mode; an agent cannot click that, but it can queue the same capture.
 */
function blockedHint(message: string, options: ExtractOptions): string {
  if (!/bot check|does not serve automated|HTTP 40[1-3]|HTTP 429|rate-limit/i.test(message)) {
    return message;
  }

  const args = [
    `url: "${options.url}"`,
    options.selector ? `selector: "${options.selector}"` : '',
    'note: "<why you need it>"',
  ]
    .filter(Boolean)
    .join(', ');

  return [
    message,
    '',
    `Ask the person running the extension to capture it instead: request_browser_capture({ ${args} }).`,
  ].join('\n');
}

/** Shared tail of extract_page and extract_component. */
async function runAndReport(
  options: ExtractOptions,
  seconds: number,
  ctx: ToolContext,
): Promise<ToolResult> {
  const job = startExtraction(options);
  const finished = await waitForJob(job.id, seconds * 1000);

  if (!finished) return problem('The extraction disappeared before it finished.');
  if (finished.status === 'error') return problem(blockedHint(finished.error ?? 'Extraction failed.', options));
  if (!finished.result) {
    return text(
      [
        `Still running after ${seconds}s: ${progressLine(finished)}`,
        '',
        `get_extraction({ extraction_id: "${job.id}", wait_seconds: 120 })`,
      ].join('\n'),
    );
  }

  return text(summarize(finished.result, ctx));
}

export const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));
