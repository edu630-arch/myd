/**
 * ==============================================================================
 * [로컬 개발 서버: server.js]
 * 별도의 npm 패키지 설치(npm install) 없이도 Node.js 기본 내장 기능만으로
 * .env 환경 변수를 로드하고 정적 파일(index.html)과 서버리스 함수(/api/analyze)를
 * 완벽하게 호스팅해주는 경량 로컬 개발 서버입니다.
 * ==============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. 순수 Node.js로 .env 파일 읽어서 process.env에 주입 (Zero-Dependency)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const firstEqual = trimmed.indexOf('=');
        const key = trimmed.slice(0, firstEqual).trim();
        const value = trimmed.slice(firstEqual + 1).trim();
        process.env[key] = value;
      }
    });
    console.log('.env 파일의 환경 변수를 성공적으로 불러왔습니다.');
  }
} catch (e) {
  console.warn('.env 파일 로드 중 경고:', e.message);
}

const analyzeHandler = require('./api/analyze');
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 2. API 엔드포인트 라우팅 (/api/analyze)
  if (pathname === '/api/analyze') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      let parsedBody = {};
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch (e) {
          parsedBody = { content: body };
        }
      }

      const customReq = {
        method: req.method,
        headers: req.headers,
        body: parsedBody
      };

      const customRes = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
          res.setHeader(name, value);
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...this.headers });
          res.end(JSON.stringify(data));
        },
        end(data) {
          res.writeHead(this.statusCode, this.headers);
          res.end(data);
        }
      };

      try {
        await analyzeHandler(customReq, customRes);
      } catch (err) {
        console.error('로컬 서버 API 에러:', err);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }

  // 3. 정적 파일 라우팅 (index.html 등)
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server Error: ' + readErr.code);
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 마음 일기 로컬 서버가 시작되었습니다!`);
  console.log(`👉 접속 주소: http://localhost:${PORT}`);
  console.log(`👉 API 엔드포인트: http://localhost:${PORT}/api/analyze`);
  console.log(`=================================================`);
});
