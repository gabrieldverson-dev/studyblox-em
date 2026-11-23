import { searchYouTubeVideos } from '../../lib/youtube-search-core.mjs';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = String(url.searchParams.get('q') || '').trim();
  if (!query) {
    return new Response(
      JSON.stringify({ ok: false, results: [], error: 'Informe o parâmetro q.' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  const data = await searchYouTubeVideos(query, { maxResults: 5 });
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': data.ok ? 'public, max-age=86400, s-maxage=86400' : 'no-store'
    }
  });
}
