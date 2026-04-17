import React from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/utils/clipboard';

interface MarkdownLiteProps {
  children: string;
  className?: string;
  stopPropagation?: boolean;
}

// Supports [text](url), `code`, and line breaks (both \n and actual newlines)
const MarkdownLite: React.FC<MarkdownLiteProps> = ({
  children,
  className,
  stopPropagation = false,
}) => {
  if (!children) return null;

  // Handle both literal \n strings and actual newlines
  let lines: string[];
  if (children.includes('\\n')) {
    lines = children.split('\\n');
  } else {
    lines = children.split('\n');
  }

  // Group consecutive bullet points together
  const processedLines: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    const isBulletPoint = trimmed.startsWith('* ') && !trimmed.startsWith('**');

    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const headingClasses = [
        'text-base font-bold mt-3 mb-1',
        'text-sm font-semibold mt-2.5 mb-1',
        'text-sm font-medium mt-2 mb-0.5',
      ];
      const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      processedLines.push(
        React.createElement(
          tag,
          { key: `h-${i}`, className: headingClasses[level - 1] },
          processInlineMarkdown(text, stopPropagation)
        )
      );
      i++;
    } else if (isBulletPoint) {
      // Collect all consecutive bullet points
      const bulletPoints: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith('* ') &&
        !lines[i].trim().startsWith('**')
      ) {
        bulletPoints.push(lines[i]);
        i++;
      }

      // Render as a single list
      processedLines.push(
        <ul key={`bullets-${i}`} className="list-none space-y-1 mt-2 mb-1">
          {bulletPoints.map((bullet, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>
                {processInlineMarkdown(bullet.slice(2), stopPropagation)}
              </span>
            </li>
          ))}
        </ul>
      );
    } else {
      // Regular line
      if (i > 0) {
        processedLines.push(<br key={`br-${i}`} />);
      }
      processedLines.push(processLine(line, stopPropagation));
      i++;
    }
  }

  return <span className={className}>{processedLines}</span>;
};

// Helper function to process a single line for markdown
function processLine(text: string, stopPropagation: boolean) {
  // Process regular line with inline markdown
  return processInlineMarkdown(text, stopPropagation);
}

// Helper function to process inline markdown (bold, italic, code, links)
function processInlineMarkdown(text: string, stopPropagation: boolean) {
  // Regex for **bold**, *italic*, `code`, and [text](url)
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^\)]+\))/g;
  const parts = text.split(regex);
  const matches = text.match(regex) || [];
  let matchIdx = 0;

  return parts.map((part, i) => {
    if (i === parts.length - 1 && part === '') return null;
    if (i % 2 === 0) {
      // Plain text
      return part;
    } else {
      const match = matches[matchIdx++];
      if (!match) return null;

      if (match.startsWith('**') && match.endsWith('**')) {
        // Bold text
        return (
          <strong key={i} className="font-semibold">
            {match.slice(2, -2)}
          </strong>
        );
      } else if (
        match.startsWith('*') &&
        match.endsWith('*') &&
        !match.startsWith('**')
      ) {
        // Italic text
        return (
          <em key={i} className="italic">
            {match.slice(1, -1)}
          </em>
        );
      } else if (match.startsWith('`') && match.endsWith('`')) {
        // Inline code
        return (
          <code
            key={i}
            onClick={async (e) => {
              if (stopPropagation) {
                e.stopPropagation();
              }
              await copyToClipboard(match.slice(1, -1), {
                onSuccess: () => toast.success('Copied to clipboard'),
                onError: () => toast.error('Failed to copy to clipboard'),
              });
            }}
            className="bg-muted px-1 py-0.5 rounded text-[--brand] font-mono text-xs break-all cursor-pointer"
          >
            {match.slice(1, -1)}
          </code>
        );
      } else {
        // Link
        const linkMatch = match.match(/\[([^\]]+)\]\(([^\)]+)\)/);
        if (linkMatch) {
          const [, text, url] = linkMatch;
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[--brand] hover:underline"
              onClick={(e) => stopPropagation && e.stopPropagation()}
            >
              {text}
            </a>
          );
        }
      }
      return match;
    }
  });
}

export default MarkdownLite;
