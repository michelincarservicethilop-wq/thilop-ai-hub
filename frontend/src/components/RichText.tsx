import type { ReactNode } from 'react';

/**
 * Hiển thị chữ AI trả về với định dạng đơn giản, an toàn (không dùng innerHTML):
 * - giữ xuống dòng
 * - **đậm**, `mã`
 * - dòng bắt đầu bằng "- ", "* ", "• " → gạch đầu dòng; "1. " → danh sách số
 * - dòng "# Tiêu đề" → chữ đậm
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={keyBase + '-' + i++}>{tok.slice(2, -2)}</strong>);
    else out.push(<code key={keyBase + '-' + i++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'h'; text: string };

export function RichText({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const ul = /^\s*(?:[-*•])\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const prev = blocks[blocks.length - 1];
    if (ul) {
      if (prev?.kind === 'ul') prev.items.push(ul[1]);
      else blocks.push({ kind: 'ul', items: [ul[1]] });
    } else if (ol) {
      if (prev?.kind === 'ol') prev.items.push(ol[1]);
      else blocks.push({ kind: 'ol', items: [ol[1]] });
    } else if (h) {
      blocks.push({ kind: 'h', text: h[1] });
    } else if (line.trim() === '') {
      blocks.push({ kind: 'p', lines: [] });
    } else if (prev?.kind === 'p' && prev.lines.length > 0) {
      prev.lines.push(line);
    } else {
      blocks.push({ kind: 'p', lines: [line] });
    }
  }
  return (
    <div className="rich">
      {blocks.map((b, bi) => {
        const k = 'b' + bi;
        if (b.kind === 'ul')
          return (
            <ul key={k}>
              {b.items.map((it, i) => (
                <li key={i}>{inline(it, k + i)}</li>
              ))}
            </ul>
          );
        if (b.kind === 'ol')
          return (
            <ol key={k}>
              {b.items.map((it, i) => (
                <li key={i}>{inline(it, k + i)}</li>
              ))}
            </ol>
          );
        if (b.kind === 'h')
          return (
            <p key={k} className="rich-h">
              <strong>{inline(b.text, k)}</strong>
            </p>
          );
        if (b.lines.length === 0) return null;
        return (
          <p key={k}>
            {b.lines.map((l, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {inline(l, k + '-' + i)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
