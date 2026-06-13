import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'

export default function PaperView() {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    fetch('/paper.md')
      .then((r) => r.text())
      .then(setContent)
      .catch(() => setContent('Failed to load paper.'))
  }, [])

  if (content === null) {
    return <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading…</p>
  }

  return (
    <div
      className="prose max-w-none"
      style={{
        '--tw-prose-body': 'rgba(255,255,255,0.8)',
        '--tw-prose-headings': '#ffffff',
        '--tw-prose-bold': '#ffffff',
        '--tw-prose-code': '#d4af37',
        '--tw-prose-pre-bg': 'rgba(0,0,0,0.3)',
        '--tw-prose-hr': 'rgba(212,175,55,0.2)',
        '--tw-prose-quotes': 'rgba(255,255,255,0.5)',
        '--tw-prose-th-borders': 'rgba(212,175,55,0.2)',
        '--tw-prose-td-borders': 'rgba(212,175,55,0.1)',
        color: 'rgba(255,255,255,0.8)',
      } as React.CSSProperties}
    >
      <Markdown
        components={{
          h1: ({ children }) => (
            <h1 style={{ color: '#ffffff', borderBottom: '1px solid rgba(212,175,55,0.2)', paddingBottom: '0.5rem', marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 700 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ color: '#ffffff', borderBottom: '1px solid rgba(212,175,55,0.1)', paddingBottom: '0.25rem', marginTop: '2rem', marginBottom: '1rem', fontSize: '1.2rem', fontWeight: 700 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ color: 'rgba(255,255,255,0.9)', marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 600 }}>{children}</h3>
          ),
          p: ({ children }) => (
            <p style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: '0.75rem' }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: '#ffffff', fontWeight: 600 }}>{children}</strong>
          ),
          code: ({ children, className }) => {
            const isBlock = !!className
            return isBlock ? (
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.35)', padding: '0.75rem 1rem', borderRadius: '0.5rem', color: '#d4af37', fontSize: '0.8rem', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre' }}>{children}</code>
            ) : (
              <code style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37', padding: '0.1rem 0.3rem', borderRadius: '0.25rem', fontSize: '0.85em', fontFamily: 'monospace' }}>{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre style={{ background: 'rgba(0,0,0,0.35)', borderRadius: '0.5rem', padding: '0', margin: '1rem 0', overflow: 'hidden', border: '1px solid rgba(212,175,55,0.1)' }}>{children}</pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th style={{ color: '#d4af37', fontWeight: 600, padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(212,175,55,0.25)', textAlign: 'left' }}>{children}</th>
          ),
          td: ({ children }) => (
            <td style={{ color: 'rgba(255,255,255,0.75)', padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{children}</td>
          ),
          hr: () => (
            <hr style={{ border: 'none', borderTop: '1px solid rgba(212,175,55,0.15)', margin: '2rem 0' }} />
          ),
          ul: ({ children }) => (
            <ul style={{ color: 'rgba(255,255,255,0.75)', paddingLeft: '1.5rem', marginBottom: '0.75rem', lineHeight: 1.7 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ color: 'rgba(255,255,255,0.75)', paddingLeft: '1.5rem', marginBottom: '0.75rem', lineHeight: 1.7 }}>{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{ borderLeft: '3px solid rgba(212,175,55,0.4)', paddingLeft: '1rem', color: 'rgba(255,255,255,0.5)', margin: '1rem 0', fontStyle: 'italic' }}>{children}</blockquote>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
