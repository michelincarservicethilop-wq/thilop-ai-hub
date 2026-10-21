/**
 * Bộ đọc Server-Sent Events tối giản: nhận từng mẩu chữ, gom các dòng `data:`
 * của một sự kiện (kết thúc bằng dòng trống) rồi gọi `onData` với JSON đã parse.
 */
export function createSSEParser(onData: (data: unknown) => void) {
  let buffer = '';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    dataLines = [];
    if (raw === '[DONE]') return;
    try {
      onData(JSON.parse(raw));
    } catch {
      // bỏ qua dòng không phải JSON
    }
  };

  const handleLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // chú thích / keep-alive
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.search(/\r\n|\n|\r/)) >= 0) {
        const line = buffer.slice(0, idx);
        const sepLen = buffer.startsWith('\r\n', idx) ? 2 : 1;
        buffer = buffer.slice(idx + sepLen);
        handleLine(line);
      }
    },
    flush() {
      if (buffer) {
        handleLine(buffer);
        buffer = '';
      }
      dispatch();
    },
  };
}

/** Đọc một Response dạng text/event-stream tới hết, gọi onData cho mỗi sự kiện. */
export async function readSSE(res: Response, onData: (data: unknown) => void): Promise<void> {
  if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng trả lời.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser(onData);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
}
