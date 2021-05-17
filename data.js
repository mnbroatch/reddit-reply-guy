const Post = require('./post')

module.exports = class Data {
  constructor() {
    [
      'getAllPosts',
      'setPost',
      'getPost',
    ].forEach((functionName) => {
      this[functionName] = this[functionName].bind(this)
    })

    this.posts = {}
  }

  setPost(post) {
    this.posts[post.id] = new Post(post)
  }

  getPost(id) {
    return this.posts[id]
  }

  getAllPosts(id) {
    return Object.values(this.posts)
  }
}
