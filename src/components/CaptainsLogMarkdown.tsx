import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';

const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mt-8 scroll-mt-24 text-2xl font-semibold tracking-tight text-white first:mt-0 sm:text-[1.65rem]" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mt-6 text-lg font-semibold tracking-tight text-accent" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="mt-4 text-base font-semibold text-white" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="text-base leading-relaxed text-slate-200" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-3 list-disc space-y-2 pl-5 marker:text-accent/70" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-3 list-decimal space-y-2 pl-5 marker:font-medium marker:text-accent/80" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-slate-200 [&>p]:my-1" {...props}>
      {children}
    </li>
  ),
  hr: ({ ...props }) => <hr className="my-8 border-0 border-t border-white/15" {...props} />,
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-white" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-slate-100" {...props}>
      {children}
    </em>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-4 border-l-2 border-accent/50 py-1 pl-4 text-slate-300 [&>p]:text-slate-300"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a
      className="font-medium text-accent underline decoration-accent/50 underline-offset-2 transition-colors hover:text-white hover:decoration-white/80"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ children, ...props }) => (
    <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm text-slate-100" {...props}>
      {children}
    </code>
  ),
};

interface CaptainsLogMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Renders Captain's Log body markdown (pipeline output: ## / ###, lists, optional CTA block).
 */
export default function CaptainsLogMarkdown({ content, className = '' }: CaptainsLogMarkdownProps) {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    return null;
  }

  return (
    <div className={`captains-log-markdown space-y-4 ${className}`.trim()}>
      <ReactMarkdown components={markdownComponents}>{trimmed}</ReactMarkdown>
    </div>
  );
}
