const axios = require('axios')
const Snoowrap = require('snoowrap')
const NodeCache = require('node-cache')
const uniqBy = require('lodash/uniqBy')
const Post = require('./post')
const stripComment = require('./strip-comment')
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
  // debug: true,
})

class Api {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: 60 * 60,
      useClones: false
    })
    this.getSubredditPosts = this.getSubredditPosts.bind(this)

    //  cache promise to handle parallel requests.
    //  replace promise with actual value for serialization
    ;[
      'getPost',
      'getAuthorComments',
      'getDuplicatePostIds',
    ].forEach((functionName) => {
      const func = this[functionName].bind(this)
      this[functionName] = (async function () {
        const cacheKey = `${functionName}:${JSON.stringify(arguments)}`
        const maybeResult = await this.cache.get(cacheKey)
        if (maybeResult) {
          return maybeResult
        } else {
          const resultPromise = func(...arguments)
          this.cache.set(
            cacheKey,
            resultPromise
          )
          this.cache.set(
            cacheKey,
            await resultPromise
          )
          return resultPromise
        }
      }).bind(this)
    })
  }

  async getPost (postId) {
    try {
      const post = await snoowrap.getSubmission(postId)
      const unwrappedPost = {
        id: await post.id,
        comments: await post.comments,
        post_hint: await post.post_hint,
        domain: await post.domain,
        removed_by_category: await post.removed_by_category,
      }
      return new Post(unwrappedPost)
    } catch (e) {
      return null
    }
  }

  async getSubredditPosts (subreddit) {
    try {
      console.log(`getting posts from subreddit: ${subreddit}`)
      return asyncMap(
        await snoowrap.getHot(subreddit, { limit: INITIAL_POST_LIMIT }),
        post => this.getPost(post.id)
      )
    } catch (e) {
      console.log('e1', e)
      return []
    }
  }

  async getAuthorComments (author) {
    try {
      console.log(`getting comments from author: ${author}`)
      return await snoowrap.getUser(author).getComments({ limit: AUTHOR_POST_LIMIT })
        .map(stripComment)
    } catch (e) {
      console.log(`couldn't get comments by: ${author}`)
      return []
    }
  }

  async isCommentAlreadyRepliedTo(comment) {
    try {
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
    } catch (e) {
      console.log(`couldn't get replies for comment: ${comment}`)
      return true
    }
  }

  async getDuplicatePostIds(post) {
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
      try {
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
      } catch (e) { }
    }

    return uniqBy([ ...duplicatePostIds, post.id ])
  }

  // subject to breaking with snoowrap updates
  async reportComment (comment, message) {
    console.log(`reporting comment: ${comment.id}`)
    try {
      await ({
        ...comment,
        _r: snoowrap,
        _post: Snoowrap.objects.ReplyableContent.prototype._post,
        report: Snoowrap.objects.ReplyableContent.prototype.report,
      })
        .report(message)
    } catch (e) {
      console.log('e', e)
    }
  }

  async replyToComment (comment, message) {
    console.log(`replying to comment: ${comment.id}`)
    try {
      await ({
        ...comment,
        _r: snoowrap,
        _post: Snoowrap.objects.ReplyableContent.prototype._post,
        reply: Snoowrap.objects.ReplyableContent.prototype.reply,
      }) 
        .reply(message)
    } catch (e) {
      console.log('e', e)
    }
  }
}

function canTryImageSearch(post) {
  return post.post_hint === 'image'
    && !post.domain.includes('imgur')
    && !post.removed_by_category
}

const api = new Api()

module.exports = api
