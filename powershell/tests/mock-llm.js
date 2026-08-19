// Mock OpenAI-compatible server with SSE streaming, for testing the llm-proxy.
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    console.log(`[mock] ${req.method} ${req.url} auth=${req.headers['authorization'] || '-'} body=${body.slice(0, 120)}`);
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const chunks = ['data: {"choices":[{"delta":{"content":"Привет"}}]}\n\n',
                      'data: {"choices":[{"delta":{"content":" из мока"}}]}\n\n',
                      'data: {"choices":[{"delta":{}}],"finish_reason":"stop"}\n\n',
                      'data: [DONE]\n\n'];
      let i = 0;
      const t = setInterval(() => {
        if (i < chunks.length) { res.write(chunks[i++]); }
        else { clearInterval(t); res.end(); }
      }, 100);
    } else if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model' }] }));
    } else {
      res.writeHead(404); res.end('not found');
    }
  });
}).listen(8899, '127.0.0.1', () => console.log('mock llm on :8899'));
