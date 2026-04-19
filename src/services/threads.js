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
