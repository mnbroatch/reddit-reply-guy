const axios = require('axios')
const Snoowrap = require('snoowrap')
const NodeCache = require('node-cache')
const uniqBy = require('lodash/uniqBy')
const Post = require('./post')
const {
  asyncMap,
  asyncMapSerial,
  asyncFilter,
  asyncReduce,
  asyncFind,
} = require('./async-array-helpers')

// var http = require('http-debug').http
// var https = require('http-debug').https
// http.debug = 1
// https.debug = 1

const INITIAL_POST_LIMIT = +process.env.INITIAL_POST_LIMIT 
const AUTHOR_POST_LIMIT = +process.env.AUTHOR_POST_LIMIT
const REPLY_BOT_USERS = JSON.parse(process.env.REPLY_BOT_USERS)

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDDIT_USER,
  REDDIT_PASS,
  USER_AGENT,
} = process.env
const snoowrap = new Snoowrap({
  userAgent: USER_AGENT,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  username: REDDIT_USER,
  password: REDDIT_PASS
})
snoowrap.config({
  continueAfterRatelimitError: true,
  requestDelay: 1000,
  debug: true,
})

class Api {
  constructor() {
    [
      'getPost',
      'getSubredditPosts',
      'cachePost',
      'isCommentAlreadyRepliedTo',
    ].forEach((functionName) => {
      this[functionName] = this[functionName].bind(this)
    })

    this.cache = new NodeCache({ stdTTL: 60 * 60 })
  }

  async cachePost (id, postOrPromise) {
    const postPromise = Promise.resolve(postOrPromise).then(post => new Post(post))

    this.cache.set(
      id,
      postPromise
    )

    // overwrite promise in the cache for serializing for backup
    this.cache.set(
      id,
      await postPromise
    )

    return postPromise
  }

  async getPost (postId) {
    const maybePost = this.cache.get(postId)
    if (maybePost) {
      return maybePost
    } else {
      // console.log(`getting post: ${postId}`)
      const post = await snoowrap.getSubmission(postId)
      return this.cachePost(
        postId,
        {
          id: await post.id,
          comments: await post.comments,
          post_hint: await post.post_hint,
          domain: await post.domain,
          removed_by_category: await post.removed_by_category,
        }
      )
    }
  }

  async getSubredditPosts (subreddit) {
    // console.log(`getting posts from subreddit: ${subreddit}`)
    return asyncMap(
      await snoowrap.getHot(subreddit, { limit: INITIAL_POST_LIMIT }),
      post => this.getPost(post.id)
    )
  }

  getAuthorComments (author) {
    // console.log(`getting comments from author: ${author}`)
    return snoowrap.getUser(author).getComments({ limit: AUTHOR_POST_LIMIT })
  }

  async isCommentAlreadyRepliedTo(comment) {
    return comment.replyAuthors.some(
      author => REPLY_BOT_USERS.some(
        user => user.toLowerCase() === author.toLowerCase() 
      )
    ) || (await snoowrap.getComment(comment.id).expandReplies({ depth: 1 }).replies)
      .some(
        reply => REPLY_BOT_USERS.some(
          user => user.toLowerCase() === reply.author.name.toLowerCase() 
        )
      )
  }

  async getDuplicatePostIds(post) {
    try {
    let duplicatePostIds = []
    if (canTryImageSearch(post)) {
      console.log(`trying image search on post: ${post.id}`)
      try {
        duplicatePostIds = (await axios.get(
          `https://api.repostsleuth.com/image?filter=true&url=https:%2F%2Fredd.it%2Fn9p6fa&postId=${post.id}&same_sub=false&filter_author=false&only_older=false&include_crossposts=true&meme_filter=false&target_match_percent=90&filter_dead_matches=false&target_days_old=0`
        ))
          .data.matches.map(match => match.post.post_id)
      } catch (e) { }
    }

    // We should see if it's worth always checking both places
    // If there are too many hits from the image search, use this.
    // An example would be chess gifs; lots of false positives
    if (!duplicatePostIds.length || duplicatePostIds.length > 20) {
      // console.log(`getting duplicates for: ${post.id}`)
      duplicatePostIds = await asyncMap(
        await snoowrap.oauthRequest({
          uri: '/api/info',
          method: 'get',
          qs: {
            url: await post.url,
          }
        }),
        dupeMeta => dupeMeta.id
      )
    }

    return uniqBy([ ...duplicatePostIds, post.id ])
    } catch (e) {
      console.log('e', e)
    }
  }

  // subject to breaking with snoowrap updates
  async reportComment (comment, message) {
    console.log(`reporting comment: ${comment.id}`)
    await ({
      ...comment,
      _r: snoowrap,
      _post: Snoowrap.objects.ReplyableContent.prototype._post,
      report: Snoowrap.objects.ReplyableContent.prototype.report,
    })
      .report(message)
  }

  async replyToComment (comment, message) {
    console.log(`replying to comment: ${comment.id}`)
    await ({
      ...comment,
      _r: snoowrap,
      _post: Snoowrap.objects.ReplyableContent.prototype._post,
      reply: Snoowrap.objects.ReplyableContent.prototype.reply,
    }) 
      .reply(message)
  }
}

function canTryImageSearch(post) {
  return post.post_hint === 'image'
    && !post.domain.includes('imgur')
    && !post.removed_by_category
}

const api = new Api()

module.exports = api
