// ============================================
// Threads publisher — Node.js port of
// supabase/functions/publish-content/index.ts
// ============================================

const GRAPH = 'https://graph.threads.net/v1.0'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function publishThreads({
  accessToken,
  platformUserId,
  text,
  mediaUrls = [],
  replyToId,
  log = console,
}) {
  const first = mediaUrls[0] || null
  let mediaType = 'TEXT'
  if (first) {
    const isVideo = /\.(mp4|mov|avi|webm)(\?|$)/i.test(first)
    mediaType = isVideo ? 'VIDEO' : 'IMAGE'
  }

  const body = new URLSearchParams({
    media_type: mediaType,
    text,
    access_token: accessToken,
  })
  if (first && mediaType === 'IMAGE') body.set('image_url', first)
  if (first && mediaType === 'VIDEO') body.set('video_url', first)
  if (replyToId) body.set('reply_to_id', replyToId)

  const containerRes = await fetch(`${GRAPH}/${platformUserId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const containerRaw = await containerRes.text()
  if (!containerRes.ok) {
    throw new Error(`Gagal buat container (${containerRes.status}): ${containerRaw}`)
  }
  const { id: creationId } = JSON.parse(containerRaw)

  // Wait for container ready
  await sleep(3000)
  for (let i = 1; i <= 15; i++) {
    const st = await fetch(
      `${GRAPH}/${creationId}?fields=status,id&access_token=${accessToken}`,
    )
    const sd = await st.json()
    if (sd.status === 'FINISHED') break
    if (sd.status === 'ERROR') throw new Error('Container gagal diproses')
    await sleep(2000)
  }

  const pubRes = await fetch(`${GRAPH}/${platformUserId}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString(),
  })
  const pubRaw = await pubRes.text()
  if (!pubRes.ok) throw new Error(`Publish gagal (${pubRes.status}): ${pubRaw}`)
  const { id: postId } = JSON.parse(pubRaw)
  return { postId, postUrl: `https://www.threads.net/t/${postId}` }
}

// Fetch insights for a Threads post
export async function getThreadsInsights({ accessToken, postId }) {
  const metrics = 'views,likes,replies,reposts,quotes'
  const res = await fetch(
    `${GRAPH}/${postId}/insights?metric=${metrics}&access_token=${accessToken}`,
  )
  if (!res.ok) throw new Error(`Threads insights error: ${await res.text()}`)
  return await res.json()
}

// Field sets to try — some API versions reject certain fields
const FIELD_SETS = [
  'id,text,timestamp,media_type,media_product_type,permalink,link_attachment_url',
  'id,text,timestamp,media_type,permalink,link_attachment_url',
  'id,text,timestamp,media_type,permalink',
  'id,text,permalink',
]

const INSIGHT_METRICS_FULL = 'views,likes,replies,reposts,quotes'
const INSIGHT_METRICS_SAFE = 'likes,replies,reposts,quotes'

function parseInsightsPayload(json) {
  const out = {}
  for (const row of json.data || []) {
    if (!row.name) continue
    const v = row.values?.[0]?.value ?? row.total_value?.value
    if (typeof v === 'number') out[row.name] = v
  }
  return out
}

async function fetchMediaInsights(accessToken, mediaId) {
  for (const metric of [INSIGHT_METRICS_FULL, INSIGHT_METRICS_SAFE, 'likes,replies']) {
    const res = await fetch(
      `${GRAPH}/${mediaId}/insights?metric=${metric}&access_token=${encodeURIComponent(accessToken)}`,
    )
    const json = await res.json()
    if (res.ok && !json.error) {
      const parsed = parseInsightsPayload(json)
      if (Object.keys(parsed).length > 0 || metric === 'likes,replies') return parsed
    }
  }
  return {}
}

// Fetch list of Threads posts with insights
export async function fetchThreadsPostsWithInsights({ accessToken, platformUserId, limit = 25 }) {
  const enc = encodeURIComponent(accessToken)
  let posts = []

  for (const fields of FIELD_SETS) {
    const urls = [
      `${GRAPH}/me/threads?fields=${encodeURIComponent(fields)}&limit=${Math.min(limit, 50)}&access_token=${enc}`,
    ]
    if (platformUserId && /^\d+$/.test(String(platformUserId).trim())) {
      urls.push(
        `${GRAPH}/${platformUserId}/threads?fields=${encodeURIComponent(fields)}&limit=${Math.min(limit, 50)}&access_token=${enc}`,
      )
    }

    for (const url of urls) {
      const res = await fetch(url)
      if (!res.ok) continue
      const json = await res.json()
      if (json.error) continue
      if (json.data?.length) {
        posts = json.data.slice(0, limit)
        break
      }
    }
    if (posts.length) break
  }

  // Enrich with insights
  const enriched = []
  for (const p of posts) {
    const metrics = await fetchMediaInsights(accessToken, p.id)
    enriched.push({ ...p, metrics })
    await sleep(120)
  }

  return enriched
}

// Fetch account-level link clicks (last 7 days)
export async function fetchThreadsAccountClicks({ accessToken, platformUserId }) {
  const uid = String(platformUserId).trim()
  if (!/^\d+$/.test(uid)) return []
  const until = Math.floor(Date.now() / 1000)
  const since = until - 7 * 24 * 3600
  const res = await fetch(
    `${GRAPH}/${uid}/threads_insights?metric=clicks&since=${since}&until=${until}&access_token=${encodeURIComponent(accessToken)}`,
  )
  const json = await res.json()
  if (!res.ok || json.error) return []
  return json.data?.[0]?.link_total_values || []
}
