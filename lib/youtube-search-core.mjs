const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function readTextRun(obj) {
  if (!obj) return '';
  if (typeof obj.simpleText === 'string') return obj.simpleText.trim();
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => String(r?.text || '')).join('').trim();
  return '';
}

function collectVideoRenderers(node, out, seen, maxResults) {
  if (!node || typeof node !== 'object' || out.length >= maxResults) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, out, seen, maxResults);
      if (out.length >= maxResults) return;
    }
    return;
  }
  if (node.videoRenderer && typeof node.videoRenderer === 'object') {
    const vr = node.videoRenderer;
    const videoId = String(vr.videoId || '').trim();
    const duration = readTextRun(vr.lengthText);
    const title = readTextRun(vr.title);
    const channel = readTextRun(vr.ownerText) || readTextRun(vr.longBylineText) || readTextRun(vr.shortBylineText);
    // Skip invalid IDs, duplicates, and active livestreams without duration
    if (VIDEO_ID_RE.test(videoId) && !seen.has(videoId) && duration) {
      seen.add(videoId);
      out.push({
        videoId,
        title: title.slice(0, 140),
        channel: channel.slice(0, 80),
        duration: duration.slice(0, 20)
      });
    }
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'responseContext' || key === 'trackingParams') continue;
    collectVideoRenderers(node[key], out, seen, maxResults);
    if (out.length >= maxResults) return;
  }
}

export function parseYouTubeSearchHtml(html, maxResults = 5) {
  const limit = Math.max(1, Math.min(8, Number(maxResults) || 5));
  const src = String(html || '');
  if (!src) return [];

  const results = [];
  const seen = new Set();

  // Primary strategy: parse ytInitialData JSON block
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = '];
  for (const marker of markers) {
    const startIdx = src.indexOf(marker);
    if (startIdx < 0) continue;
    const jsonStart = src.indexOf('{', startIdx + marker.length);
    if (jsonStart < 0) continue;
    const endCandidates = [
      src.indexOf(';</script>', jsonStart),
      src.indexOf(';\n', jsonStart),
      src.indexOf('</script>', jsonStart)
    ].filter((idx) => idx > jsonStart);
    const jsonEnd = endCandidates.length ? Math.min(...endCandidates) : -1;
    if (jsonEnd <= jsonStart) continue;
    try {
      const parsed = JSON.parse(src.slice(jsonStart, jsonEnd).replace(/;\s*$/, ''));
      collectVideoRenderers(parsed, results, seen, limit);
      if (results.length > 0) return results;
    } catch {
      // Fallback below
    }
  }

  // Fallback strategy: regex scan for videoRenderer videoId entries
  const fallbackRe = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = fallbackRe.exec(src)) !== null && results.length < limit) {
    const videoId = m[1];
    if (!seen.has(videoId)) {
      seen.add(videoId);
      results.push({ videoId, title: '', channel: '', duration: '' });
    }
  }
  return results;
}

export async function searchYouTubeVideos(rawQuery, { maxResults = 5, fetchImpl = fetch } = {}) {
  const query = String(rawQuery || '').trim().slice(0, 180);
  if (!query) {
    return { ok: false, query: '', results: [], error: 'Termo de busca vazio.' };
  }

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=pt&gl=BR`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6500);

  try {
    const resp = await fetchImpl(searchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!resp.ok) {
      return { ok: false, query, results: [], error: `YouTube respondeu HTTP ${resp.status}` };
    }
    const html = await resp.text();
    const results = parseYouTubeSearchHtml(html, maxResults);
    return { ok: results.length > 0, query, results };
  } catch (err) {
    return {
      ok: false,
      query,
      results: [],
      error: err?.name === 'AbortError' ? 'Tempo esgotado ao buscar vídeo.' : 'Não foi possível consultar o YouTube agora.'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
