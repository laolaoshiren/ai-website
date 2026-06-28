function appendField(fields, name, value) {
  if (fields[name] === undefined) fields[name] = value;
  else if (Array.isArray(fields[name])) fields[name].push(value);
  else fields[name] = [fields[name], value];
}

function parseContentDisposition(value = '') {
  const result = {};
  for (const part of value.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey.toLowerCase()] = rawValue.join('=').trim().replace(/^"|"$/g, '');
  }
  return result;
}

function collectRequestBuffer(req, limitBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('上传文件过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseMultipartForm(req, options = {}) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('上传表单格式不正确');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const body = await collectRequestBuffer(req, options.limitBytes);

  const fields = {};
  const files = {};
  let cursor = 0;

  while (cursor < body.length) {
    let start = body.indexOf(boundary, cursor);
    if (start < 0) break;
    start += boundary.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    if (body.slice(start, start + 2).toString() === '\r\n') start += 2;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0) break;
    const headerText = body.slice(start, headerEnd).toString('latin1');
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
    }

    let next = body.indexOf(boundary, headerEnd + 4);
    if (next < 0) next = body.length;
    let content = body.slice(headerEnd + 4, next);
    if (content.length >= 2 && content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);

    const disposition = parseContentDisposition(headers['content-disposition']);
    if (disposition.name) {
      if (disposition.filename !== undefined) {
        files[disposition.name] = {
          filename: disposition.filename,
          contentType: headers['content-type'] || 'application/octet-stream',
          data: content,
        };
      } else {
        appendField(fields, disposition.name, content.toString('utf8'));
      }
    }
    cursor = next;
  }

  return { fields, files };
}

module.exports = { parseMultipartForm };
