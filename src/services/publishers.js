// ============================================
// Unified publisher dispatcher
// Routes to platform-specific implementations.
// Platforms not yet wired raise "not_implemented".
// ============================================
import { publishThreads, getThreadsInsights } from './threads.js'

// Instagram Graph API (requires Business/Creator account + long-lived token)
async function publishInstagram() {
  throw new Error(
    'Instagram publishing belum diimplementasi. ' +
      'Gunakan Meta Graph API dengan ig_user_id → /media → /media_publish',
  )
}

async function publishTwitter() {
  throw new Error(
    'Twitter/X publishing belum diimplementasi. ' +
      'Wire Twitter API v2 /2/tweets endpoint dengan OAuth2 user context.',
  )
}

async function publishTikTok() {
  throw new Error(
    'TikTok publishing belum diimplementasi. ' +
      'Wire Content Posting API: /v2/post/publish/video/init/ + upload chunks.',
  )
}

async function publishFacebook() {
  throw new Error(
    'Facebook publishing belum diimplementasi. ' +
      'Wire /{page-id}/feed dengan page access token.',
  )
}

async function publishYouTube() {
  throw new Error(
    'YouTube publishing belum diimplementasi. ' +
      'Wire YouTube Data API v3 videos.insert (resumable upload).',
  )
}

export async function publishToPlatform({
  platform,
  accessToken,
  platformUserId,
  text,
  mediaUrls,
  replyToId,
  log,
}) {
  switch (platform) {
    case 'threads':
      return await publishThreads({
        accessToken, platformUserId, text, mediaUrls, replyToId, log,
      })
    case 'instagram':
      return await publishInstagram({ accessToken, platformUserId, text, mediaUrls })
    case 'twitter':
      return await publishTwitter({ accessToken, text, mediaUrls, replyToId })
    case 'tiktok':
      return await publishTikTok({ accessToken, mediaUrls, text })
    case 'facebook':
      return await publishFacebook({ accessToken, platformUserId, text, mediaUrls })
    case 'youtube':
      return await publishYouTube({ accessToken, mediaUrls, text })
    default:
      throw new Error(`Platform '${platform}' tidak dikenali`)
  }
}

export async function getPlatformInsights({ platform, accessToken, postId }) {
  switch (platform) {
    case 'threads':
      return await getThreadsInsights({ accessToken, postId })
    default:
      throw new Error(`Insights untuk platform '${platform}' belum diimplementasi`)
  }
}
